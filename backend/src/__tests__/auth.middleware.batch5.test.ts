/**
 * Auth middleware coverage batch 5 — fills remaining gaps in authenticate and requireModule:
 *   authenticate — JWT payload userId not string/number → 401 (line 93)
 *   authenticate — JWT payload userId parses to NaN or ≤0 → 401 (line 97)
 *   requireModule — service throws → 503 SERVICE_UNAVAILABLE (lines 190-196)
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { authenticate, requireModule } from '../middleware/auth';
import { config } from '../config';
import { ModuleService } from '../services/ModuleService';

jest.mock('../services/UserService');
jest.mock('../services/RbacService');
jest.mock('../services/ModuleService');
jest.mock('../config/database', () => ({
  database: { getPool: jest.fn().mockReturnValue({}) },
}));

const buildApp = (extra: express.RequestHandler[] = []) => {
  const app = express();
  app.use(express.json());
  app.get('/protected', authenticate, ...extra, (_req, res) => {
    res.json({ success: true });
  });
  return app;
};

// ─────────────────────────────────────────────────────────────────────────────
// authenticate — JWT payload userId is not string or number
// ─────────────────────────────────────────────────────────────────────────────

describe('authenticate — JWT payload userId is wrong type', () => {
  it('returns 401 INVALID_TOKEN when userId is a boolean', async () => {
    // jwt.sign accepts arbitrary payloads; a boolean userId is not string|number
    const token = jwt.sign({ userId: true }, config.jwt.secret);
    const app = buildApp();
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
    expect(res.body.error.message).toBe('Invalid token payload');
  });

  it('returns 401 INVALID_TOKEN when userId is an object', async () => {
    const token = jwt.sign({ userId: { nested: true } }, config.jwt.secret);
    const app = buildApp();
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// authenticate — JWT payload userId parses to NaN or ≤0
// ─────────────────────────────────────────────────────────────────────────────

describe('authenticate — JWT payload userId parses to NaN or zero', () => {
  it('returns 401 INVALID_TOKEN when userId string cannot be parsed as an integer', async () => {
    const token = jwt.sign({ userId: 'not-a-number' }, config.jwt.secret);
    const app = buildApp();
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
    expect(res.body.error.message).toBe('Invalid token payload');
  });

  it('returns 401 INVALID_TOKEN when userId is 0', async () => {
    const token = jwt.sign({ userId: 0 }, config.jwt.secret);
    const app = buildApp();
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('returns 401 INVALID_TOKEN when userId is negative', async () => {
    const token = jwt.sign({ userId: -5 }, config.jwt.secret);
    const app = buildApp();
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// requireModule — ModuleService.isEnabled throws → 503
// ─────────────────────────────────────────────────────────────────────────────

describe('requireModule — service error returns 503 SERVICE_UNAVAILABLE', () => {
  it('returns 503 when ModuleService.isEnabled throws', async () => {
    (ModuleService.prototype.isEnabled as jest.Mock).mockRejectedValueOnce(
      new Error('DB unreachable')
    );
    // Reset the module-service singleton so it picks up our fresh mock
    // (auth.ts caches _moduleService; reset with jest.resetModules is not
    // needed here because we mock the prototype, not the instance).
    const app = express();
    app.use(express.json());
    app.get('/guarded', requireModule('notifications'), (_req, res) =>
      res.json({ success: true })
    );
    const res = await request(app).get('/guarded');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
  });
});
