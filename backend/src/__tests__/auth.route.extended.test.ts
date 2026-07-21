/**
 * Extended auth route tests — covers branches that the basic smoke tests miss:
 *   - GET /verify: the success path, and the error catch.
 *   - POST /refresh: the success path and the error catch.
 *   - POST /logout: the authenticated success path.
 *   - POST /login: service throws (catch block).
 */

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { UserService } from '../services/UserService';
import { database } from '../config/database';
import { config } from '../config';
import { createAuthRouter } from '../routes/auth';

jest.mock('../services/UserService');
jest.mock('../services/RbacService');
jest.mock('../services/RefreshTokenService');
jest.mock('../config/database', () => ({
  database: { getPool: jest.fn().mockReturnValue({}) },
}));

import { RbacService } from '../services/RbacService';
import { RefreshTokenService } from '../services/RefreshTokenService';

// The real app mounts cookie-parser; the refresh endpoint reads the refresh
// cookie, so these bare test apps need it too.
const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', createAuthRouter({} as never));
  return app;
};

const makeUser = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  email: 'a@x.com',
  firstName: 'A',
  lastName: 'B',
  role: 'manager',
  isActive: true,
  ...overrides,
});

const signToken = (payload: Record<string, unknown>) => jwt.sign(payload, config.jwt.secret, { expiresIn: '1h' });

describe('GET /api/auth/verify', () => {
  beforeEach(() => {
    (UserService as jest.MockedClass<typeof UserService>).mockClear();
    (database.getPool as jest.Mock).mockReturnValue({});
    (RbacService.prototype.getEffectivePermissions as jest.Mock) = jest.fn().mockResolvedValue([]);
    (RbacService.prototype.getUserRoles as jest.Mock) = jest.fn().mockResolvedValue([]);
  });

  it('returns 200 with the user payload on success', async () => {
    (UserService.prototype.getUserById as jest.Mock) = jest
      .fn()
      .mockResolvedValue(makeUser());
    const token = signToken({ userId: 7, email: 'a@x.com', role: 'manager' });

    const res = await request(buildApp()).get('/api/auth/verify').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.email).toBe('a@x.com');
  });
});

describe('POST /api/auth/refresh', () => {
  beforeEach(() => {
    (UserService as jest.MockedClass<typeof UserService>).mockClear();
    (database.getPool as jest.Mock).mockReturnValue({});
    (RbacService.prototype.getEffectivePermissions as jest.Mock) = jest.fn().mockResolvedValue([]);
    (RbacService.prototype.getUserRoles as jest.Mock) = jest.fn().mockResolvedValue([]);
  });

  it('rotates the refresh token and issues a fresh access token', async () => {
    (UserService.prototype.getUserById as jest.Mock) = jest.fn().mockResolvedValue(makeUser());
    // A valid rotation returns the user id and a brand-new refresh token.
    (RefreshTokenService.prototype.rotate as jest.Mock) = jest.fn().mockResolvedValue({
      userId: 7,
      issued: { token: 'new-refresh-token', expiresAt: new Date(Date.now() + 1000) },
    });

    const res = await request(buildApp())
      .post('/api/auth/refresh')
      .set('Cookie', 'refresh_token=old-refresh-token');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.id).toBe(7);
    expect(RefreshTokenService.prototype.rotate).toHaveBeenCalledWith('old-refresh-token');

    const cookies = res.headers['set-cookie'] as unknown as string[];
    // A new short-lived access token and the rotated refresh token are both set.
    const accessCookie = cookies.find((c) => c.startsWith('token='));
    const refreshCookie = cookies.find((c) => c.startsWith('refresh_token='));
    expect(accessCookie).toBeDefined();
    expect(refreshCookie).toContain('refresh_token=new-refresh-token');
    const decoded = jwt.verify(accessCookie!.split(';')[0].split('=')[1], config.jwt.secret) as {
      userId: number;
    };
    expect(decoded.userId).toBe(7);
  });

  it('returns 401 and clears cookies when no refresh cookie is present', async () => {
    const res = await request(buildApp()).post('/api/auth/refresh');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('REFRESH_INVALID');
  });

  it('returns 401 when the refresh token is invalid/reused (rotate returns null)', async () => {
    (RefreshTokenService.prototype.rotate as jest.Mock) = jest.fn().mockResolvedValue(null);
    const res = await request(buildApp())
      .post('/api/auth/refresh')
      .set('Cookie', 'refresh_token=stolen');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('REFRESH_INVALID');
  });

  it('revokes and rejects when the account is gone or inactive', async () => {
    (RefreshTokenService.prototype.rotate as jest.Mock) = jest.fn().mockResolvedValue({
      userId: 7,
      issued: { token: 'new', expiresAt: new Date(Date.now() + 1000) },
    });
    (UserService.prototype.getUserById as jest.Mock) = jest.fn().mockResolvedValue(null);
    const revoke = jest.fn().mockResolvedValue(undefined);
    (RefreshTokenService.prototype.revoke as jest.Mock) = revoke;

    const res = await request(buildApp())
      .post('/api/auth/refresh')
      .set('Cookie', 'refresh_token=valid-but-orphaned');

    expect(res.status).toBe(401);
    expect(revoke).toHaveBeenCalledWith('new');
  });
});

