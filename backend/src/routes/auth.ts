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
import { authenticate, addToBlacklist } from '../middleware/auth';
import { validateBody } from '../middleware/validation';
import { loginBody } from '../schemas';
import jwt, { SignOptions } from 'jsonwebtoken';
import { logger } from '../config/logger';

import { config } from '../config';

const isProduction = config.server.env === 'production';

const JWT_COOKIE_NAME = 'token';
const JWT_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProduction,
  // 'strict' is safe for an SPA: the HTML shell is public, and all
  // authenticated calls are same-site XHR/fetch from the app's own origin.
  // It closes the residual CSRF window 'lax' leaves for top-level GETs.
  sameSite: 'strict' as const,
  // Keep the cookie lifetime in lockstep with the JWT expiry so the cookie
  // never outlives (or prematurely drops) a still-valid token.
  maxAge: config.jwt.expiresInMs,
};

export const createAuthRouter = (pool: Pool) => {
  const router = Router();
  const userService = new UserService(pool);
  const rbacService = new RbacService(pool);
  const twoFactorService = new TwoFactorService(pool);

  // Shared JWT signing options, driven by configuration rather than hardcoded.
  const jwtSignOptions: SignOptions = {
    expiresIn: config.jwt.expiresIn as SignOptions['expiresIn']
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

    // Generate JWT token. Only the user id is embedded; permissions are
    // resolved from the database on every request by the auth middleware.
    const jti = crypto.randomUUID();
    const token = jwt.sign(
      { userId: user.id, jti },
      config.jwt.secret,
      jwtSignOptions
    );

    res.cookie(JWT_COOKIE_NAME, token, JWT_COOKIE_OPTIONS);
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
  const user = req.user;
  if (!user) {
    res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'User not found'
      }
    });
    return;
  }

  res.json({
    success: true,
    data: req.user!
  });
});

/**
 * Token refresh endpoint.
 *
 * Issues a new JWT for an already-authenticated user.
 *
 * @route      POST /api/auth/refresh
 * @middleware authenticate
 * @returns    {Object} `{ success, data: { user, token } }`
 */
router.post('/refresh', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'User not found'
        }
      });
    }

    const { password_hash: _password_hash, salt: _salt, ...userWithoutPassword } = user as any;

    const jti = crypto.randomUUID();
    const token = jwt.sign(
      { userId: user.id, jti },
      config.jwt.secret,
      jwtSignOptions
    );

    res.cookie(JWT_COOKIE_NAME, token, JWT_COOKIE_OPTIONS);
    res.json({
      success: true,
      data: {
        user: userWithoutPassword,
      }
    });
  } catch (error) {
    logger.error('Token refresh error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'REFRESH_ERROR',
        message: 'Token refresh failed'
      }
    });
  }
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
router.post('/logout', authenticate, (req: Request, res: Response) => {
  if (req.tokenJti) {
    addToBlacklist(req.tokenJti, req.tokenExp);
  }
  res.clearCookie(JWT_COOKIE_NAME);
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

  return router;
};
