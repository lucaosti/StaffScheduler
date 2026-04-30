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
import { AuthService } from '../services/AuthService';
import { authenticate } from '../middleware/auth';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { UserWithSecrets } from '../types';

export const createAuthRouter = (pool: Pool) => {
  const router = Router();
  const authService = new AuthService(pool);

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
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body ?? {};
    const result = await authService.login({ email, password });

    if (!result.success) {
      const code = result.error?.code ?? 'LOGIN_FAILED';
      const status =
        code === 'VALIDATION_ERROR' ? 400 : code === 'ACCOUNT_INACTIVE' ? 403 : 401;
      return res.status(status).json(result);
    }

    return res.json(result);
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'LOGIN_FAILED',
        message: (error as Error).message,
      },
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
router.get('/verify', authenticate, async (req: Request, res: Response) => {
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

    // Remove sensitive fields before sending response
    const { password_hash: _password_hash, salt: _salt, ...userWithoutPassword } = user as UserWithSecrets;
    res.json({
      success: true,
      data: userWithoutPassword
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'VERIFICATION_ERROR',
        message: (error as Error).message
      }
    });
  }
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

    const { password_hash: _password_hash, salt: _salt, ...userWithoutPassword } = user as UserWithSecrets;

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn as jwt.SignOptions['expiresIn'] }
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
router.post('/logout', authenticate, async (_req: Request, res: Response) => {
  try {
    // In JWT-based authentication, logout is primarily client-side
    // The client removes the token from storage
    // For enhanced security, implement server-side token blacklisting
    
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'LOGOUT_ERROR',
        message: (error as Error).message
      }
    });
  }
});

  return router;
};
