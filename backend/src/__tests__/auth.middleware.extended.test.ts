/**
 * Extended auth middleware tests — covers:
 *   - The outer catch in `authenticate`: when `getUserById` throws (not just
 *     returns null), the middleware returns 500 AUTH_ERROR.
 *   - `requireRole` called without a preceding `authenticate`: `req.user` is
 *     undefined, so the middleware returns 401 UNAUTHORIZED.
 */

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { authenticate, requireRole } from '../middleware/auth';
import { config } from '../config';
import { UserService } from '../services/UserService';
import { database } from '../config/database';

jest.mock('../services/UserService');
jest.mock('../config/database', () => ({
  database: { getPool: jest.fn().mockReturnValue({}) },
}));

const signToken = (payload: Record<string, unknown>) => jwt.sign(payload, config.jwt.secret, { expiresIn: '1h' });

describe('authenticate — outer catch returns 500 AUTH_ERROR', () => {
  beforeEach(() => {
    (UserService as jest.MockedClass<typeof UserService>).mockClear();
    (database.getPool as jest.Mock).mockReturnValue({});
  });

  it('returns 500 AUTH_ERROR when getUserById throws', async () => {
    (UserService.prototype.getUserById as jest.Mock) = jest.fn().mockRejectedValue(new Error('DB connection lost'));

    const app = express();
    app.use(express.json());
    app.get('/protected', authenticate, (_req, res) => {
      res.json({ success: true });
    });

    const token = signToken({ userId: 1, email: 'a@x', role: 'admin' });
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('AUTH_ERROR');
  });
});

describe('requireRole — returns 401 UNAUTHORIZED when req.user is not set', () => {
  it('returns 401 when the route has no authenticate middleware before it', async () => {
    const app = express();
    app.use(express.json());
    // requireRole is mounted directly without authenticate — req.user stays undefined.
    app.get('/admin-only', requireRole(['admin']), (_req, res) => {
      res.json({ success: true });
    });

    const res = await request(app).get('/admin-only');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});

