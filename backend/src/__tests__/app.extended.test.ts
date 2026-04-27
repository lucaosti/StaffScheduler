/**
 * Extended app.ts tests — covers:
 *   - CORS callback: development origin (localhost) is allowed, the
 *     configured CORS_ORIGIN is allowed, any other origin is rejected.
 *   - Non-silent build: rate-limiter and morgan are applied when
 *     `options.silent` is false/omitted.
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
import { config } from '../config';

const fakePool = {
  execute: jest.fn().mockResolvedValue([[], null]),
  getConnection: jest.fn(),
} as unknown as Pool;

describe('buildApp CORS callback', () => {
  // Use a known non-localhost origin that differs from the configured one.
  const foreignOrigin = 'https://evil.example.com';

  it('allows requests with no origin (e.g. server-to-server)', async () => {
    const app = buildApp(fakePool, { silent: true });
    // Supertest sends no Origin header by default.
    const res = await request(app).get('/api/health');
    expect([200, 503]).toContain(res.status);
    // When no Origin header is sent, the cors middleware does not add
    // Access-Control-Allow-Origin, which is the correct CORS behaviour.
    // The response should simply succeed (not be rejected).
  });

  it('allows the configured CORS_ORIGIN', async () => {
    const app = buildApp(fakePool, { silent: true });
    const res = await request(app).get('/api/health').set('Origin', config.cors.origin);
    expect([200, 503]).toContain(res.status);
    expect(res.headers['access-control-allow-origin']).toBe(config.cors.origin);
  });

  it('rejects an unknown non-localhost origin with a CORS error', async () => {
    // Temporarily set env to production so the "localhost" fast-path is skipped.
    const original = config.server.env;
    (config.server as any).env = 'production';
    try {
      const app = buildApp(fakePool, { silent: true });
      const res = await request(app).get('/api/health').set('Origin', foreignOrigin);
      // Express/cors send a 500 with 'Not allowed by CORS' when the callback
      // passes an Error, or just omit the Allow-Origin header.
      expect([500, 200, 503]).toContain(res.status);
      if (res.status === 500) {
        expect(res.text).toContain('Not allowed by CORS');
      } else {
        expect(res.headers['access-control-allow-origin']).toBeUndefined();
      }
    } finally {
      (config.server as any).env = original;
    }
  });

  it('allows localhost origins in development mode', async () => {
    const original = config.server.env;
    (config.server as any).env = 'development';
    try {
      const app = buildApp(fakePool, { silent: true });
      const res = await request(app).get('/api/health').set('Origin', 'http://localhost:4000');
      expect([200, 503]).toContain(res.status);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:4000');
    } finally {
      (config.server as any).env = original;
    }
  });
});

describe('buildApp non-silent mode', () => {
  it('builds the app without throwing when silent is false', async () => {
    // Simply constructing the app and making one request should succeed —
    // this exercises the limiter + morgan setup paths.
    const app = buildApp(fakePool, { silent: false });
    const res = await request(app).get('/api/health');
    expect([200, 503]).toContain(res.status);
  });
});

