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
 * @author Luca Ostinelli
 */

import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { Pool } from 'mysql2/promise';
import { UserService } from '../services/UserService';
import { RbacService } from '../services/RbacService';
import { TwoFactorService } from '../services/TwoFactorService';
import { RefreshTokenService } from '../services/RefreshTokenService';
import { authenticate, addToBlacklist } from '../middleware/auth';
import { createLoginLimiter } from '../middleware/rateLimit';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { loginBody, refreshBody, twoFactorLoginChallengeBody, idParam, ssoProvidersPublicQuery, ssoCallbackQuery } from '../schemas';
import { TwoFactorMethodType } from '../services/TwoFactorMethodProvider';
import jwt, { SignOptions } from 'jsonwebtoken';
import { logger } from '../config/logger';
import { SsoProviderService } from '../services/SsoProviderService';
import { SsoAuthService } from '../services/SsoAuthService';

import { config } from '../config';

const isProduction = config.server.env === 'production';

const JWT_COOKIE_NAME = 'token';
const REFRESH_COOKIE_NAME = 'refresh_token';

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

const isMobileClient = (req: Request): boolean =>
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
// Coupling to the API prefix: this router is mounted at `/api/v1/auth` only —
// the legacy `/api` now 308-redirects to `/api/v1` rather than serving
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
const clearRefreshCookie = (req: Request, res: Response): void => {
  for (const path of new Set([`${req.baseUrl}/refresh`, '/api/auth/refresh'])) {
    res.clearCookie(REFRESH_COOKIE_NAME, { path });
  }
};

const refreshCookieOptions = (req: Request) => ({
  ...BASE_COOKIE_OPTIONS,
  // Inside this router `req.baseUrl` is `/api/v1/auth` — the only prefix it
  // is mounted at now — so this is the endpoint's own absolute path.
  path: `${req.baseUrl}/refresh`,
  maxAge: config.jwt.refreshExpiresInMs,
});

