/**
 * Security hardening tests (issue #97).
 *
 * Covers:
 *   - Helmet security headers (CSP, X-Frame-Options, HSTS)
 *   - Rate limiter returns 429 JSON after max+1 requests
 *   - Body parser rejects payloads over 10 MB with 413
 */

import express from 'express';
import request from 'supertest';
import { createFixedWindowLimiter } from '../middleware/rateLimit';

jest.mock('../config/database', () => ({
  __esModule: true,
  default: { isHealthy: jest.fn().mockResolvedValue(true), getPool: jest.fn() },
  database: { isHealthy: jest.fn().mockResolvedValue(true), getPool: jest.fn() },
}));

import { buildApp } from '../app';

const fakePool = {
  execute: jest.fn().mockResolvedValue([[], null]),
  getConnection: jest.fn(),
} as never;

// ──────────────────────────────────────────────────────────────────────────────
// Security headers
// ──────────────────────────────────────────────────────────────────────────────

describe('security headers', () => {
  const app = buildApp(fakePool, { silent: true });

  it('includes Content-Security-Policy header', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
  });

  it('includes X-Frame-Options: DENY header', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('includes Strict-Transport-Security header', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
  });

  it('includes X-Content-Type-Options: nosniff', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Rate limiter
// ──────────────────────────────────────────────────────────────────────────────

describe('rate limiter', () => {
  // These used to configure their own `express-rate-limit` instances, which
  // tested the library rather than this system — and kept passing after the
  // limiter was replaced. They now exercise the middleware the app actually
  // mounts.
  const appWith = (limit: number) => {
    const testApp = express();
    testApp.use(
      createFixedWindowLimiter({
        windowMs: 60_000,
        limit: () => limit,
        key: async () => ({ key: `test:${keyCounter}`, kind: 'ip' }),
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests, please try again later.',
      })
    );
    testApp.get('/', (_req, res) => res.status(200).json({ ok: true }));
    return testApp;
  };

  // A fresh key per case: the counter store is shared process-wide, so cases
  // reusing one key would count each other's requests.
  let keyCounter = 0;
  beforeEach(() => {
    keyCounter += 1;
  });

  it('returns 429 JSON after the budget is exhausted', async () => {
    const testApp = appWith(2);

    await request(testApp).get('/');
    await request(testApp).get('/');
    const blocked = await request(testApp).get('/');

    expect(blocked.status).toBe(429);
    expect(blocked.body.success).toBe(false);
    expect(blocked.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('sends Retry-After with the 429, so a client knows when to come back', async () => {
    const testApp = appWith(1);
    await request(testApp).get('/');
    const blocked = await request(testApp).get('/');

    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('includes the standard RateLimit headers on an admitted request', async () => {
    const res = await request(appWith(5)).get('/');

    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('5');
    expect(res.headers['ratelimit-remaining']).toBe('4');
  });

  it('counts down as the budget is spent', async () => {
    const testApp = appWith(3);
    await request(testApp).get('/');
    const second = await request(testApp).get('/');

    expect(second.headers['ratelimit-remaining']).toBe('1');
  });

  it('admits the request when its own key resolution fails', async () => {
    // A limiter that 500s when its store is unavailable takes the API down to
    // enforce a budget — worse than the burst it was preventing.
    const testApp = express();
    testApp.use(
      createFixedWindowLimiter({
        windowMs: 60_000,
        limit: () => 1,
        key: async () => {
          throw new Error('store unavailable');
        },
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests, please try again later.',
      })
    );
    testApp.get('/', (_req, res) => res.status(200).json({ ok: true }));

    const res = await request(testApp).get('/');
    expect(res.status).toBe(200);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Body size limit
// ──────────────────────────────────────────────────────────────────────────────

describe('body size limit', () => {
  it('rejects payload over 10 MB with 413', async () => {
    const testApp = express();
    testApp.use(express.json({ limit: '10mb' }));
    testApp.post('/', (_req, res) => res.json({ ok: true }));

    const bigPayload = 'x'.repeat(11 * 1024 * 1024);
    const res = await request(testApp)
      .post('/')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ data: bigPayload }));

    expect(res.status).toBe(413);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CORS
// ──────────────────────────────────────────────────────────────────────────────

describe('CORS', () => {
  it('denies preflight from an unlisted origin', async () => {
    const testApp = express();
    testApp.use(
      require('cors')({
        origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
          if (!origin) return cb(null, true);
          if (origin === 'http://allowed.example.com') return cb(null, true);
          return cb(new Error('Not allowed by CORS'));
        },
        credentials: true,
      })
    );
    testApp.use(
      (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: err.message } });
      }
    );
    testApp.options('/test', (_req, res) => res.sendStatus(200));

    const res = await request(testApp)
      .options('/test')
      .set('Origin', 'http://evil.example.com')
      .set('Access-Control-Request-Method', 'GET');

    expect([403, 500]).toContain(res.status);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
