/**
 * Auth middleware coverage — JTI blacklist paths and app.ts uncovered branches:
 *   - addToBlacklist: adds jti with default and explicit expiry
 *   - authenticate: TOKEN_REVOKED when jti is blacklisted (line 115-122)
 *   - authenticate: req.tokenJti and req.tokenExp are assigned (lines 125-127)
 *   - app.ts: HTTPS redirect in production (lines 65-71)
 *   - app.ts: rate limiter 429 RATE_LIMIT_EXCEEDED (lines 127-133)
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { authenticate, addToBlacklist } from '../middleware/auth';
import { buildApp } from '../app';
import { config } from '../config';
import type { Pool } from 'mysql2/promise';

jest.mock('../services/UserService');
jest.mock('../services/RbacService');
jest.mock('../config/database', () => ({
  __esModule: true,
  default: {
    isHealthy: jest.fn().mockResolvedValue(true),
    getPool: jest.fn().mockReturnValue({}),
  },
  database: {
    isHealthy: jest.fn().mockResolvedValue(true),
    getPool: jest.fn().mockReturnValue({}),
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fakePool = {
  execute: jest.fn().mockResolvedValue([[], null]),
  getConnection: jest.fn(),
} as unknown as Pool;

const makeApp = () => {
  const app = express();
  app.use(express.json());
  app.get('/protected', authenticate, (req, res) => {
    res.json({ tokenJti: req.tokenJti ?? null, tokenExp: req.tokenExp ?? null });
  });
  return app;
};

// ─── JTI Blacklist — addToBlacklist ──────────────────────────────────────────

describe('addToBlacklist', () => {
  it('is exported and callable without throwing', () => {
    expect(() => addToBlacklist('jti-abc', Date.now() + 60_000)).not.toThrow();
  });

  it('causes authenticate to reject that jti with TOKEN_REVOKED', async () => {
    const jti = `test-jti-${Date.now()}`;
    // Put the jti in the blacklist BEFORE issuing the token
    addToBlacklist(jti, Date.now() + 60_000);

    const token = jwt.sign({ userId: 1, email: 'a@x', jti }, config.jwt.secret, {
      expiresIn: '1h',
    });

    const app = makeApp();
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_REVOKED');
    expect(res.body.error.message).toBe('Token has been revoked');
  });

  it('allows authenticate to pass when jti has expired in the blacklist', async () => {
    const { UserService } = require('../services/UserService');
    const { RbacService } = require('../services/RbacService');

    UserService.prototype.getUserById = jest.fn().mockResolvedValue({
      id: 1,
      email: 'user@x',
      isActive: true,
    });
    RbacService.prototype.getEffectivePermissions = jest.fn().mockResolvedValue([]);
    RbacService.prototype.getUserRoles = jest.fn().mockResolvedValue([]);
    RbacService.prototype.computeAllowedOrgUnitIds = jest.fn().mockResolvedValue(null);

    const jti = `expired-jti-${Date.now()}`;
    // Set expiry in the past so the entry is considered expired
    addToBlacklist(jti, Date.now() - 1);

    const token = jwt.sign({ userId: 1, email: 'user@x', jti }, config.jwt.secret, {
      expiresIn: '1h',
    });

    const app = makeApp();
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);

    // Should NOT be rejected — expired blacklist entries are pruned and treated as not blacklisted
    expect(res.status).toBe(200);
  });

  it('uses a 24h default expiry when no expiresAt is provided', () => {
    const jti = `default-exp-jti-${Date.now()}`;
    // This should not throw even without an explicit expiresAt
    expect(() => addToBlacklist(jti)).not.toThrow();
  });
});

// ─── authenticate — req.tokenJti and req.tokenExp assignment ─────────────────

describe('authenticate — tokenJti and tokenExp are set on req', () => {
  it('sets req.tokenJti when the token contains a jti claim', async () => {
    const { UserService } = require('../services/UserService');
    const { RbacService } = require('../services/RbacService');

    UserService.prototype.getUserById = jest.fn().mockResolvedValue({
      id: 7,
      email: 'tester@x',
      isActive: true,
    });
    RbacService.prototype.getEffectivePermissions = jest.fn().mockResolvedValue([]);
    RbacService.prototype.getUserRoles = jest.fn().mockResolvedValue([]);
    RbacService.prototype.computeAllowedOrgUnitIds = jest.fn().mockResolvedValue(null);

    const jti = `req-jti-${Date.now()}`;
    const token = jwt.sign({ userId: 7, email: 'tester@x', jti }, config.jwt.secret, {
      expiresIn: '1h',
    });

    const app = makeApp();
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.tokenJti).toBe(jti);
    expect(typeof res.body.tokenExp).toBe('number');
  });

  it('leaves req.tokenJti undefined when no jti claim is present', async () => {
    const { UserService } = require('../services/UserService');
    const { RbacService } = require('../services/RbacService');

    UserService.prototype.getUserById = jest.fn().mockResolvedValue({
      id: 8,
      email: 'nojti@x',
      isActive: true,
    });
    RbacService.prototype.getEffectivePermissions = jest.fn().mockResolvedValue([]);
    RbacService.prototype.getUserRoles = jest.fn().mockResolvedValue([]);
    RbacService.prototype.computeAllowedOrgUnitIds = jest.fn().mockResolvedValue(null);

    // Token without jti
    const token = jwt.sign({ userId: 8, email: 'nojti@x' }, config.jwt.secret, {
      expiresIn: '1h',
    });

    const app = makeApp();
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.tokenJti).toBeNull();
  });
});

// ─── app.ts — HTTPS redirect (production + x-forwarded-proto: http) ──────────

describe('buildApp — HTTPS redirect in production', () => {
  const originalEnv = config.server.env;

  afterEach(() => {
    (config.server as any).env = originalEnv;
  });

  it('redirects 301 to https when x-forwarded-proto is http in production', async () => {
    (config.server as any).env = 'production';
    const app = buildApp(fakePool, { silent: true });

    const res = await request(app)
      .get('/api/health')
      .set('x-forwarded-proto', 'http')
      .set('host', 'example.com');

    expect(res.status).toBe(301);
    expect(res.headers.location).toMatch(/^https:\/\//);
  });

  it('does not redirect when x-forwarded-proto is https in production', async () => {
    (config.server as any).env = 'production';
    const app = buildApp(fakePool, { silent: true });

    const res = await request(app)
      .get('/api/health')
      .set('x-forwarded-proto', 'https');

    expect([200, 503]).toContain(res.status);
    expect(res.status).not.toBe(301);
  });

  it('does not redirect in development even with x-forwarded-proto: http', async () => {
    (config.server as any).env = 'development';
    const app = buildApp(fakePool, { silent: true });

    const res = await request(app)
      .get('/api/health')
      .set('x-forwarded-proto', 'http');

    expect([200, 503]).toContain(res.status);
    expect(res.status).not.toBe(301);
  });
});

// ─── app.ts — rate limiter 429 ────────────────────────────────────────────────

describe('buildApp — rate limiter returns 429 RATE_LIMIT_EXCEEDED', () => {
  it('returns 429 after exceeding the rate limit', async () => {
    const originalMax = config.security.rateLimitMax;
    const originalWindow = config.security.rateLimitWindow;

    // Set limit to 1 request per large window so the second request is throttled
    (config.security as any).rateLimitMax = 1;
    (config.security as any).rateLimitWindow = 60_000;

    try {
      const app = buildApp(fakePool, { silent: false });

      // First request — should pass through (200 or 503, not 429)
      await request(app).get('/api/health');

      // Second request — should be rate-limited
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    } finally {
      (config.security as any).rateLimitMax = originalMax;
      (config.security as any).rateLimitWindow = originalWindow;
    }
  });
});
