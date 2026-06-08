/**
 * Auth route catch-block tests.
 *
 * Covers the reachable catch in POST /refresh, which calls jwt.sign and can
 * therefore throw when the secret is invalid.
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { UserService } from '../services/UserService';
import { database } from '../config/database';
import { config } from '../config';
import { createAuthRouter } from '../routes/auth';

jest.mock('../services/UserService');
jest.mock('../services/RbacService');
jest.mock('../config/database', () => ({
  database: { getPool: jest.fn().mockReturnValue({}) },
}));

import { RbacService } from '../services/RbacService';

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

const signToken = (payload: Record<string, unknown>) =>
  jwt.sign(payload, config.jwt.secret, { expiresIn: '1h' });

describe('POST /api/auth/refresh — jwt.sign throws', () => {
  beforeEach(() => {
    (UserService as jest.MockedClass<typeof UserService>).mockClear();
    (database.getPool as jest.Mock).mockReturnValue({});
    (RbacService.prototype.getEffectivePermissions as jest.Mock) = jest
      .fn()
      .mockResolvedValue([]);
    (RbacService.prototype.getUserRoles as jest.Mock) = jest.fn().mockResolvedValue([]);
  });

  it('returns 500 with REFRESH_ERROR when jwt.sign throws', async () => {
    (UserService.prototype.getUserById as jest.Mock) = jest
      .fn()
      .mockResolvedValue(makeUser());

    // Build the bearer token BEFORE spying, so signToken is unaffected.
    const token = signToken({ userId: 7, email: 'a@x.com', role: 'manager' });

    // Now make the next jwt.sign call (inside the /refresh handler) throw.
    const signSpy = jest.spyOn(jwt, 'sign').mockImplementationOnce(() => {
      throw new Error('sign failure');
    });

    const res = await request(buildApp())
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${token}`);

    signSpy.mockRestore();

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('REFRESH_ERROR');
    expect(res.body.error.message).toBe('sign failure');
  });
});
