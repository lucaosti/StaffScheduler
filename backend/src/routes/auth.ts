/**
 * Authentication Routes
 *
 * Handles user authentication, token management, and session verification.
 * Implements JWT-based authentication with secure password validation.
 *
 * Security Features:
 * - Password hashing with bcrypt
 * - JWT token generation and validation
 * - Rate limiting for login attempts
 * - Comprehensive input validation
 *
 * The SSO (OIDC) login flow lives alongside this at the same `/auth` mount
 * point, but in its own file (`routes/authSso.ts`) — see that file's header
 * for why it is a separate `Router` rather than a sub-router of this one.
 * Both share the session-cookie issuance in `routes/authSession.ts`.
 *
 * @author Luca Ostinelli
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'mysql2/promise';
import { UserService } from '../services/UserService';
import { RbacService } from '../services/RbacService';
import { TwoFactorService } from '../services/TwoFactorService';
import { RefreshTokenService } from '../services/RefreshTokenService';
import { authenticate, revokePresentedAccessToken } from '../middleware/auth';
import { createLoginLimiter } from '../middleware/rateLimit';
import { validateBody } from '../middleware/validation';
import { loginBody, refreshBody, twoFactorLoginChallengeBody } from '../schemas';
import { TwoFactorMethodType } from '../services/TwoFactorMethodProvider';
import { logger } from '../config/logger';
import {
  JWT_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  isMobileClient,
  presentedRefreshToken,
  clearRefreshCookie,
  refreshCookieOptions,
  createSessionCookies,
} from './authSession';

export const createAuthRouter = (pool: Pool) => {
  const router = Router();
  const userService = new UserService(pool);
  const rbacService = new RbacService(pool);
  const twoFactorService = new TwoFactorService(pool);
  const refreshTokens = new RefreshTokenService(pool);
  const { setAccessCookie, setRefreshCookie } = createSessionCookies(pool);

  // Brute-force protection: IP-keyed, counted in the shared store so the
  // threshold is the same however many replicas are running.
  const loginLimiter = createLoginLimiter();

/**
 * User login endpoint.
 *
 * Authenticates a user with email + password credentials and returns a JWT.
 * When the account has two-factor authentication enabled on ANY method
 * (#591 — was TOTP-only), a valid code/assertion for one of its enrolled
 * methods (or a single-use recovery code) must be supplied as `code`;
 * otherwise the request is rejected with `TWO_FACTOR_REQUIRED` (whose
 * response carries the account's enabled method types, so the client knows
 * what to offer) or `TWO_FACTOR_INVALID`.
 *
 * A method that needs a server-generated challenge before it can be
 * verified (email, WebAuthn) requires a prior call to
 * `POST /api/auth/login/challenge` with the same credentials.
 *
 * @route POST /api/auth/login
 * @header [X-Client-Type]  Set to "mobile" to also receive the token values in the
 *                          body (see below) — an explicit opt-in for the Capacitor
 *                          app; absent for every other caller, including the web SPA.
 * @body  {string} email     User's email
 * @body  {string} password  User's password
 * @body  {string} [code]        Second-factor code/assertion (or a recovery code), required when 2FA is enabled
 * @body  {string} [methodType]  Which enrolled method `code` is for — defaults to 'totp'
 * @returns Sets an httpOnly "token" cookie and returns `{ success, data: { user } }`.
 *          The JWT is never exposed in the response body — UNLESS `X-Client-Type: mobile`
 *          was sent, in which case `data.accessToken`/`data.refreshToken` carry the raw
 *          values too, alongside (not instead of) the cookies, for the native client to
 *          hand to its own secure storage.
 *
 * @example Request
 * { "email": "admin@example.com", "password": "<password>" }
 *
 * @example Response
 * {
 *   "success": true,
 *   "data": {
 *     "user": { "id": 1, "email": "admin@example.com", "roles": [...], "permissions": [...] }
 *   }
 * }
 */