export const createAuthRouter = (pool: Pool) => {
  const router = Router();
  const userService = new UserService(pool);
  const rbacService = new RbacService(pool);
  const twoFactorService = new TwoFactorService(pool);
  const refreshTokens = new RefreshTokenService(pool);

  // Shared JWT signing options, driven by configuration rather than hardcoded.
  const jwtSignOptions: SignOptions = {
    expiresIn: config.jwt.expiresIn as SignOptions['expiresIn']
  };

  /**
   * Issues a short-lived access JWT for a user id and sets the access
   * cookie. Returns the token value too — unused by the web caller (the
   * cookie is authority enough for it) but needed by the mobile-client
   * response mode, which puts the same value in the JSON body alongside the
   * (harmless-if-unused) cookie.
   */
  const setAccessCookie = (res: Response, userId: number): string => {
    const jti = crypto.randomUUID();
    const token = jwt.sign({ userId, jti }, config.jwt.secret, jwtSignOptions);
    res.cookie(JWT_COOKIE_NAME, token, JWT_COOKIE_OPTIONS);
    return token;
  };

  /**
   * Issues a fresh refresh token for a user and sets the (path-scoped)
   * refresh cookie. Returns the token value for the same reason
   * `setAccessCookie` does.
   */
  const setRefreshCookie = async (
    req: Request,
    res: Response,
    userId: number
  ): Promise<string> => {
    const { token } = await refreshTokens.issue(userId);
    res.cookie(REFRESH_COOKIE_NAME, token, refreshCookieOptions(req));
    return token;
  };

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
 *          cookie when the refresh token is missing, expired, revoked or reused.
 */
router.post('/refresh', validateBody(refreshBody), async (req: Request, res: Response) => {
  const mobile = isMobileClient(req);
  const { refreshToken: bodyRefreshToken } = res.locals.body as { refreshToken?: string };
  const presented =
    (req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined) ??
    (mobile ? bodyRefreshToken : undefined);
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
  if (!rotated) return clearAndReject();

  const user = await userService.getUserById(rotated.userId);
  if (!user || !user.isActive) {
    // The refresh token is valid but the account is gone/disabled: revoke the
    // whole family and reject, so a deactivated user cannot keep a session.
    await refreshTokens.revoke(rotated.issued.token);
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
 * User logout endpoint.
 *
 * Blacklists the token's JTI so it is rejected on subsequent requests, then
 * clears the httpOnly cookie. The in-memory blacklist uses TTL-based expiry
 * (keyed to the token's own exp claim) so entries prune themselves automatically.
 *
 * @route      POST /api/auth/logout
 * @middleware authenticate
 * @returns    {Object} `{ success: true, message: "Logged out successfully" }`
 */
router.post('/logout', authenticate, async (req: Request, res: Response) => {
  // Await the revocation before confirming logout: the access token must be
  // blacklisted (in shared Redis) by the time the client is told it is logged
  // out, so an immediate replay on any instance is already rejected.
  if (req.tokenJti) {
    await addToBlacklist(req.tokenJti, req.tokenExp);
  }
  // Revoke the refresh token too, so the session cannot be resurrected via
  // /refresh after logout. Best-effort: absence of the cookie is a no-op.
  const presentedRefresh = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
  if (presentedRefresh) {
    await refreshTokens.revoke(presentedRefresh);
  }
  res.clearCookie(JWT_COOKIE_NAME);
  clearRefreshCookie(req, res);
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

  // ------------- SSO (OIDC) -------------

  const ssoProviders = new SsoProviderService(pool);
  const ssoAuth = new SsoAuthService(pool);

  const STATE_COOKIE_NAME = 'sso_state';
  const NONCE_COOKIE_NAME = 'sso_nonce';

  /**
   * `redirect_uri` and the state/nonce cookie path both derive from
   * `req.baseUrl` + the literal route, the same reasoning
   * `refreshCookieOptions` already applies to the refresh cookie: a
   * hardcoded path is exactly what broke `/api/v1`'s refresh flow before,
   * and the identity provider is later asked to redirect back to this exact
   * URL, so it has to be right regardless of which prefix served the login.
   */
  const ssoCallbackPath = (req: Request, providerId: number): string =>
    `${req.baseUrl}/sso/${providerId}/callback`;

  const ssoRedirectUri = (req: Request, providerId: number): string =>
    `${req.protocol}://${req.get('host')}${ssoCallbackPath(req, providerId)}`;

  const ssoStateCookieOptions = (req: Request, providerId: number) => ({
    httpOnly: true,
    secure: isProduction,
    // NOT `BASE_COOKIE_OPTIONS`, deliberately: this cookie must survive the
    // trip TO the identity provider and back — a cross-SITE, top-level
    // redirect FROM the IdP's own domain. `SameSite=Strict` (used for every
    // other cookie here, all first-party XHR/fetch) is never sent on a
    // cross-site navigation, even a top-level GET, so a Strict state cookie
    // would silently never reach `/callback` and every SSO login would fail
    // with a state mismatch — indistinguishable from an actual CSRF attempt.
    // `Lax` is sent on top-level cross-site GETs, which is exactly what an
    // IdP redirect is, while still refusing it on a cross-site POST/embed.
    sameSite: 'lax' as const,
    path: ssoCallbackPath(req, providerId),
    // Long enough for a real login (IdP consent screens, MFA prompts), short
    // enough that a stale cookie isn't a standing CSRF-window concern.
    maxAge: 5 * 60 * 1000,
  });

  const clearSsoCookies = (req: Request, res: Response, providerId: number): void => {
    const path = ssoCallbackPath(req, providerId);
    res.clearCookie(STATE_COOKIE_NAME, { path });
    res.clearCookie(NONCE_COOKIE_NAME, { path });
  };

  /**
   * Providers an unauthenticated login page may offer — name and id only,
   * never the client secret. `organizationName` is an optional query filter
   * so a caller who already knows which organization they belong to (e.g. a
   * subdomain-per-org frontend) sees only its own configured providers plus
   * any platform-wide one.
   *
   * @route GET /api/auth/sso/providers
   */
  router.get('/sso/providers', validateQuery(ssoProvidersPublicQuery), async (_req: Request, res: Response) => {
    const organizationName = (res.locals.query.organizationName as string | undefined) ?? null;
    const data = await ssoProviders.listPublic(organizationName);
    res.json({ success: true, data });
  });

  /**
   * Starts the OIDC authorization-code flow: redirects the browser to the
   * identity provider with a random `state` (CSRF) and `nonce` (ID-token
   * replay protection), each round-tripped via a short-lived, path-scoped
   * httpOnly cookie rather than server-side session state — this
   * application has none.
   *
   * @route GET /api/auth/sso/:id/login
   */
  router.get('/sso/:id/login', validateParams(idParam), async (req: Request, res: Response) => {
    const provider = await ssoProviders.getById(res.locals.params.id);
    if (!provider || !provider.isActive) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'SSO provider not found' } });
    }

    const state = crypto.randomUUID();
    const nonce = crypto.randomUUID();
    const cookieOptions = ssoStateCookieOptions(req, provider.id);
    res.cookie(STATE_COOKIE_NAME, state, cookieOptions);
    res.cookie(NONCE_COOKIE_NAME, nonce, cookieOptions);

    const authorizationUrl = ssoAuth.buildAuthorizationUrl(
      provider,
      ssoRedirectUri(req, provider.id),
      state,
      nonce
    );
    res.redirect(authorizationUrl);
  });

  /**
   * Completes the OIDC flow: verifies `state` against the cookie set at
   * `/login`, exchanges the authorization code for an ID token, verifies the
   * token (signature via the provider's JWKS, issuer, audience, and the
   * `nonce` against the cookie), resolves the result to a local account, and
   * issues the SAME session cookies `/login` issues on a password sign-in.
   *
   * This is a top-level BROWSER NAVIGATION (the identity provider redirects
   * the user's browser here), not an XHR/fetch call — on success it
   * redirects to the frontend rather than returning JSON, the same
   * expectation the browser already has for this request.
   *
   * @route GET /api/auth/sso/:id/callback
   */
  router.get('/sso/:id/callback', validateParams(idParam), validateQuery(ssoCallbackQuery), async (req: Request, res: Response) => {
    const providerId = res.locals.params.id as number;
    const provider = await ssoProviders.getById(providerId);
    if (!provider || !provider.isActive) {
      clearSsoCookies(req, res, providerId);
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'SSO provider not found' } });
    }

    const { code, state } = res.locals.query as { code?: string; state?: string };
    const cookieState = req.cookies?.[STATE_COOKIE_NAME] as string | undefined;
    const cookieNonce = req.cookies?.[NONCE_COOKIE_NAME] as string | undefined;
    clearSsoCookies(req, res, provider.id);

    // Constant-time-adjacent is not the concern here — `state` is a random
    // UUID with no secret comparison timing to leak; a plain equality check
    // is what every OAuth client library does for this exact comparison.
    if (!code || !state || !cookieState || !cookieNonce || state !== cookieState) {
      return res.status(400).json({
        success: false,
        error: { code: 'SSO_STATE_MISMATCH', message: 'This login attempt has expired or was not started here' },
      });
    }

    const idToken = await ssoAuth.exchangeCodeForIdToken(provider, code, ssoRedirectUri(req, provider.id));
    const profile = await ssoAuth.verifyIdToken(provider, idToken, cookieNonce);
    const user = await ssoAuth.findOrCreateUser(provider, profile);

    setAccessCookie(res, user.id);
    await setRefreshCookie(req, res, user.id);
    res.redirect(config.cors.origin);
  });

  return router;
};
