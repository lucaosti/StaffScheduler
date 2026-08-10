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

import { buildApp, redactTokenFromUrl } from '../app';
import { config } from '../config';
import { logger } from '../config/logger';

describe('redactTokenFromUrl', () => {
  it('redacts a token query value', () => {
    expect(redactTokenFromUrl('/calendar/feed?token=abc123&format=ics')).toBe(
      '/calendar/feed?token=[REDACTED]&format=ics'
    );
  });

  it('leaves a URL with no token untouched', () => {
    expect(redactTokenFromUrl('/api/v1/health')).toBe('/api/v1/health');
  });

  it('returns an empty string when the URL is undefined', () => {
    expect(redactTokenFromUrl(undefined)).toBe('');
  });
});

const fakePool = {
  execute: jest.fn().mockResolvedValue([[], null]),
  getConnection: jest.fn(),
} as unknown as Pool;

describe('buildApp with no options', () => {
  it('builds successfully when the options argument is omitted entirely', async () => {
    const app = buildApp(fakePool);
    const res = await request(app).get('/api/v1/health');
    expect([200, 503]).toContain(res.status);
  });
});

describe('buildApp CORS callback', () => {
  // Use a known non-localhost origin that differs from the configured one.
  const foreignOrigin = 'https://evil.example.com';

  it('allows requests with no origin (e.g. server-to-server)', async () => {
    const app = buildApp(fakePool, { silent: true });
    // Supertest sends no Origin header by default.
    const res = await request(app).get('/api/v1/health');
    expect([200, 503]).toContain(res.status);
    // When no Origin header is sent, the cors middleware does not add
    // Access-Control-Allow-Origin, which is the correct CORS behaviour.
    // The response should simply succeed (not be rejected).
  });

  it('allows requests with no origin in production (container healthchecks, curl)', async () => {
    const original = config.server.env;
    (config.server as any).env = 'production';
    try {
      const app = buildApp(fakePool, { silent: true });
      const res = await request(app).get('/api/v1/health');
      expect([200, 503]).toContain(res.status);
    } finally {
      (config.server as any).env = original;
    }
  });

  it('allows the configured CORS_ORIGIN', async () => {
    const app = buildApp(fakePool, { silent: true });
    const res = await request(app).get('/api/v1/health').set('Origin', config.cors.origin);
    expect([200, 503]).toContain(res.status);
    expect(res.headers['access-control-allow-origin']).toBe(config.cors.origin);
  });

  it('rejects an unknown non-localhost origin with a CORS error', async () => {
    // Temporarily set env to production so the "localhost" fast-path is skipped.
    const original = config.server.env;
    (config.server as any).env = 'production';
    try {
      const app = buildApp(fakePool, { silent: true });
      const res = await request(app).get('/api/v1/health').set('Origin', foreignOrigin);
      // Express/cors send a 500 when the callback passes an Error (the body
      // is the masked production envelope), or just omit the Allow-Origin header.
      expect([500, 200, 503]).toContain(res.status);
      if (res.status === 500) {
        expect(res.body).toEqual({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'An internal error occurred' },
        });
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
      const res = await request(app).get('/api/v1/health').set('Origin', 'http://localhost:4000');
      expect([200, 503]).toContain(res.status);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:4000');
    } finally {
      (config.server as any).env = original;
    }
  });

  it('allows 127.0.0.1 origins in development mode', async () => {
    const original = config.server.env;
    (config.server as any).env = 'development';
    try {
      const app = buildApp(fakePool, { silent: true });
      const res = await request(app).get('/api/v1/health').set('Origin', 'http://127.0.0.1:4000');
      expect([200, 503]).toContain(res.status);
      expect(res.headers['access-control-allow-origin']).toBe('http://127.0.0.1:4000');
    } finally {
      (config.server as any).env = original;
    }
  });

  it('falls through to the exact-origin check when the Origin header is unparseable', async () => {
    const original = config.server.env;
    (config.server as any).env = 'development';
    try {
      const app = buildApp(fakePool, { silent: true });
      const res = await request(app).get('/api/v1/health').set('Origin', 'not-a-valid-origin');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      (config.server as any).env = original;
    }
  });
});

describe('buildApp production HTTPS redirect', () => {
  it('301s a plain-HTTP request forwarded by the reverse proxy to HTTPS', async () => {
    const original = config.server.env;
    (config.server as any).env = 'production';
    try {
      const app = buildApp(fakePool, { silent: true });
      const res = await request(app)
        .get('/api/v1/health')
        .set('X-Forwarded-Proto', 'http')
        .set('Host', 'app.example.com')
        .redirects(0);
      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('https://app.example.com/api/v1/health');
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
    const res = await request(app).get('/api/v1/health');
    expect([200, 503]).toContain(res.status);
  });

  it('redacts a ?token= query parameter from the access log', async () => {
    const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => logger);
    try {
      const app = buildApp(fakePool, { silent: false });
      await request(app).get('/api/v1/health?token=super-secret');

      const loggedLine = infoSpy.mock.calls.map((call) => String(call[0])).find((line) => line.includes('/api/v1/health'));
      expect(loggedLine).toBeDefined();
      expect(loggedLine).not.toContain('super-secret');
      expect(loggedLine).toContain('token=[REDACTED]');
    } finally {
      infoSpy.mockRestore();
    }
  });
});

