/**
 * SSO route tests (`routes/auth.ts`'s `/sso/*` endpoints) — the login
 * redirect, the callback's state/nonce handling and cookie behavior, and
 * that a disabled/unknown provider is refused before anything else runs.
 *
 * `SsoProviderService`/`SsoAuthService` are mocked; the cryptographic
 * verification itself is covered directly in `ssoAuth.service.test.ts`
 * against a real keypair — these tests are about the HTTP/cookie contract.
 */

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { createAuthRouter } from '../routes/auth';
import { config } from '../config';

jest.mock('../services/UserService');
jest.mock('../services/RbacService');
jest.mock('../services/RefreshTokenService');
jest.mock('../services/TwoFactorService');
jest.mock('../services/SsoProviderService');
jest.mock('../services/SsoAuthService');
// `SsoAuthService`'s real module (even auto-mocked) is loaded once to derive
// its shape, which transitively pulls in `jwks-rsa` → `jose`, an ESM package
// Jest's default CJS transform cannot parse. Short-circuiting `jwks-rsa`
// itself avoids that load entirely — the same fix `ssoAuth.service.test.ts`
// needs, for the same reason.
jest.mock('jwks-rsa', () => jest.fn());

import { SsoProviderService } from '../services/SsoProviderService';
import { SsoAuthService } from '../services/SsoAuthService';
import { RefreshTokenService } from '../services/RefreshTokenService';

const buildApp = (prefix = '/api/v1/auth') => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(prefix, createAuthRouter({} as never));
  return app;
};

const activeProvider = {
  id: 1,
  organizationName: null,
  name: 'Test IdP',
  issuer: 'https://idp.example.com',
  clientId: 'client-123',
  clientSecret: 'secret-abc',
  authorizationUrl: 'https://idp.example.com/authorize',
  tokenUrl: 'https://idp.example.com/token',
  jwksUrl: 'https://idp.example.com/jwks',
  isActive: true,
  jitProvisioningEnabled: false,
  defaultRoleId: null,
  createdAt: 'x',
  updatedAt: 'x',
};

/** Parses a Set-Cookie header value into { name, attributes }. */
const parseCookie = (raw: string) => {
  const [pair, ...attrs] = raw.split(';').map((s) => s.trim());
  const [name, value] = pair.split('=');
  return {
    name,
    value,
    attrs: attrs.map((a) => a.toLowerCase()),
  };
};

const cookiesFrom = (res: request.Response): ReturnType<typeof parseCookie>[] => {
  const raw = res.headers['set-cookie'];
  const all = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return all.map(parseCookie);
};

beforeEach(() => {
  jest.clearAllMocks();
  (RefreshTokenService.prototype.issue as jest.Mock) = jest.fn().mockResolvedValue({ token: 'refresh-tok' });
});

describe('GET /sso/providers', () => {
  it('lists public providers without exposing secrets', async () => {
    (SsoProviderService.prototype.listPublic as jest.Mock) = jest
      .fn()
      .mockResolvedValue([{ id: 1, name: 'Test IdP' }]);

    const res = await request(buildApp()).get('/api/v1/auth/sso/providers');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ id: 1, name: 'Test IdP' }]);
  });
});

