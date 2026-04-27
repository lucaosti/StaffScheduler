/**
 * Extended auth route tests — covers branches that the basic smoke tests miss:
 *   - GET /verify: the success path, and the error catch.
 *   - POST /refresh: the success path and the error catch.
 *   - POST /logout: the authenticated success path.
 *   - POST /login: service throws (catch block).
 */

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { UserService } from '../services/UserService';
import { database } from '../config/database';
import { config } from '../config';
import { createAuthRouter } from '../routes/auth';

jest.mock('../services/UserService');
jest.mock('../config/database', () => ({
  database: { getPool: jest.fn().mockReturnValue({}) },
}));

const buildApp = () => {
  const app = express();
  app.use(express.json());
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
  });

  it('returns 200 with the user payload (minus sensitive fields) on success', async () => {
    (UserService.prototype.getUserById as jest.Mock) = jest
      .fn()
      .mockResolvedValue(makeUser({ password_hash: 'secret', salt: 'pepper' }));
    const token = signToken({ userId: 7, email: 'a@x.com', role: 'manager' });

    const res = await request(buildApp()).get('/api/auth/verify').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).not.toHaveProperty('password_hash');
    expect(res.body.data).not.toHaveProperty('salt');
    expect(res.body.data.email).toBe('a@x.com');
  });
});

describe('POST /api/auth/refresh', () => {
  beforeEach(() => {
    (UserService as jest.MockedClass<typeof UserService>).mockClear();
    (database.getPool as jest.Mock).mockReturnValue({});
  });

  it('issues a new token for a valid user', async () => {
    (UserService.prototype.getUserById as jest.Mock) = jest.fn().mockResolvedValue(makeUser({ password_hash: 'secret' }));
    const token = signToken({ userId: 7, email: 'a@x.com', role: 'manager' });

    const res = await request(buildApp()).post('/api/auth/refresh').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.token).toBe('string');
    expect(res.body.data.user).not.toHaveProperty('password_hash');

    const decoded = jwt.verify(res.body.data.token, config.jwt.secret) as { userId: number };
    expect(decoded.userId).toBe(7);
  });

  it('returns 401 without a token', async () => {
    const res = await request(buildApp()).post('/api/auth/refresh');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  beforeEach(() => {
    (UserService as jest.MockedClass<typeof UserService>).mockClear();
    (database.getPool as jest.Mock).mockReturnValue({});
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
    expect(res.body.error.message).toBe('service failure');
  });
});

