/**
 * Session-cookie issuance shared between the password-login flow
 * (`routes/auth.ts`) and the SSO login flow (`routes/authSso.ts`) — both
 * issue the SAME access/refresh cookies on a successful sign-in, so there is
 * one implementation of what a cookie looks like and how it is set.
 *
 * @author Luca Ostinelli
 */

import crypto from 'crypto';
import { Pool } from 'mysql2/promise';
import { Request, Response } from 'express';
import jwt, { SignOptions } from 'jsonwebtoken';
import { RefreshTokenService } from '../services/RefreshTokenService';
import { config } from '../config';

const isProduction = config.server.env === 'production';

export const JWT_COOKIE_NAME = 'token';
export const REFRESH_COOKIE_NAME = 'refresh_token';

// Explicit opt-in header the Capacitor mobile client sends on login/refresh.
// A native WebView cannot rely on the cookie jar the way a same-origin
// browser session can (cross-origin behavior between the app's local/custom
// scheme origin and the real API domain is unreliable across iOS/Android
// WebView versions), so the mobile client asks, explicitly, to also receive
// the token VALUES in the JSON body so it can hand them to native secure
// storage instead. This is checked as an opt-in signal only: its absence (the
// default for every existing caller, including the web SPA) changes nothing
// about the response, which is what keeps the web contract byte-for-byte the
// same as before this existed.
const MOBILE_CLIENT_HEADER = 'x-client-type';
const MOBILE_CLIENT_VALUE = 'mobile';

export const isMobileClient = (req: Request): boolean =>
  req.header(MOBILE_CLIENT_HEADER)?.toLowerCase() === MOBILE_CLIENT_VALUE;

// Shared cookie hardening for both the access and refresh cookies.
const BASE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProduction,
  // 'strict' is safe for an SPA: the HTML shell is public, and all
  // authenticated calls are same-site XHR/fetch from the app's own origin.
  // It closes the residual CSRF window 'lax' leaves for top-level GETs.
  sameSite: 'strict' as const,
};

const JWT_COOKIE_OPTIONS = {
  ...BASE_COOKIE_OPTIONS,
  // Keep the cookie lifetime in lockstep with the (short) access-token expiry.
  maxAge: config.jwt.expiresInMs,
};

// The refresh cookie is scoped to the refresh endpoint only: it is never sent
// on ordinary API calls, shrinking its exposure. It lives for the full refresh
// lifetime so the session survives many access-token expiries.
//
// Coupling to the API prefix: the auth router is mounted at `/api/v1/auth`
// only — the legacy `/api` now 308-redirects to `/api/v1` rather than serving
// requests itself (#319) — but the path is still DERIVED from `req.baseUrl`
// rather than hardcoded. A hardcoded `/api/auth/refresh` was the whole reason
// `/api/v1`'s refresh flow silently failed before that fix: a browser only
// sends a path-scoped cookie to paths that START WITH the cookie's path, so a
// client calling `/api/v1/auth/refresh` never had the cookie sent to it, and
// its session died at the first access-token expiry. Deriving means this
// stays correct if the mount point ever moves again, with nothing here to
// remember to update.
//
// Deriving it rather than widening it to `/api` is the point: a wide path
// would attach the long-lived refresh token to EVERY api call, which is
// exactly the exposure the narrow scope exists to prevent.
export const refreshCookieOptions = (req: Request) => ({
  ...BASE_COOKIE_OPTIONS,
  // Inside the auth router `req.baseUrl` is `/api/v1/auth` — the only prefix
  // it is mounted at now — so this is the endpoint's own absolute path.
  path: `${req.baseUrl}/refresh`,
  maxAge: config.jwt.refreshExpiresInMs,
});

/**
 * Clears the refresh cookie.
 *
 * Also clears the legacy hardcoded path (`/api/auth/refresh`) as one-time
 * migration hygiene: a session whose refresh cookie was set before #319
 * retired that mount still has it stored there, and `clearCookie` only
 * matches a cookie whose path it names exactly. The token is revoked
 * server-side either way, so leaving that stale cookie in place would be
 * harmless — a browser presenting a dead credential — but there is no reason
 * not to clean it up while a caller is already logging out.
 */
export const clearRefreshCookie = (req: Request, res: Response): void => {
  for (const path of new Set([`${req.baseUrl}/refresh`, '/api/auth/refresh'])) {
    res.clearCookie(REFRESH_COOKIE_NAME, { path });
  }
};

export interface SessionCookies {
  /**
   * Issues a short-lived access JWT for a user id and sets the access
   * cookie. Returns the token value too — unused by the web caller (the
   * cookie is authority enough for it) but needed by the mobile-client
   * response mode, which puts the same value in the JSON body alongside the
   * (harmless-if-unused) cookie.
   */
  setAccessCookie(res: Response, userId: number): string;
  /**
   * Issues a fresh refresh token for a user and sets the (path-scoped)
   * refresh cookie. Returns the token value for the same reason
   * `setAccessCookie` does.
   */
  setRefreshCookie(req: Request, res: Response, userId: number): Promise<string>;
}

/** Builds the session-cookie issuers for one request pool. */
export const createSessionCookies = (pool: Pool): SessionCookies => {
  const refreshTokens = new RefreshTokenService(pool);
  const jwtSignOptions: SignOptions = {
    expiresIn: config.jwt.expiresIn as SignOptions['expiresIn'],
  };

  return {
    setAccessCookie(res, userId) {
      const jti = crypto.randomUUID();
      const token = jwt.sign({ userId, jti }, config.jwt.secret, jwtSignOptions);
      res.cookie(JWT_COOKIE_NAME, token, JWT_COOKIE_OPTIONS);
      return token;
    },
    async setRefreshCookie(req, res, userId) {
      const { token } = await refreshTokens.issue(userId);
      res.cookie(REFRESH_COOKIE_NAME, token, refreshCookieOptions(req));
      return token;
    },
  };
};
