/**
 * Extended auth middleware tests — covers:
 *   - The outer catch in `authenticate`: when `getUserById` throws (not just
 *     returns null), the middleware returns 500 AUTH_ERROR.
 *   - `requirePermission` called without a preceding `authenticate`: `req.user`
 *     is undefined, so the middleware returns 401 UNAUTHORIZED.
 */

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { authenticate, requirePermission } from '../middleware/auth';
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

    const token = signToken({ userId: 1, email: 'a@x' });
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('AUTH_ERROR');
  });
});

/**
 * An outage is not a broken session (#968). With MySQL down every
 * authenticated request used to answer 500 AUTH_ERROR, which a client cannot
 * tell from a fault in its own credentials; the frontend's refresh logic may
 * then sign the person out. A driver connectivity error answers 503
 * SERVICE_UNAVAILABLE with Retry-After instead — transient, retry later.
 */
describe('authenticate — infrastructure failure answers 503 (#968)', () => {
  const app = () => {
    const a = express();
    a.get('/protected', authenticate, (_req, res) => {
      res.json({ success: true });
    });
    return a;
  };
  const token = () => signToken({ userId: 1, email: 'a@x' });

  it.each([
    ['ECONNREFUSED', { code: 'ECONNREFUSED', errno: -111 }],
    ['PROTOCOL_CONNECTION_LOST', { code: 'PROTOCOL_CONNECTION_LOST', fatal: true }],
    ['ETIMEDOUT', { code: 'ETIMEDOUT' }],
    ['ER_CON_COUNT_ERROR', { code: 'ER_CON_COUNT_ERROR', errno: 1040 }],
  ])('answers 503 SERVICE_UNAVAILABLE with Retry-After when loading the user fails with %s', async (_name, props) => {
    (UserService.prototype.getUserById as jest.Mock) = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error('database unreachable'), props));

    const res = await request(app()).get('/protected').set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: expect.any(String) },
    });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('still answers 500 AUTH_ERROR for a failure that is not the infrastructure', async () => {
    (UserService.prototype.getUserById as jest.Mock) = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error('Unknown column'), { code: 'ER_BAD_FIELD_ERROR', errno: 1054 }));

    const res = await request(app()).get('/protected').set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('AUTH_ERROR');
  });
});

describe('requirePermission — returns 401 UNAUTHORIZED when req.user is not set', () => {
  it('returns 401 when the route has no authenticate middleware before it', async () => {
    const app = express();
    app.use(express.json());
    // requirePermission is mounted directly without authenticate — req.user stays undefined.
    app.get('/admin-only', requirePermission('settings.manage'), (_req, res) => {
      res.json({ success: true });
    });

    const res = await request(app).get('/admin-only');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});

