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

import { Router, Request, Response } from 'express';
import { Pool } from 'mysql2/promise';
import rateLimit from 'express-rate-limit';
import { UserService } from '../services/UserService';
import { RbacService } from '../services/RbacService';
import { authenticate } from '../middleware/auth';
import jwt, { SignOptions } from 'jsonwebtoken';

// Extend Express Request to include user
declare module 'express-serve-static-core' {
  interface Request {
    user?: import('../types').User;
  }
}
import { config } from '../config';

export const createAuthRouter = (pool: Pool) => {
  const router = Router();
  const userService = new UserService(pool);
  const rbacService = new RbacService(pool);

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
  const isTestEnv = process.env.NODE_ENV === 'test';
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
 *
 * @route POST /api/auth/login
 * @body  {string} email    User's email
 * @body  {string} password User's password
 * @returns {Object} `{ success, data: { token, user } }` on success;
 *                   `{ success:false, error:{ code, message } }` otherwise.
 *
 * @example Request
 * { "email": "admin@example.com", "password": "<password>" }
 *
 * @example Response
 * {
 *   "success": true,
 *   "data": {
 *     "token": "<jwt>",
 *     "user": { "id": 1, "email": "admin@example.com", "role": "admin" }
 *   }
 * }
 */
router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    // Input validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Email and password are required'
        }
      });
    }

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

    // Resolve effective permissions/roles so the client can gate its UI.
    const [permissions, roles] = await Promise.all([
      rbacService.getEffectivePermissions(user.id),
      rbacService.getUserRoles(user.id),
    ]);

    // Generate JWT token. Only the user id is embedded; permissions are
    // resolved from the database on every request by the auth middleware.
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      config.jwt.secret,
      jwtSignOptions
    );

    res.json({
      success: true,
      data: {
        token,
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
    res.status(401).json({
      success: false,
      error: {
        code: 'LOGIN_FAILED',
        message: (error as Error).message
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

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      config.jwt.secret,
      jwtSignOptions
    );
    
    res.json({
      success: true,
      data: {
        user: userWithoutPassword,
        token
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'REFRESH_ERROR',
        message: (error as Error).message
      }
    });
  }
});

/**
 * User logout endpoint.
 *
 * With JWT auth this is informational: the client drops the token from
 * storage. A real server-side blacklist would require persistence and is
 * out of scope here (see security backlog item `B001`).
 *
 * @route      POST /api/auth/logout
 * @middleware authenticate
 * @returns    {Object} `{ success: true, message: "Logged out successfully" }`
 */
router.post('/logout', authenticate, (_req: Request, res: Response) => {
  // In JWT-based authentication, logout is primarily client-side.
  // The client removes the token from storage.
  // For enhanced security, implement server-side token blacklisting.
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

  return router;
};
