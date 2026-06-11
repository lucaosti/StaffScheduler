/**
 * Auth route integration tests via supertest.
 *
 * Mocks UserService at the module boundary; the routes are mounted on a
 * minimal Express app and exercised end-to-end (parser, error handlers,
 * response shape).
 */

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { UserService } from '../services/UserService';
import { RbacService } from '../services/RbacService';
import { TwoFactorService } from '../services/TwoFactorService';
import { config } from '../config';
import { createAuthRouter } from '../routes/auth';

jest.mock('../services/UserService');
jest.mock('../services/RbacService');
jest.mock('../services/TwoFactorService');

const buildApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  // Pool is irrelevant — UserService is mocked.
  app.use('/api/auth', createAuthRouter({} as never));
  return app;
};

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('returns 400 when credentials are missing', async () => {
    const res = await request(buildApp()).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 when credentials are invalid', async () => {
    (UserService.prototype.validatePassword as jest.Mock) = jest.fn().mockResolvedValue(null);
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'a@x.com', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('LOGIN_FAILED');
  });

  it('returns a JWT and user payload on success', async () => {
    (UserService.prototype.validatePassword as jest.Mock) = jest.fn().mockResolvedValue({
      id: 7,
      email: 'a@x.com',
      firstName: 'A',
      lastName: 'B',
    });
    (TwoFactorService.prototype.isEnabled as jest.Mock) = jest.fn().mockResolvedValue(false);
    (RbacService.prototype.getEffectivePermissions as jest.Mock) = jest
      .fn()
      .mockResolvedValue(['schedule.manage', 'schedule.read']);
    (RbacService.prototype.getUserRoles as jest.Mock) = jest
      .fn()
      .mockResolvedValue([{ roleId: 2, roleName: 'Manager', scopeOrgUnitId: null, expiresAt: null }]);
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'a@x.com', password: 'pw' });
    expect(res.status).toBe(200);
    expect(res.body.data.user.permissions).toContain('schedule.manage');
    expect(res.body.data.user.roles[0].roleName).toBe('Manager');
    expect(res.body.data.token).toBeUndefined();
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const tokenCookie = cookies?.find((c: string) => c.startsWith('token='));
    expect(tokenCookie).toBeDefined();
    const cookieToken = tokenCookie!.split(';')[0].split('=')[1];
    const decoded = jwt.verify(cookieToken, config.jwt.secret) as { userId: number };
    expect(decoded.userId).toBe(7);
  });
});

describe('POST /api/auth/login — two-factor enforcement', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (UserService.prototype.validatePassword as jest.Mock) = jest.fn().mockResolvedValue({
      id: 7,
      email: 'a@x.com',
      firstName: 'A',
      lastName: 'B',
    });
    (RbacService.prototype.getEffectivePermissions as jest.Mock) = jest.fn().mockResolvedValue([]);
    (RbacService.prototype.getUserRoles as jest.Mock) = jest.fn().mockResolvedValue([]);
    (TwoFactorService.prototype.isEnabled as jest.Mock) = jest.fn().mockResolvedValue(true);
  });

  it('returns 401 TOTP_REQUIRED when 2FA is enabled and no code is supplied', async () => {
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'a@x.com', password: 'pw' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOTP_REQUIRED');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('returns 401 TOTP_INVALID when the code is wrong', async () => {
    (TwoFactorService.prototype.verifyCode as jest.Mock) = jest.fn().mockResolvedValue(false);
    (TwoFactorService.prototype.consumeRecoveryCode as jest.Mock) = jest
      .fn()
      .mockResolvedValue(false);
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'a@x.com', password: 'pw', totpCode: '000000' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOTP_INVALID');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('logs in when a valid TOTP code is supplied', async () => {
    (TwoFactorService.prototype.verifyCode as jest.Mock) = jest.fn().mockResolvedValue(true);
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'a@x.com', password: 'pw', totpCode: '123456' });
    expect(res.status).toBe(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies?.some((c: string) => c.startsWith('token='))).toBe(true);
  });

  it('logs in when a valid recovery code is supplied', async () => {
    (TwoFactorService.prototype.verifyCode as jest.Mock) = jest.fn().mockResolvedValue(false);
    (TwoFactorService.prototype.consumeRecoveryCode as jest.Mock) = jest
      .fn()
      .mockResolvedValue(true);
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'a@x.com', password: 'pw', totpCode: 'RECOVERY-1234' });
    expect(res.status).toBe(200);
  });
});

describe('GET /api/auth/verify', () => {
  it('returns 401 when no Authorization header is present', async () => {
    const res = await request(buildApp()).get('/api/auth/verify');
    expect(res.status).toBe(401);
  });

  it('returns 401 on a tampered token', async () => {
    const res = await request(buildApp())
      .get('/api/auth/verify')
      .set('Authorization', 'Bearer not-a-jwt');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('returns 401 without a token', async () => {
    const res = await request(buildApp()).post('/api/auth/logout');
    expect(res.status).toBe(401);
  });
});
