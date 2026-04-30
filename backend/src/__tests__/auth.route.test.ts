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
import { AuthService } from '../services/AuthService';
import { config } from '../config';
import { createAuthRouter } from '../routes/auth';

jest.mock('../services/AuthService');

const buildApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  // Pool is irrelevant — AuthService is mocked.
  app.use('/api/auth', createAuthRouter({} as never));
  return app;
};

const successResponse = (overrides: Record<string, unknown> = {}) => ({
  success: true,
  data: {
    token: jwt.sign(
      { userId: 7, email: 'a@x.com', role: 'manager' },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn as jwt.SignOptions['expiresIn'] }
    ),
    user: {
      id: 7,
      email: 'a@x.com',
      firstName: 'A',
      lastName: 'B',
      role: 'manager',
    },
    ...overrides,
  },
});

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('returns 400 when credentials are missing', async () => {
    (AuthService.prototype.login as jest.Mock) = jest.fn().mockResolvedValue({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Email and password are required' },
    });
    const res = await request(buildApp()).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 when credentials are invalid', async () => {
    (AuthService.prototype.login as jest.Mock) = jest.fn().mockResolvedValue({
      success: false,
      error: { code: 'LOGIN_FAILED', message: 'Invalid email or password' },
    });
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'a@x.com', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('LOGIN_FAILED');
  });

  it('returns a JWT and user payload on success', async () => {
    (AuthService.prototype.login as jest.Mock) = jest.fn().mockResolvedValue(successResponse());
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'a@x.com', password: 'pw' });
    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe('manager');
    expect(typeof res.body.data.token).toBe('string');
    const decoded = jwt.verify(res.body.data.token, config.jwt.secret) as { userId: number };
    expect(decoded.userId).toBe(7);
  });

  it('issues a token whose TTL respects config.jwt.expiresIn', async () => {
    (AuthService.prototype.login as jest.Mock) = jest.fn().mockResolvedValue(successResponse());
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'a@x.com', password: 'pw' });
    expect(res.status).toBe(200);
    const decoded = jwt.verify(res.body.data.token, config.jwt.secret) as {
      iat: number;
      exp: number;
    };
    // Default config.jwt.expiresIn is '24h'; allow a small drift.
    const ttlSeconds = decoded.exp - decoded.iat;
    expect(ttlSeconds).toBeGreaterThanOrEqual(24 * 60 * 60 - 5);
    expect(ttlSeconds).toBeLessThanOrEqual(24 * 60 * 60 + 5);
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
