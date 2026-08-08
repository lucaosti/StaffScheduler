/**
 * Mobile-client response mode for POST /auth/login and POST /auth/refresh.
 *
 * A Capacitor WebView cannot rely on the cookie jar reaching the backend
 * reliably, so the mobile app opts in with `X-Client-Type: mobile` to also
 * receive the token values in the JSON body, and refresh accepts a
 * body-supplied token when the cookie is absent. Both endpoints keep setting
 * the cookies unconditionally either way — the extra behavior is additive.
 *
 * The regression tests here are the point of this file: a plain web request
 * (no header) must never see a token field in the body, and must never have
 * its refresh token accepted from anywhere but the cookie.
 */

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { UserService } from '../services/UserService';
import { database } from '../config/database';
import { createAuthRouter } from '../routes/auth';

jest.mock('../services/UserService');
jest.mock('../services/RbacService');
jest.mock('../services/TwoFactorService');
jest.mock('../services/RefreshTokenService');
jest.mock('../config/database', () => ({
  database: { getPool: jest.fn().mockReturnValue({}) },
}));

import { RbacService } from '../services/RbacService';
import { TwoFactorService } from '../services/TwoFactorService';
import { RefreshTokenService } from '../services/RefreshTokenService';

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
  isActive: true,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  (database.getPool as jest.Mock).mockReturnValue({});
  (RbacService.prototype.getEffectivePermissions as jest.Mock) = jest.fn().mockResolvedValue([]);
  (RbacService.prototype.getUserRoles as jest.Mock) = jest.fn().mockResolvedValue([]);
  (TwoFactorService.prototype.hasAnyEnabled as jest.Mock) = jest.fn().mockResolvedValue(false);
  (RefreshTokenService.prototype.issue as jest.Mock) = jest
    .fn()
    .mockResolvedValue({ token: 'refresh-token', expiresAt: new Date(Date.now() + 1000) });
});

describe('POST /api/auth/login — response mode', () => {
  beforeEach(() => {
    (UserService.prototype.validatePassword as jest.Mock) = jest.fn().mockResolvedValue(makeUser());
  });

  it('never includes token fields in the body for a plain web request (regression guard)', async () => {
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'a@x.com', password: 'pw' });

    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty('accessToken');
    expect(res.body.data).not.toHaveProperty('refreshToken');
    // The cookie-only contract still holds for the web caller.
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((c) => c.startsWith('token='))).toBe(true);
    expect(cookies.some((c) => c.startsWith('refresh_token='))).toBe(true);
  });

  it('includes both cookies AND the token values in the body when X-Client-Type: mobile is present', async () => {
    const res = await request(buildApp())
      .post('/api/auth/login')
      .set('X-Client-Type', 'mobile')
      .send({ email: 'a@x.com', password: 'pw' });

    expect(res.status).toBe(200);
    expect(typeof res.body.data.accessToken).toBe('string');
    expect(res.body.data.refreshToken).toBe('refresh-token');
    // Additive, not a replacement: the harmless-if-unused cookies are still set.
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((c) => c.startsWith('token='))).toBe(true);
    expect(cookies.some((c) => c.startsWith('refresh_token='))).toBe(true);
  });

  it('ignores an unrecognized X-Client-Type value (only the exact "mobile" signal opts in)', async () => {
    const res = await request(buildApp())
      .post('/api/auth/login')
      .set('X-Client-Type', 'web')
      .send({ email: 'a@x.com', password: 'pw' });

    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty('accessToken');
    expect(res.body.data).not.toHaveProperty('refreshToken');
  });
});

describe('POST /api/auth/refresh — response mode and token source', () => {
  beforeEach(() => {
    (UserService.prototype.getUserById as jest.Mock) = jest.fn().mockResolvedValue(makeUser());
    (RefreshTokenService.prototype.rotate as jest.Mock) = jest.fn().mockResolvedValue({
      userId: 7,
      issued: { token: 'new-refresh-token', expiresAt: new Date(Date.now() + 1000) },
    });
  });

  it('never includes token fields in the body for a plain web (cookie) request (regression guard)', async () => {
    const res = await request(buildApp())
      .post('/api/auth/refresh')
      .set('Cookie', 'refresh_token=old-refresh-token');

    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty('accessToken');
    expect(res.body.data).not.toHaveProperty('refreshToken');
    expect(RefreshTokenService.prototype.rotate).toHaveBeenCalledWith('old-refresh-token');
  });

  it('rejects a web request with a body-supplied token and no cookie (security regression guard)', async () => {
    const res = await request(buildApp())
      .post('/api/auth/refresh')
      .send({ refreshToken: 'attacker-supplied-token' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('REFRESH_INVALID');
    // The body token must never reach rotate() on the web path.
    expect(RefreshTokenService.prototype.rotate).not.toHaveBeenCalled();
  });

  it('accepts a body-supplied refresh token only when the mobile signal is present and no cookie exists', async () => {
    const res = await request(buildApp())
      .post('/api/auth/refresh')
      .set('X-Client-Type', 'mobile')
      .send({ refreshToken: 'device-stored-token' });

    expect(res.status).toBe(200);
    expect(RefreshTokenService.prototype.rotate).toHaveBeenCalledWith('device-stored-token');
    expect(typeof res.body.data.accessToken).toBe('string');
    expect(res.body.data.refreshToken).toBe('new-refresh-token');
  });

  it('prefers the cookie over the body token when the mobile client happens to have both', async () => {
    const res = await request(buildApp())
      .post('/api/auth/refresh')
      .set('X-Client-Type', 'mobile')
      .set('Cookie', 'refresh_token=cookie-token')
      .send({ refreshToken: 'body-token' });

    expect(res.status).toBe(200);
    expect(RefreshTokenService.prototype.rotate).toHaveBeenCalledWith('cookie-token');
  });

  it('returns 401 for a mobile request with neither a cookie nor a body token', async () => {
    const res = await request(buildApp())
      .post('/api/auth/refresh')
      .set('X-Client-Type', 'mobile')
      .send({});

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('REFRESH_INVALID');
    expect(RefreshTokenService.prototype.rotate).not.toHaveBeenCalled();
  });
});
