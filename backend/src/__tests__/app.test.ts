/**
 * Verifies the Express factory mounts every router and exposes the
 * expected error/404 contracts. Routers are exercised via Supertest and
 * a minimal mock pool — actual data-layer tests live elsewhere.
 *
 * @author Luca Ostinelli
 */

import request from 'supertest';
import type { Pool } from 'mysql2/promise';

jest.mock('../config/database', () => ({
  __esModule: true,
  default: {
    isHealthy: jest.fn().mockResolvedValue(true),
    getPool: jest.fn(),
  },
  database: {
    isHealthy: jest.fn().mockResolvedValue(true),
    getPool: jest.fn(),
  },
}));

import { buildApp } from '../app';

const fakePool = {
  execute: jest.fn().mockResolvedValue([[], null]),
  getConnection: jest.fn(),
} as unknown as Pool;

describe('buildApp', () => {
  const app = buildApp(fakePool, { silent: true });

  it('exposes the OpenAPI document', async () => {
    const res = await request(app).get('/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBeDefined();
  });

  it('rejects unknown endpoints with 404 envelope', async () => {
    const res = await request(app).get('/api/this-route-does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
    });
  });

  it('mounts /api/health', async () => {
    const res = await request(app).get('/api/health');
    expect([200, 503]).toContain(res.status);
  });

  it('returns 401 on protected endpoints without token', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401);
  });

  it('handles malformed JSON with the error envelope', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{not-json');
    expect([400, 500]).toContain(res.status);
    expect(res.body.success).toBe(false);
  });
});