describe('GET /sso/:id/login', () => {
  it('404s for an unknown provider', async () => {
    (SsoProviderService.prototype.getById as jest.Mock) = jest.fn().mockResolvedValue(null);
    const res = await request(buildApp()).get('/api/v1/auth/sso/99/login');
    expect(res.status).toBe(404);
  });

  it('404s for a provider that exists but is inactive', async () => {
    (SsoProviderService.prototype.getById as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ ...activeProvider, isActive: false });
    const res = await request(buildApp()).get('/api/v1/auth/sso/1/login');
    expect(res.status).toBe(404);
  });

  it('redirects to the identity provider and sets state/nonce cookies', async () => {
    (SsoProviderService.prototype.getById as jest.Mock) = jest.fn().mockResolvedValue(activeProvider);
    (SsoAuthService.prototype.buildAuthorizationUrl as jest.Mock) = jest
      .fn()
      .mockReturnValue('https://idp.example.com/authorize?state=abc');

    const res = await request(buildApp()).get('/api/v1/auth/sso/1/login');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://idp.example.com/authorize?state=abc');

    const cookies = cookiesFrom(res);
    const state = cookies.find((c) => c.name === 'sso_state');
    const nonce = cookies.find((c) => c.name === 'sso_nonce');
    expect(state).toBeDefined();
    expect(nonce).toBeDefined();
  });

  it('scopes the state/nonce cookies to this provider\'s own callback path, derived from the mount prefix', async () => {
    (SsoProviderService.prototype.getById as jest.Mock) = jest.fn().mockResolvedValue(activeProvider);
    (SsoAuthService.prototype.buildAuthorizationUrl as jest.Mock) = jest.fn().mockReturnValue('https://idp.example.com/authorize');

    const res = await request(buildApp()).get('/api/v1/auth/sso/1/login');
    const cookies = cookiesFrom(res);
    const state = cookies.find((c) => c.name === 'sso_state')!;
    expect(state.attrs).toContain('path=/api/v1/auth/sso/1/callback');
  });

  /**
   * The one property this whole flow depends on: a `SameSite=Strict` cookie
   * is never sent on the cross-site top-level redirect FROM the identity
   * provider back to `/callback`, so the login would fail 100% of the time
   * with a false "state mismatch" — indistinguishable from an actual CSRF
   * attempt. `Lax` is what makes the round trip actually work.
   */
  it('sets the state/nonce cookies as SameSite=Lax, not Strict', async () => {
    (SsoProviderService.prototype.getById as jest.Mock) = jest.fn().mockResolvedValue(activeProvider);
    (SsoAuthService.prototype.buildAuthorizationUrl as jest.Mock) = jest.fn().mockReturnValue('https://idp.example.com/authorize');

    const res = await request(buildApp()).get('/api/v1/auth/sso/1/login');
    const cookies = cookiesFrom(res);
    for (const name of ['sso_state', 'sso_nonce']) {
      const cookie = cookies.find((c) => c.name === name)!;
      expect(cookie.attrs).toContain('samesite=lax');
      expect(cookie.attrs).not.toContain('samesite=strict');
      expect(cookie.attrs).toContain('httponly');
    }
  });

  it('builds the authorization URL with a redirect_uri derived from the mount prefix', async () => {
    (SsoProviderService.prototype.getById as jest.Mock) = jest.fn().mockResolvedValue(activeProvider);
    const buildAuthorizationUrl = (SsoAuthService.prototype.buildAuthorizationUrl as jest.Mock) = jest
      .fn()
      .mockReturnValue('https://idp.example.com/authorize');

    await request(buildApp()).get('/api/v1/auth/sso/1/login');

    const [, redirectUri] = buildAuthorizationUrl.mock.calls[0];
    expect(redirectUri).toMatch(/\/api\/v1\/auth\/sso\/1\/callback$/);
  });
});

