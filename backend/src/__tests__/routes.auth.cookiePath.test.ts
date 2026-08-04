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
 * Since #319, `/api/v1` is the ONLY prefix this router is actually mounted
 * at — `app.ts` 308-redirects the legacy `/api` there rather than mounting
 * the router a second time — so these tests exercise that one mount, kept
 * deriving the path from `req.baseUrl` rather than hardcoding it so this
 * stays correct if the mount point ever changes again.
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

const mountCanonicalPrefix = () => {
  const { createAuthRouter } = require('../routes/auth');
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/auth', createAuthRouter({} as never));
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
    const res = await request(mountCanonicalPrefix())
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

  it('also clears the legacy hardcoded path, as one-time migration hygiene', async () => {
    const res = await request(mountCanonicalPrefix())
      .post('/api/v1/auth/logout')
      .set('Cookie', 'refresh_token=old');

    const cleared = (res.headers['set-cookie'] as unknown as string[]).filter((c) =>
      c.startsWith('refresh_token=')
    );
    // A session whose cookie was set before #319 retired the legacy mount
    // still has it stored at the old hardcoded path; clearing it here means
    // that stale cookie doesn't linger forever.
    expect(cleared.some((c) => c.includes('Path=/api/auth/refresh'))).toBe(true);
  });

  it('revokes the presented token server-side', async () => {
    await request(mountCanonicalPrefix())
      .post('/api/v1/auth/logout')
      .set('Cookie', 'refresh_token=old');

    expect(revoke).toHaveBeenCalledWith('old');
  });

  it('rejects a refresh with no cookie on the canonical prefix', async () => {
    const res = await request(mountCanonicalPrefix()).post('/api/v1/auth/refresh');
    expect(res.status).toBe(401);
    // The path the rejection clears is derived too, so a stale cookie on the
    // canonical prefix is actually removed rather than left behind.
    expect(refreshCookiePath(res)).toBeDefined();
  });
});
