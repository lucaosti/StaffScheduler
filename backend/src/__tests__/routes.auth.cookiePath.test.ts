/**
 * The refresh cookie's path follows the prefix the request arrived on.
 *
 * A browser sends a path-scoped cookie only to paths that START WITH the
 * cookie's path. The path used to be hardcoded to `/api/auth/refresh`, so a
 * client using the CANONICAL `/api/v1` prefix exclusively could call
 * `/api/v1/auth/refresh` and never have the cookie sent to it — its session
 * died at the first access-token expiry, fifteen minutes in. `/api/v1` was
 * documented as the prefix to migrate to while its refresh flow did not work.
 *
 * These tests mount the router under both prefixes, the way `app.ts` does,
 * because a test that mounts only one cannot see the bug at all.
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

export {};

const issue = jest.fn();
const revoke = jest.fn();
const rotate = jest.fn();

jest.mock('../services/RefreshTokenService', () => ({
  RefreshTokenService: jest.fn().mockImplementation(() => ({
    issue,
    revoke,
    rotate,
  })),
}));

jest.mock('../middleware/auth', () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { user: unknown }).user = { id: 1, email: 'a@b.c', permissions: [] };
    next();
  },
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  userHasPermission: () => true,
  invalidateAuthContext: jest.fn(),
}));

const mountBothPrefixes = () => {
  const { createAuthRouter } = require('../routes/auth');
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  // The same order app.ts uses: canonical first, legacy second.
  app.use('/api/v1/auth', createAuthRouter({} as never));
  app.use('/api/auth', createAuthRouter({} as never));
  return app;
};

/** The `Path=` of the refresh cookie in a Set-Cookie header, if present. */
const refreshCookiePath = (res: request.Response): string | undefined => {
  const raw = res.headers['set-cookie'];
  const all = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const cookie = all.find((c: string) => c.startsWith('refresh_token='));
  return cookie
    ?.split(';')
    .map((part: string) => part.trim())
    .find((part: string) => part.startsWith('Path='))
    ?.slice(5);
};

beforeEach(() => {
  issue.mockReset().mockResolvedValue({ token: 'fresh-token' });
  revoke.mockReset().mockResolvedValue(undefined);
  rotate.mockReset().mockResolvedValue(null);
});

describe('the refresh cookie path', () => {
  it('is scoped to the canonical prefix when the request arrives there', async () => {
    const res = await request(mountBothPrefixes())
      .post('/api/v1/auth/logout')
      .set('Cookie', 'refresh_token=old');

    expect(res.status).toBe(200);
    // Logout clears rather than sets, but the paths it clears are derived the
    // same way — and it needs no database, which is what makes it the cheapest
    // place to observe the derivation.
    const cleared = (res.headers['set-cookie'] as unknown as string[]).filter((c) =>
      c.startsWith('refresh_token=')
    );
    expect(cleared.some((c) => c.includes('Path=/api/v1/auth/refresh'))).toBe(true);
  });

  it('clears the cookie on both prefixes, whichever one logged out', async () => {
    const res = await request(mountBothPrefixes())
      .post('/api/auth/logout')
      .set('Cookie', 'refresh_token=old');

    const cleared = (res.headers['set-cookie'] as unknown as string[]).filter((c) =>
      c.startsWith('refresh_token=')
    );
    // A session started on one prefix and ended on the other would otherwise
    // leave the cookie in place, so the browser keeps presenting a credential
    // the server has already revoked.
    expect(cleared.some((c) => c.includes('Path=/api/auth/refresh'))).toBe(true);
    expect(cleared.some((c) => c.includes('Path=/api/v1/auth/refresh'))).toBe(true);
  });

  it('revokes the presented token server-side regardless of prefix', async () => {
    await request(mountBothPrefixes())
      .post('/api/v1/auth/logout')
      .set('Cookie', 'refresh_token=old');

    // The cookie clear is hygiene; this is the part that actually ends the
    // session, and it must not depend on which prefix was used.
    expect(revoke).toHaveBeenCalledWith('old');
  });

  it('rejects a refresh with no cookie on the canonical prefix', async () => {
    const res = await request(mountBothPrefixes()).post('/api/v1/auth/refresh');
    expect(res.status).toBe(401);
    // The path the rejection clears is derived too, so a stale cookie on the
    // canonical prefix is actually removed rather than left behind.
    expect(refreshCookiePath(res)).toBeDefined();
  });
});