describe('GET /sso/:id/callback', () => {
  const withStateCookies = (req: request.Test, state: string, nonce: string) =>
    req.set('Cookie', [`sso_state=${state}`, `sso_nonce=${nonce}`]);

  it('404s for an unknown provider and still clears any state cookie', async () => {
    (SsoProviderService.prototype.getById as jest.Mock) = jest.fn().mockResolvedValue(null);
    const res = await withStateCookies(
      request(buildApp()).get('/api/v1/auth/sso/1/callback?code=abc&state=s1'),
      's1',
      'n1'
    );
    expect(res.status).toBe(404);
    const cleared = cookiesFrom(res).filter((c) => c.name === 'sso_state');
    expect(cleared.length).toBeGreaterThan(0);
  });

  it('400s when no code/state cookie was set (the callback was not started here)', async () => {
    (SsoProviderService.prototype.getById as jest.Mock) = jest.fn().mockResolvedValue(activeProvider);
    const res = await request(buildApp()).get('/api/v1/auth/sso/1/callback?code=abc&state=s1');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SSO_STATE_MISMATCH');
  });

  it('400s when the returned state does not match the cookie', async () => {
    (SsoProviderService.prototype.getById as jest.Mock) = jest.fn().mockResolvedValue(activeProvider);
    const res = await withStateCookies(
      request(buildApp()).get('/api/v1/auth/sso/1/callback?code=abc&state=attacker-state'),
      'real-state',
      'n1'
    );
    expect(res.status).toBe(400);
  });

  it('400s when no authorization code was returned', async () => {
    (SsoProviderService.prototype.getById as jest.Mock) = jest.fn().mockResolvedValue(activeProvider);
    const res = await withStateCookies(
      request(buildApp()).get('/api/v1/auth/sso/1/callback?state=s1'),
      's1',
      'n1'
    );
    expect(res.status).toBe(400);
  });

  it('clears the state/nonce cookies once the callback resolves, on both success and failure', async () => {
    (SsoProviderService.prototype.getById as jest.Mock) = jest.fn().mockResolvedValue(activeProvider);
    const res = await withStateCookies(
      request(buildApp()).get('/api/v1/auth/sso/1/callback?code=abc&state=wrong'),
      'real-state',
      'n1'
    );
    const cleared = cookiesFrom(res).filter((c) => c.name === 'sso_state' || c.name === 'sso_nonce');
    expect(cleared.length).toBe(2);
  });

  it('on success, exchanges the code, verifies the token, issues session cookies, and redirects to the frontend', async () => {
    (SsoProviderService.prototype.getById as jest.Mock) = jest.fn().mockResolvedValue(activeProvider);
    (SsoAuthService.prototype.exchangeCodeForIdToken as jest.Mock) = jest.fn().mockResolvedValue('id-token-xyz');
    (SsoAuthService.prototype.verifyIdToken as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ sub: 'idp-subject-1', email: 'anna@example.com' });
    (SsoAuthService.prototype.findOrCreateUser as jest.Mock) = jest
      .fn()
      .mockResolvedValue({ id: 42, email: 'anna@example.com', isActive: true });

    const res = await withStateCookies(
      request(buildApp()).get('/api/v1/auth/sso/1/callback?code=auth-code&state=s1'),
      's1',
      'n1'
    );

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(config.cors.origin);

    expect(SsoAuthService.prototype.exchangeCodeForIdToken).toHaveBeenCalledWith(
      activeProvider,
      'auth-code',
      expect.stringMatching(/\/api\/v1\/auth\/sso\/1\/callback$/)
    );
    expect(SsoAuthService.prototype.verifyIdToken).toHaveBeenCalledWith(activeProvider, 'id-token-xyz', 'n1');

    // The same session cookie a password login issues.
    const cookies = cookiesFrom(res);
    expect(cookies.some((c) => c.name === 'token')).toBe(true);
    expect(cookies.some((c) => c.name === 'refresh_token')).toBe(true);
  });

  it('propagates a rejection (e.g. nonce mismatch) to the central error handler rather than issuing a session', async () => {
    (SsoProviderService.prototype.getById as jest.Mock) = jest.fn().mockResolvedValue(activeProvider);
    (SsoAuthService.prototype.exchangeCodeForIdToken as jest.Mock) = jest.fn().mockResolvedValue('id-token-xyz');
    (SsoAuthService.prototype.verifyIdToken as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new (require('../errors').ConflictError)('ID token nonce did not match the login attempt'));

    // Express 5 forwards a rejected async handler on its own; no explicit
    // errorHandler is mounted in this bare test app, so the framework's
    // default error handling takes over — asserting only that no 302/200
    // "success" response was produced is enough to prove the branch was
    // reached and no session was issued.
    const res = await withStateCookies(
      request(buildApp()).get('/api/v1/auth/sso/1/callback?code=auth-code&state=s1'),
      's1',
      'n1'
    );

    expect(res.status).not.toBe(302);
    const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
    expect(setCookie?.some((c) => c.startsWith('token=')) ?? false).toBe(false);
  });
});
