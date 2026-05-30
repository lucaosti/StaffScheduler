/**
 * Integration test for the /api/system/info route.
 *
 * The endpoint is administrative: it runs the real `authenticate` and
 * `requireAdmin` middleware. Tests sign a valid JWT and mock the UserService
 * so the middleware resolves an active admin user, then exercise both the
 * demo and production paths plus the failure fallback. A dedicated test
 * asserts that an unauthenticated request is rejected with 401.
 */

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createSystemRouter } from '../routes/system';
import { config } from '../config';
import { UserService } from '../services/UserService';
import { database } from '../config/database';

jest.mock('../services/UserService');
jest.mock('../config/database', () => ({
  database: { getPool: jest.fn().mockReturnValue({}) },
}));

type ExecuteResult = [unknown[], unknown];

const adminToken = jwt.sign(
  { userId: '1', email: 'admin@example', role: 'admin' },
  config.jwt.secret,
  { expiresIn: '1h' }
);

const buildApp = (executeImpl: jest.Mock): express.Express => {
  const fakePool = { execute: executeImpl } as unknown as Parameters<typeof createSystemRouter>[0];
  const app = express();
  app.use('/api/system', createSystemRouter(fakePool));
  return app;
};

const mockActiveAdmin = (): void => {
  (UserService.prototype.getUserById as jest.Mock) = jest
    .fn()
    .mockResolvedValue({ id: 1, email: 'admin@example', role: 'admin', isActive: true });
};

describe('GET /api/system/info', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (database.getPool as jest.Mock).mockReturnValue({});
    mockActiveAdmin();
  });

  it('rejects an unauthenticated request with 401', async () => {
    const execute = jest.fn<Promise<ExecuteResult>, [string, unknown[]?]>();
    const app = buildApp(execute);

    const res = await request(app).get('/api/system/info');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('MISSING_TOKEN');
    // The query must never run for an unauthenticated caller.
    expect(execute).not.toHaveBeenCalled();
  });

  it('reports mode=demo when system_settings has the demo row', async () => {
    const execute = jest.fn<Promise<ExecuteResult>, [string, unknown[]?]>();
    execute.mockResolvedValueOnce([[{ value: 'demo' }], null]);
    const app = buildApp(execute);

    const res = await request(app)
      .get('/api/system/info')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { mode: 'demo' } });
  });

  it('defaults to mode=production when no row is present', async () => {
    const execute = jest.fn<Promise<ExecuteResult>, [string, unknown[]?]>();
    execute.mockResolvedValueOnce([[], null]);
    const app = buildApp(execute);

    const res = await request(app)
      .get('/api/system/info')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { mode: 'production' } });
  });

  it('falls back to production when the database query fails', async () => {
    const execute = jest.fn<Promise<ExecuteResult>, [string, unknown[]?]>();
    execute.mockRejectedValueOnce(new Error('DB down'));
    const app = buildApp(execute);

    const res = await request(app)
      .get('/api/system/info')
      .set('Authorization', `Bearer ${adminToken}`);

    // The endpoint must never 500 — it falls back to production mode.
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { mode: 'production' } });
  });
});
