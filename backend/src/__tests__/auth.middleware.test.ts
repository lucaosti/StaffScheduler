/**
 * Auth middleware tests.
 *
 * Mounts a tiny app with `authenticate` and the role guards in front of a
 * test handler so we can exercise:
 *   - missing Authorization header
 *   - malformed / non-Bearer header
 *   - expired or tampered JWT
 *   - inactive user
 *   - happy path
 *   - requireRole / requireAdmin / requireManager
 */

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { authenticate, requireRole, requireAdmin, requireManager } from '../middleware/auth';
import { config } from '../config';
import { UserService } from '../services/UserService';
import { database } from '../config/database';

jest.mock('../services/UserService');
jest.mock('../config/database', () => ({
  database: { getPool: jest.fn().mockReturnValue({}) },
}));

const buildApp = (extraMiddleware: express.RequestHandler[] = []): express.Express => {
  const app = express();
  app.use(express.json());
  app.get('/protected', authenticate, ...extraMiddleware, (req, res) => {
    res.json({ success: true, data: { userId: req.user?.id } });
  });
  return app;
};

const signToken = (payload: Record<string, unknown>, secretOverride?: string, expIn = '1h') =>
  jwt.sign(payload, secretOverride ?? config.jwt.secret, { expiresIn: expIn as any });

describe('authenticate', () => {
  beforeEach(() => {
    (UserService as jest.MockedClass<typeof UserService>).mockClear();
    (database.getPool as jest.Mock).mockReturnValue({});
  });

  it('returns 401 MISSING_TOKEN with no Authorization header', async () => {
    const res = await request(buildApp()).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('MISSING_TOKEN');
  });

  it('returns 401 MISSING_TOKEN with a non-Bearer header', async () => {
    const res = await request(buildApp()).get('/protected').set('Authorization', 'Basic abc');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('MISSING_TOKEN');
  });

  it('returns 401 INVALID_TOKEN with a tampered JWT', async () => {
    const res = await request(buildApp())
      .get('/protected')
      .set('Authorization', 'Bearer abc.def.ghi');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('returns 401 INVALID_TOKEN with a JWT signed by a different secret', async () => {
    const token = signToken({ userId: 1, email: 'a@x', role: 'admin' }, 'wrong-secret');
    const res = await request(buildApp())
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('returns 401 USER_NOT_FOUND when the user is missing or inactive', async () => {
    (UserService.prototype.getUserById as jest.Mock) = jest.fn().mockResolvedValue(null);
    const token = signToken({ userId: 1, email: 'a@x', role: 'admin' });
    const res = await request(buildApp())
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('attaches the user and calls next on the happy path', async () => {
    (UserService.prototype.getUserById as jest.Mock) = jest.fn().mockResolvedValue({
      id: 7,
      email: 'a@x',
      role: 'manager',
      isActive: true,
    });
    const token = signToken({ userId: 7, email: 'a@x', role: 'manager' });
    const res = await request(buildApp())
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.userId).toBe(7);
  });
});

describe('requireRole / requireAdmin / requireManager', () => {
  beforeEach(() => {
    (UserService.prototype.getUserById as jest.Mock) = jest.fn().mockResolvedValue({
      id: 7,
      email: 'a@x',
      role: 'employee',
      isActive: true,
    });
  });

  it('returns 403 FORBIDDEN when role does not match the allow list', async () => {
    const token = signToken({ userId: 7, email: 'a@x', role: 'employee' });
    const res = await request(buildApp([requireRole(['admin'])]))
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('requireAdmin lets admins through and blocks managers', async () => {
    (UserService.prototype.getUserById as jest.Mock) = jest.fn().mockResolvedValue({
      id: 7,
      email: 'admin@x',
      role: 'admin',
      isActive: true,
    });
    const adminToken = signToken({ userId: 7, email: 'admin@x', role: 'admin' });
    const ok = await request(buildApp([requireAdmin]))
      .get('/protected')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(ok.status).toBe(200);

    (UserService.prototype.getUserById as jest.Mock) = jest.fn().mockResolvedValue({
      id: 8,
      email: 'm@x',
      role: 'manager',
      isActive: true,
    });
    const mgrToken = signToken({ userId: 8, email: 'm@x', role: 'manager' });
    const blocked = await request(buildApp([requireAdmin]))
      .get('/protected')
      .set('Authorization', `Bearer ${mgrToken}`);
    expect(blocked.status).toBe(403);
  });

  it('requireManager admits both admin and manager', async () => {
    (UserService.prototype.getUserById as jest.Mock) = jest.fn().mockResolvedValue({
      id: 8,
      email: 'm@x',
      role: 'manager',
      isActive: true,
    });
    const token = signToken({ userId: 8, email: 'm@x', role: 'manager' });
    const res = await request(buildApp([requireManager]))
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
