/**
 * Auth route error-path test.
 *
 * The refresh endpoint no longer has a bespoke try/catch: it uses asyncHandler,
 * so an unexpected fault (here, jwt.sign throwing while minting the new access
 * token during an otherwise-valid rotation) propagates to the central error
 * middleware and surfaces as a 500 INTERNAL_ERROR — not a leaked stack. This
 * pins that contract.
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { UserService } from '../services/UserService';
import { createAuthRouter } from '../routes/auth';
import { errorHandler } from '../middleware/errorHandler';

jest.mock('../services/UserService');
jest.mock('../services/RbacService');
jest.mock('../services/RefreshTokenService');
jest.mock('../config/database', () => ({
  database: { getPool: jest.fn().mockReturnValue({}) },
}));

import { RbacService } from '../services/RbacService';
import { RefreshTokenService } from '../services/RefreshTokenService';

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', createAuthRouter({} as never));
  app.use(errorHandler);
  return app;
};

describe('POST /api/auth/refresh — unexpected fault', () => {
  beforeEach(() => {
    (RbacService.prototype.getEffectivePermissions as jest.Mock) = jest.fn().mockResolvedValue([]);
    (RbacService.prototype.getUserRoles as jest.Mock) = jest.fn().mockResolvedValue([]);
    (UserService.prototype.getUserById as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 7, email: 'a@x.com', firstName: 'A', lastName: 'B', isActive: true });
    (RefreshTokenService.prototype.rotate as jest.Mock) = jest.fn().mockResolvedValue({
      userId: 7,
      issued: { token: 'new-refresh', expiresAt: new Date(Date.now() + 1000) },
    });
  });

  it('returns 500 INTERNAL_ERROR when minting the access token throws', async () => {
    const signSpy = jest.spyOn(jwt, 'sign').mockImplementationOnce(() => {
      throw new Error('sign failure');
    });

    const res = await request(buildApp())
      .post('/api/auth/refresh')
      .set('Cookie', 'refresh_token=valid');

    signSpy.mockRestore();

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});
