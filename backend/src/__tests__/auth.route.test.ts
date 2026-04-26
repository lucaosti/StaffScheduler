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
import { config } from '../config';
import { createAuthRouter } from '../routes/auth';

jest.mock('../services/UserService');

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
      role: 'manager',
    });
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'a@x.com', password: 'pw' });
    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe('manager');
    expect(typeof res.body.data.token).toBe('string');
    const decoded = jwt.verify(res.body.data.token, config.jwt.secret) as { userId: number };
    expect(decoded.userId).toBe(7);
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
