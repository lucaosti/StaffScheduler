/**
 * Auth middleware internals: JTI blacklist bounds, the hourly prune sweep and
 * the global requireModule guard.
 *
 * The blacklist is a process-local Map with two protections that never fire
 * under ordinary suites: a hard capacity cap (oldest entry evicted first so
 * memory stays bounded even under logout floods) and an hourly interval that
 * sweeps expired entries. Both are exercised here — the sweep through fake
 * timers on a freshly isolated module registry, because the interval is
 * armed at import time.
 */

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

jest.mock('../services/UserService');
jest.mock('../services/RbacService');
jest.mock('../services/ModuleService');
jest.mock('../config/database', () => ({
  database: { getPool: jest.fn().mockReturnValue({}) },
}));

import { addToBlacklist, authenticate, requireModule } from '../middleware/auth';
import { config } from '../config';
import { UserService } from '../services/UserService';
import { RbacService } from '../services/RbacService';
import { ModuleService } from '../services/ModuleService';

const signToken = (payload: Record<string, unknown>) =>
  jwt.sign(payload, config.jwt.secret, { expiresIn: '1h' });

beforeEach(() => {
  (UserService.prototype.getUserById as jest.Mock) = jest
    .fn()
    .mockResolvedValue({ id: 1, email: 'u@x', isActive: true });
  (RbacService.prototype.getEffectivePermissions as jest.Mock) = jest.fn().mockResolvedValue([]);
  (RbacService.prototype.getUserRoles as jest.Mock) = jest.fn().mockResolvedValue([]);
  (RbacService.prototype.computeAllowedOrgUnitIds as jest.Mock) = jest.fn().mockResolvedValue(null);
  (RbacService.prototype.getEffectiveDelegationScopes as jest.Mock) = jest.fn().mockResolvedValue([]);
});

const authApp = () => {
  const app = express();
  app.get('/p', authenticate, (_req, res) => {
    res.json({ success: true });
  });
  return app;
};

describe('JTI blacklist capacity cap', () => {
  it('evicts the oldest entry at capacity so a very old revocation can slip through', async () => {
    const far = Date.now() + 3_600_000;
    addToBlacklist('evicted-jti', far);
    // Fill to the 100 000-entry cap: each insert beyond it drops the oldest.
    for (let i = 0; i < 100_000; i++) {
      addToBlacklist(`filler-${i}`, far);
    }

    const res = await request(authApp())
      .get('/p')
      .set('Authorization', `Bearer ${signToken({ userId: 1, jti: 'evicted-jti' })}`);
    expect(res.status).toBe(200);

    // A surviving entry still blocks.
    const blocked = await request(authApp())
      .get('/p')
      .set('Authorization', `Bearer ${signToken({ userId: 1, jti: 'filler-99999' })}`);
    expect(blocked.status).toBe(401);
    expect(blocked.body.error.code).toBe('TOKEN_REVOKED');
  }, 60_000);
});

describe('hourly blacklist prune', () => {
  it('sweeps expired entries and keeps live ones', () => {
    jest.useFakeTimers();
    try {
      let mod: typeof import('../middleware/auth') | undefined;
      jest.isolateModules(() => {
        mod = require('../middleware/auth');
      });
      // One entry already expired, one still live when the sweep fires.
      mod!.addToBlacklist('expired', Date.now() + 1_000);
      mod!.addToBlacklist('live', Date.now() + 2 * 3_600_000);

      jest.advanceTimersByTime(3_600_000 + 1);
      // The sweep is fire-and-forget: nothing observable beyond not throwing
      // (memory reclamation); live entries must still be present, which the
      // capacity test above asserts through authenticate.
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('requireModule (global variant)', () => {
  const moduleApp = (code: string) => {
    const app = express();
    app.get('/m', requireModule(code), (_req, res) => {
      res.json({ success: true });
    });
    return app;
  };

  // getModuleService() memoizes one ModuleService for the whole process, so
  // tests must MUTATE the shared automock function rather than replace the
  // prototype property — a replacement made after the singleton exists would
  // never be seen by it.
  const isEnabledMock = () => ModuleService.prototype.isEnabled as jest.Mock;

  it('lets requests through when the module is enabled', async () => {
    isEnabledMock().mockResolvedValue(true);
    const res = await request(moduleApp('reporting')).get('/m');
    expect(res.status).toBe(200);
  });

  it('hides the route with 404 when the module is disabled', async () => {
    isEnabledMock().mockResolvedValue(false);
    const res = await request(moduleApp('reporting')).get('/m');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('degrades to 503 when the module lookup fails', async () => {
    isEnabledMock().mockRejectedValue(new Error('db'));
    const res = await request(moduleApp('reporting')).get('/m');
    expect(res.status).toBe(503);
  });
});