router.post('/login', loginLimiter, validateBody(loginBody), async (req: Request, res: Response) => {
  try {
    const { email, password, code, methodType } = res.locals.body as {
      email: string;
      password: string;
      code?: string;
      methodType?: TwoFactorMethodType;
    };

    // Authenticate user and generate token
    const user = await userService.validatePassword(email, password);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'LOGIN_FAILED',
          message: 'Invalid email or password'
        }
      });
    }

    // Enforce two-factor authentication when the account has ANY method
    // enabled. The check is only made after the password is verified so
    // this endpoint never leaks whether 2FA is enabled for arbitrary emails.
    if (await twoFactorService.hasAnyEnabled(user.id)) {
      if (!code) {
        const methods = await twoFactorService.listEnabledMethods(user.id);
        return res.status(401).json({
          success: false,
          error: {
            code: 'TWO_FACTOR_REQUIRED',
            message: 'Two-factor authentication code required'
          },
          data: { methods }
        });
      }
      const resolvedMethod = methodType ?? 'totp';
      const codeValid =
        (await twoFactorService.verifyCode(user.id, code, resolvedMethod)) ||
        (await twoFactorService.consumeRecoveryCode(user.id, code));
      if (!codeValid) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'TWO_FACTOR_INVALID',
            message: 'Invalid two-factor authentication code'
          }
        });
      }
    }

    // Resolve effective permissions/roles so the client can gate its UI.
    const [permissions, roles] = await Promise.all([
      rbacService.getEffectivePermissions(user.id),
      rbacService.getUserRoles(user.id),
    ]);

    // Issue the short-lived access token (JTI-tagged so it can be revoked) and
    // a rotating refresh token that carries the session's real longevity.
    // Only the user id is embedded in the access token; permissions are
    // resolved from the database on every request by the auth middleware.
    const accessToken = setAccessCookie(res, user.id);
    const refreshToken = await setRefreshCookie(req, res, user.id);
    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          roles,
          permissions
        },
        // Mobile-client response mode only (see MOBILE_CLIENT_HEADER): the
        // cookies above are still set unconditionally, but a native client
        // cannot rely on them, so it also gets the raw values to hand to its
        // own secure storage. A plain web request never has these fields —
        // isMobileClient(req) is false and the object is not spread in.
        ...(isMobileClient(req) ? { accessToken, refreshToken } : {}),
      }
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(401).json({
      success: false,
      error: {
        code: 'LOGIN_FAILED',
        message: 'Invalid email or password'
      }
    });
  }
});

/**
 * Requests a fresh 2FA challenge DURING login, before a session exists —
 * the pre-session equivalent of the authenticated `POST /api/auth/2fa/challenge`.
 * Needed for any method whose code must be generated first (email) or whose
 * assertion the browser can only request against a fresh server challenge
 * (WebAuthn); TOTP needs no challenge, since its code is computed from a
 * secret the account already has.
 *
 * Re-verifies the password rather than trusting a bare userId/email, for
 * the same reason `/login` itself waits for a valid password before
 * revealing anything 2FA-related: an unauthenticated caller must not be
 * able to trigger an email send, or learn a WebAuthn credential exists, for
 * an arbitrary address by guessing it.
 *
 * Deliberately NOT under `/2fa` (routes/twoFactor.ts, entirely behind
 * `authenticate`) — it lives here, alongside `/login`, so an unauthenticated
 * request never has to pass through that router's `authenticate` gate at all.
 *
 * @route POST /api/auth/login/challenge
 * @body  {string} email
 * @body  {string} password
 * @body  {string} methodType  Which enrolled method to challenge
 * @returns `{ success, data }` — `data` is the provider's challenge payload
 *          (e.g. WebAuthn's `PublicKeyCredentialRequestOptionsJSON`) or
 *          `null` for a method that delivers out of band (email).
 */
