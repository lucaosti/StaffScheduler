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

describe('rate limiter (config-driven)', () => {
  it('uses config.security.rateLimitWindow / rateLimitMax', async () => {
    const previousMax = process.env.RATE_LIMIT_MAX_REQUESTS;
    const previousWindow = process.env.RATE_LIMIT_WINDOW_MS;
    process.env.RATE_LIMIT_MAX_REQUESTS = '2';
    process.env.RATE_LIMIT_WINDOW_MS = '60000';

    jest.resetModules();
    const { buildApp: buildAppFresh } = await import('../app');
    const limitedApp = buildAppFresh(fakePool); // not silent → limiter active

    const r1 = await request(limitedApp).get('/api/health');
    const r2 = await request(limitedApp).get('/api/health');
    const r3 = await request(limitedApp).get('/api/health');

    expect([200, 503]).toContain(r1.status);
    expect([200, 503]).toContain(r2.status);
    expect(r3.status).toBe(429);

    if (previousMax === undefined) {
      delete process.env.RATE_LIMIT_MAX_REQUESTS;
    } else {
      process.env.RATE_LIMIT_MAX_REQUESTS = previousMax;
    }
    if (previousWindow === undefined) {
      delete process.env.RATE_LIMIT_WINDOW_MS;
    } else {
      process.env.RATE_LIMIT_WINDOW_MS = previousWindow;
    }
  });
});
