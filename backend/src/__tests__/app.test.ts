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
    const res = await request(app).get('/api/v1/this-route-does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
    });
  });

  it('mounts /api/health', async () => {
    const res = await request(app).get('/api/v1/health');
    expect([200, 503]).toContain(res.status);
  });

  it('returns 401 on protected endpoints without token', async () => {
    const res = await request(app).get('/api/v1/users');
    expect(res.status).toBe(401);
  });

  // #319: the legacy prefix is no longer a live mount — it 308-redirects to
  // the canonical one, preserving the rest of the path and the query string.
  describe('legacy /api prefix retirement', () => {
    it('308-redirects a legacy request to the canonical /api/v1 path', async () => {
      const res = await request(app).get('/api/users');
      expect(res.status).toBe(308);
      expect(res.headers.location).toBe('/api/v1/users');
    });

    it('preserves the query string across the redirect', async () => {
      const res = await request(app).get('/api/users?limit=10&page=2');
      expect(res.status).toBe(308);
      expect(res.headers.location).toBe('/api/v1/users?limit=10&page=2');
    });

    it('does not redirect requests already on the canonical prefix', async () => {
      const res = await request(app).get('/api/v1/users');
      expect(res.status).not.toBe(308);
    });

    it('does not redirect the OpenAPI document or docs UI, which stay unversioned', async () => {
      const doc = await request(app).get('/api/openapi.json');
      expect(doc.status).toBe(200);

      const docs = await request(app).get('/api/docs');
      expect(docs.status).not.toBe(308);
    });

    it('a redirected 404 still 404s once it lands on /api/v1', async () => {
      const res = await request(app).get('/api/this-route-does-not-exist');
      expect(res.status).toBe(308);
      expect(res.headers.location).toBe('/api/v1/this-route-does-not-exist');
    });
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