router.post('/login/challenge', loginLimiter, validateBody(twoFactorLoginChallengeBody), async (_req: Request, res: Response) => {
  const { email, password, methodType } = res.locals.body as {
    email: string;
    password: string;
    methodType: TwoFactorMethodType;
  };

  const user = await userService.validatePassword(email, password);
  if (!user) {
    return res.status(401).json({
      success: false,
      error: { code: 'LOGIN_FAILED', message: 'Invalid email or password' }
    });
  }

  // No try/catch: a resolveProvider()/requestChallenge ConflictError (method
  // not enabled, unregistered, or doesn't use a requested challenge) reaches
  // the central errorHandler and renders with its own proper status/code —
  // same reasoning as routes/twoFactor.ts's /setup and /challenge.
  const data = await twoFactorService.requestChallenge(user.id, methodType);
  res.json({ success: true, data: data ?? null });
});

/**
 * Token verification endpoint.
 *
 * Validates the incoming JWT and returns the user record (without secrets).
 *
 * @route      GET /api/auth/verify
 * @middleware authenticate
 * @returns    {Object} `{ success, data: <user> }`
 */
router.get('/verify', authenticate, (req: Request, res: Response) => {
  // authenticate rejects unauthenticated requests before this handler runs,
  // so req.user is guaranteed here — same invariant every protected route
  // relies on.
  res.json({
    success: true,
    data: req.user!
  });
});

/**
 * Token refresh endpoint.
 *
 * Rotates the refresh token and issues a fresh access token. Crucially it is
 * NOT behind `authenticate`: the whole point is to work when the access
 * token has expired.
 *
 * Two ways to present the refresh token:
 *  - Web (default): solely the `refresh_token` cookie. The body is ignored
 *    even if it carries a `refreshToken` field — this path is completely
 *    unchanged from before the mobile-client mode existed.
 *  - Mobile (`X-Client-Type: mobile` present): the cookie is tried first
 *    (harmless if a WebView happens to have it), falling back to
 *    `refreshToken` in the JSON body when the cookie is absent — a native
 *    client stores the token itself rather than relying on the cookie jar.
 *
 * Either way, rotation and validity are enforced identically by
 * RefreshTokenService (reuse of a spent token revokes the family — see the
 * service); only where the token is READ FROM differs, and only when the
 * mobile signal is explicitly present.
 *
 * @route   POST /api/auth/refresh
 * @cookie  refresh_token       the current refresh token (web, and mobile as a fallback source)
 * @body    {string} [refreshToken]  the current refresh token — consulted only when
 *                                   `X-Client-Type: mobile` is present and the cookie is absent
 * @returns {Object} `{ success, data: { user } }`, plus `accessToken`/`refreshToken` in
 *          `data` when the mobile-client signal is present; 401 with a cleared
 *          cookie when the refresh token is missing, expired, revoked or reused;
 *          409 `REFRESH_SUPERSEDED`, cookies untouched, when a concurrent
 *          refresh rotated it moments ago (see RefreshTokenService).
 */
