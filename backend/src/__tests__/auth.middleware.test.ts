/**
 * Auth middleware tests.
 *
 * Mounts a tiny app with `authenticate` and the permission guard in front of a
 * test handler so we can exercise:
 *   - missing Authorization header
 *   - malformed / non-Bearer header
 *   - expired or tampered JWT
 *   - inactive user
 *   - happy path
 *   - requirePermission
 */

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { authenticate, requirePermission } from '../middleware/auth';
import { config } from '../config';
import { UserService } from '../services/UserService';
import { RbacService } from '../services/RbacService';
import { database } from '../config/database';

jest.mock('../services/UserService');
jest.mock('../services/RbacService');
jest.mock('../config/database', () => ({
  database: { getPool: jest.fn().mockReturnValue({}) },
}));

const setPermissions = (perms: string[]): void => {
  (RbacService.prototype.getEffectivePermissions as jest.Mock) = jest.fn().mockResolvedValue(perms);
  (RbacService.prototype.getUserRoles as jest.Mock) = jest.fn().mockResolvedValue([]);
};

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
    setPermissions([]);
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
    const token = signToken({ userId: 1, email: 'a@x' }, 'wrong-secret');
    const res = await request(buildApp())
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('returns 401 USER_NOT_FOUND when the user is missing or inactive', async () => {
    (UserService.prototype.getUserById as jest.Mock) = jest.fn().mockResolvedValue(null);
    const token = signToken({ userId: 1, email: 'a@x' });
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
      isActive: true,
    });
    const token = signToken({ userId: 7, email: 'a@x' });
    const res = await request(buildApp())
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.userId).toBe(7);
  });
});

describe('requirePermission', () => {
  beforeEach(() => {
    (UserService.prototype.getUserById as jest.Mock) = jest.fn().mockResolvedValue({
      id: 7,
      email: 'a@x',
      isActive: true,
    });
  });

  it('returns 403 FORBIDDEN when the user lacks the required permission', async () => {
    setPermissions(['schedule.read']);
    const token = signToken({ userId: 7, email: 'a@x' });
    const res = await request(buildApp([requirePermission('settings.manage')]))
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('lets a user through when they hold the required permission', async () => {
    setPermissions(['settings.manage', 'schedule.read']);
    const token = signToken({ userId: 7, email: 'a@x' });
    const res = await request(buildApp([requirePermission('settings.manage')]))
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
