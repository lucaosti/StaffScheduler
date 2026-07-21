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
import rateLimit from 'express-rate-limit';
import { UserService } from '../services/UserService';
import { RbacService } from '../services/RbacService';
import { TwoFactorService } from '../services/TwoFactorService';
import { RefreshTokenService } from '../services/RefreshTokenService';
import { authenticate, addToBlacklist } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateBody } from '../middleware/validation';
import { loginBody } from '../schemas';
import jwt, { SignOptions } from 'jsonwebtoken';
import { logger } from '../config/logger';

import { config } from '../config';

const isProduction = config.server.env === 'production';

const JWT_COOKIE_NAME = 'token';
const REFRESH_COOKIE_NAME = 'refresh_token';

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
const REFRESH_COOKIE_OPTIONS = {
  ...BASE_COOKIE_OPTIONS,
  path: '/api/auth/refresh',
  maxAge: config.jwt.refreshExpiresInMs,
};

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

  /** Issues a short-lived access JWT for a user id and sets the access cookie. */
  const setAccessCookie = (res: Response, userId: number): void => {
    const jti = crypto.randomUUID();
    const token = jwt.sign({ userId, jti }, config.jwt.secret, jwtSignOptions);
    res.cookie(JWT_COOKIE_NAME, token, JWT_COOKIE_OPTIONS);
  };

  /** Issues a fresh refresh token for a user and sets the (path-scoped) refresh cookie. */
  const setRefreshCookie = async (res: Response, userId: number): Promise<void> => {
    const { token } = await refreshTokens.issue(userId);
    res.cookie(REFRESH_COOKIE_NAME, token, REFRESH_COOKIE_OPTIONS);
  };

  /**
   * Brute-force protection for the login endpoint.
   *
   * Limits each client IP to a small number of login attempts per window,
   * returning the standard error envelope once the threshold is exceeded.
   * The limiter is intentionally lenient under `NODE_ENV === 'test'` so the
   * integration suites can call `/login` repeatedly without hitting 429.
   */
  const isTestEnv = config.server.env === 'test';
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: isTestEnv ? 1000 : 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req: Request, res: Response) => {
      res.status(429).json({
        success: false,
        error: {
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many login attempts, please try again later.'
        }
      });
    }
  });

/**
 * User login endpoint.
 *
 * Authenticates a user with email + password credentials and returns a JWT.
 * When the account has two-factor authentication enabled, a valid TOTP code
 * (or single-use recovery code) must be supplied as `totpCode`; otherwise the
 * request is rejected with `TOTP_REQUIRED` / `TOTP_INVALID`.
 *
 * @route POST /api/auth/login
 * @body  {string} email     User's email
 * @body  {string} password  User's password
 * @body  {string} [totpCode] TOTP or recovery code, required when 2FA is enabled
 * @returns Sets an httpOnly "token" cookie and returns `{ success, data: { user } }`.
 *          The JWT is never exposed in the response body.
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
router.post('/login', loginLimiter, validateBody(loginBody), async (_req: Request, res: Response) => {
  try {
    const { email, password, totpCode } = res.locals.body as {
      email: string;
      password: string;
      totpCode?: string;
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

    // Enforce two-factor authentication when the account has it enabled.
    // The TOTP code is only checked after the password is verified so this
    // endpoint never leaks whether 2FA is enabled for arbitrary emails.
    if (await twoFactorService.isEnabled(user.id)) {
      if (!totpCode) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'TOTP_REQUIRED',
            message: 'Two-factor authentication code required'
          }
        });
      }
      const totpValid =
        (await twoFactorService.verifyCode(user.id, totpCode)) ||
        (await twoFactorService.consumeRecoveryCode(user.id, totpCode));
      if (!totpValid) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'TOTP_INVALID',
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
    setAccessCookie(res, user.id);
    await setRefreshCookie(res, user.id);
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
        }
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
 * Rotates the refresh token in the `refresh_token` cookie and issues a fresh
 * access token. Crucially it is NOT behind `authenticate`: the whole point is
 * to work when the access token has expired. Authority comes solely from the
 * refresh cookie, verified and rotated by RefreshTokenService (reuse of a
 * spent token revokes the family — see the service).
 *
 * @route   POST /api/auth/refresh
 * @cookie  refresh_token  the current refresh token
 * @returns {Object} `{ success, data: { user } }`; 401 with a cleared cookie
 *          when the refresh token is missing, expired, revoked or reused.
 */
router.post('/refresh', asyncHandler(async (req: Request, res: Response) => {
  const presented = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
  const clearAndReject = () => {
    res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_OPTIONS.path });
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

  setAccessCookie(res, user.id);
  res.cookie(REFRESH_COOKIE_NAME, rotated.issued.token, REFRESH_COOKIE_OPTIONS);
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
    },
  });
}));

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
router.post('/logout', authenticate, asyncHandler(async (req: Request, res: Response) => {
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
  res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_OPTIONS.path });
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
}));

  return router;
};