router.post('/refresh', validateBody(refreshBody), async (req: Request, res: Response) => {
  const mobile = isMobileClient(req);
  const { refreshToken: bodyRefreshToken } = res.locals.body as { refreshToken?: string };
  const presented = presentedRefreshToken(req, bodyRefreshToken);
  const clearAndReject = () => {
    clearRefreshCookie(req, res);
    res.clearCookie(JWT_COOKIE_NAME);
    return res.status(401).json({
      success: false,
      error: { code: 'REFRESH_INVALID', message: 'Session expired, please sign in again' },
    });
  };

  if (!presented) return clearAndReject();

  const rotated = await refreshTokens.rotate(presented);
  if (rotated.status === 'superseded') {
    // A concurrent refresh (another tab) rotated this token a moment ago. The
    // cookies are deliberately NOT cleared: the browser's jar is shared
    // between tabs and may already hold that refresh's successor, which a
    // clear would destroy. The client retries once with what it now holds.
    return res.status(409).json({
      success: false,
      error: { code: 'REFRESH_SUPERSEDED', message: 'Session was refreshed concurrently; retry' },
    });
  }
  if (rotated.status === 'invalid') return clearAndReject();

  const user = await userService.getUserById(rotated.userId);
  if (!user || !user.isActive) {
    // The refresh token is valid but the account is gone/disabled: revoke the
    // whole family and reject, so a deactivated user cannot keep a session.
    // Deactivation already revoked every token (#818); this is the backstop
    // for an account disabled by any path that does not.
    await refreshTokens.revokeFamilyOf(rotated.issued.token);
    return clearAndReject();
  }

  const [permissions, roles] = await Promise.all([
    rbacService.getEffectivePermissions(user.id),
    rbacService.getUserRoles(user.id),
  ]);

  const accessToken = setAccessCookie(res, user.id);
  res.cookie(REFRESH_COOKIE_NAME, rotated.issued.token, refreshCookieOptions(req));
  res.json({
    success: true,
    data: {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        roles,
        permissions,
      },
      // See /login: same mobile-only, additive token exposure.
      ...(mobile ? { accessToken, refreshToken: rotated.issued.token } : {}),
    },
  });
});

/**
 * User logout endpoint — ends the session server-side.
 *
 * Revokes the presented refresh token's whole family, so the session cannot
 * be resurrected via /refresh, and blacklists the access token's JTI (TTL
 * keyed to its own exp claim) so it is rejected on subsequent requests.
 *
 * Why here, and why NOT behind `authenticate` (#816). At `/auth/logout`
 * behind `authenticate` it revoked nothing in practice: the browser never
 * sent it the refresh cookie (path-scoped to `/auth/refresh`), a native
 * client sent no refresh token at all, and once the access token had expired
 * it answered 401 before doing anything. Living beneath the cookie's path, it
 * receives the cookie; reading the refresh token exactly as /refresh does, it
 * serves the native client too; and the refresh token — not the access
 * token — is the credential it acts on, so an expired access token no longer
 * matters. Like /refresh, presenting the token is the authorisation: anyone
 * who holds it could already use the session it ends.
 *
 * Alternatives rejected:
 *  - widening the refresh cookie's path to `/auth` (or `/api`) so `/logout`
 *    receives it: attaches the 30-day credential to every login, 2FA and
 *    SSO call, the exposure the narrow path exists to prevent;
 *  - a family id in the access token, revoked by an authenticated logout:
 *    still fails once the access token has expired, the commonest moment to
 *    log out after being away, and needs a token-payload change for it;
 *  - setting a second copy of the refresh cookie on `/auth/logout`: two
 *    cookies to keep in step on every rotation for no gain over a sub-path.
 *
 * Always 200 and always clears the cookies: the client must be able to finish
 * its local logout whatever state the server-side session was in.
 *
 * @route   POST /api/v1/auth/refresh/logout
 * @cookie  refresh_token       the session to end (web)
 * @body    {string} [refreshToken]  the session to end — consulted only when
 *                                   `X-Client-Type: mobile` is present and the cookie is absent
 * @returns {Object} `{ success: true, message: "Logged out successfully" }`
 */
router.post('/refresh/logout', validateBody(refreshBody), async (req: Request, res: Response) => {
  const { refreshToken: bodyRefreshToken } = res.locals.body as { refreshToken?: string };
  const presented = presentedRefreshToken(req, bodyRefreshToken);
  // Both awaited before confirming: by the time the client is told it is
  // logged out, neither token works on any instance.
  if (presented) await refreshTokens.revokeFamilyOf(presented);
  await revokePresentedAccessToken(req);
  res.clearCookie(JWT_COOKIE_NAME);
  clearRefreshCookie(req, res);
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

  return router;
};