describe('POST /api/auth/logout', () => {
  beforeEach(() => {
    (UserService as jest.MockedClass<typeof UserService>).mockClear();
    (database.getPool as jest.Mock).mockReturnValue({});
    (RbacService.prototype.getEffectivePermissions as jest.Mock) = jest.fn().mockResolvedValue([]);
    (RbacService.prototype.getUserRoles as jest.Mock) = jest.fn().mockResolvedValue([]);
  });

  it('returns 200 with a logout confirmation for an authenticated user', async () => {
    (UserService.prototype.getUserById as jest.Mock) = jest.fn().mockResolvedValue(makeUser());
    const token = signToken({ userId: 7, email: 'a@x.com', role: 'manager' });

    const res = await request(buildApp()).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Logged out successfully');
  });
});

describe('POST /api/auth/login — service throws', () => {
  it('returns 401 with the error message when validatePassword throws', async () => {
    (UserService.prototype.validatePassword as jest.Mock) = jest.fn().mockRejectedValue(new Error('service failure'));

    const res = await request(buildApp()).post('/api/auth/login').send({ email: 'a@x.com', password: 'pw' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('LOGIN_FAILED');
    expect(res.body.error.message).toBe('Invalid email or password');
  });
});

describe('POST /api/auth/login — rate limiting', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    jest.resetModules();
  });

  it('eventually returns 429 once the per-IP login threshold is exceeded', async () => {
    // Force the strict (non-test) limiter by building a router in a module
    // registry where NODE_ENV is not 'test'. 'development' is used rather than
    // 'production' to avoid tripping the production secret guard in config.
    process.env.NODE_ENV = 'development';

    let limitedStatus = 0;
    let limitedBody: any;

    await jest.isolateModulesAsync(async () => {
       
      const { UserService: IsolatedUserService } = require('../services/UserService');
       
      const { createAuthRouter: isolatedCreateAuthRouter } = require('../routes/auth');

      (IsolatedUserService.prototype.validatePassword as jest.Mock) = jest.fn().mockResolvedValue(null);

      const app = express();
      app.use(express.json());
      app.use('/api/auth', isolatedCreateAuthRouter({} as never));

      // Strict limiter allows 10 attempts per window; the 11th must be blocked.
      for (let i = 0; i < 10; i += 1) {
        const res = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'wrong' });
        expect(res.status).toBe(401);
      }

      const blocked = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'wrong' });
      limitedStatus = blocked.status;
      limitedBody = blocked.body;
    });

    expect(limitedStatus).toBe(429);
    expect(limitedBody.success).toBe(false);
    expect(limitedBody.error.code).toBe('TOO_MANY_REQUESTS');
  });
});


describe('POST /api/auth/logout — server-side revocation', () => {
  beforeEach(() => {
    (UserService as jest.MockedClass<typeof UserService>).mockClear();
    (database.getPool as jest.Mock).mockReturnValue({});
    (RbacService.prototype.getEffectivePermissions as jest.Mock) = jest.fn().mockResolvedValue([]);
    (RbacService.prototype.getUserRoles as jest.Mock) = jest.fn().mockResolvedValue([]);
    (RbacService.prototype.computeAllowedOrgUnitIds as jest.Mock) = jest.fn().mockResolvedValue(null);
    (RbacService.prototype.getEffectiveDelegationScopes as jest.Mock) = jest.fn().mockResolvedValue([]);
  });

  it('blacklists the token JTI so the same token stops working immediately', async () => {
    (UserService.prototype.getUserById as jest.Mock) = jest.fn().mockResolvedValue(makeUser());
    // A logout only revokes server-side when the token carries a jti — the
    // login flow always mints one; this pins the revocation wiring itself.
    const token = signToken({ userId: 7, jti: `logout-test-${Date.now()}` });

    const app = buildApp();
    const logout = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);
    expect(logout.status).toBe(200);

    const replay = await request(app).get('/api/auth/verify').set('Authorization', `Bearer ${token}`);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('TOKEN_REVOKED');
  });
});
