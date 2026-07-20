/**
 * Auth-context cache tests for the `authenticate` middleware.
 *
 * With AUTH_PERMISSION_CACHE_TTL_MS > 0 the middleware serves repeat requests
 * for the same user from an in-process cache instead of re-resolving the user
 * and their permissions from the database; `invalidateAuthContext` drops the
 * entry so grant changes apply immediately on this instance.
 */

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

jest.mock('../services/UserService');
jest.mock('../services/RbacService');
jest.mock('../config/database', () => ({
  database: { getPool: jest.fn().mockReturnValue({}) },
}));
jest.mock('../config', () => {
  const actual = jest.requireActual('../config');
  return {
    config: {
      ...actual.config,
      auth: { permissionCacheTtlMs: 60_000 },
    },
  };
});

import { authenticate, invalidateAuthContext } from '../middleware/auth';
import { config } from '../config';
import { UserService } from '../services/UserService';
import { RbacService } from '../services/RbacService';

const signToken = (payload: Record<string, unknown>) =>
  jwt.sign(payload, config.jwt.secret, { expiresIn: '1h' });

const fakeUser = { id: 42, email: 'cached@x', isActive: true };

const mountApp = (): express.Express => {
  const app = express();
  app.get('/protected', authenticate, (req, res) => {
    res.json({ success: true, data: { permissions: (req as any).user.permissions } });
  });
  return app;
};

beforeEach(() => {
  invalidateAuthContext(42);
  (UserService.prototype.getUserById as jest.Mock) = jest.fn().mockResolvedValue({ ...fakeUser });
  (RbacService.prototype.getEffectivePermissions as jest.Mock) = jest
    .fn()
    .mockResolvedValue(['schedule.read']);
  (RbacService.prototype.getUserRoles as jest.Mock) = jest.fn().mockResolvedValue([]);
  (RbacService.prototype.computeAllowedOrgUnitIds as jest.Mock) = jest.fn().mockResolvedValue(null);
  (RbacService.prototype.getEffectiveDelegationScopes as jest.Mock) = jest.fn().mockResolvedValue([]);
});

describe('authenticate — auth-context cache', () => {
  it('resolves from the DB once, then serves repeat requests from the cache', async () => {
    const app = mountApp();
    const token = signToken({ userId: 42 });

    const first = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(first.status).toBe(200);
    const second = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(second.status).toBe(200);
    expect(second.body.data.permissions).toEqual(['schedule.read']);

    expect(UserService.prototype.getUserById).toHaveBeenCalledTimes(1);
    expect(RbacService.prototype.getEffectivePermissions).toHaveBeenCalledTimes(1);
  });

  it('invalidateAuthContext forces a fresh resolution on the next request', async () => {
    const app = mountApp();
    const token = signToken({ userId: 42 });

    await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    invalidateAuthContext(42);
    await request(app).get('/protected').set('Authorization', `Bearer ${token}`);

    expect(UserService.prototype.getUserById).toHaveBeenCalledTimes(2);
  });
});

describe('authenticate — cache expiry and eviction', () => {
  it('re-resolves after the TTL elapses (bounded staleness window)', async () => {
    const app = mountApp();
    const token = signToken({ userId: 42 });

    await request(app).get('/protected').set('Authorization', `Bearer ${token}`);

    // Jump past the 60s TTL: the cached entry must be treated as dead, not
    // served stale forever.
    const realNow = Date.now;
    const base = realNow();
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => base + 61_000);
    try {
      await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    } finally {
      nowSpy.mockRestore();
    }

    expect(UserService.prototype.getUserById).toHaveBeenCalledTimes(2);
  });

  it('evicts the oldest entry once the cache reaches capacity', async () => {
    // Drive `authenticate` directly (no HTTP) so filling the 10 000-entry
    // cache stays fast; each call is just jwt.verify + mocked resolvers.
    const callAuthenticate = async (userId: number) => {
      const req = {
        cookies: { token: signToken({ userId }) },
        headers: {},
      } as never;
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as never;
      await new Promise<void>((resolve) => {
        void authenticate(req, res, () => resolve());
      });
    };

    (UserService.prototype.getUserById as jest.Mock).mockImplementation(async (id: number) => ({
      id,
      email: `u${id}@x`,
      isActive: true,
    }));

    await callAuthenticate(1);
    // 10 000 more distinct users push user 1 out (FIFO approximation).
    for (let id = 2; id <= 10_001; id++) {
      await callAuthenticate(id);
    }

    (UserService.prototype.getUserById as jest.Mock).mockClear();
    await callAuthenticate(1);
    expect(UserService.prototype.getUserById).toHaveBeenCalledTimes(1);
  }, 120_000);
});
