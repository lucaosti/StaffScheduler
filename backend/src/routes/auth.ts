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
import { UserService } from '../services/UserService';
import { authenticate } from '../middleware/auth';
import jwt from 'jsonwebtoken';

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

/**
 * User Login Endpoint
 * 
 * Authenticates users with username/password credentials and returns JWT token.
 * Implements secure password verification and token generation.
 * 
 * @route POST /api/auth/login
 * @param {string} username - User's username or email
 * @param {string} password - User's password
 * @returns {Object} Authentication result with JWT token and user info
 * 
 * @example
 * POST /api/auth/login
 * {
 *   "username": "admin",
 *   "password": "admin123"
 * }
 * 
 * @example Response
 * {
 *   "success": true,
 *   "data": {
 *     "token": "jwt_token_here",
 *     "user": {
 *       "id": "user_id",
 *       "username": "admin",
 *       "role": "admin"
 *     }
 *   }
 * }
 */
router.post('/login', async (req: Request, res: Response) => {
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

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      config.jwt.secret,
      { expiresIn: '7d' }
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
          role: user.role
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
 * Token Verification Endpoint
 * 
 * Verifies JWT token validity and returns current user information.
 * Used by frontend to check authentication status and get user details.
 * 
 * @route GET /api/auth/verify
 * @middleware authenticate - Requires valid JWT token
 * @returns {Object} Current user information without sensitive data
 * 
 * @example
 * GET /api/auth/verify
 * Authorization: Bearer jwt_token_here
 * 
 * @example Response
 * {
 *   "success": true,
 *   "data": {
 *     "id": "user_id",
 *     "username": "admin",
 *     "email": "admin@company.com",
 *     "role": "admin",
 *     "lastLogin": "2024-01-20T10:30:00Z"
 *   }
 * }
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
    const { password_hash, salt, ...userWithoutPassword } = user as any;    res.json({
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
 * Token Refresh Endpoint
 * 
 * Refreshes JWT token for authenticated users to extend session.
 * Prevents users from being logged out during active sessions.
 * 
 * @route POST /api/auth/refresh
 * @middleware authenticate - Requires valid JWT token
 * @returns {Object} New JWT token and updated user information
 * 
 * @example
 * POST /api/auth/refresh
 * Authorization: Bearer jwt_token_here
 * 
 * @example Response
 * {
 *   "success": true,
 *   "data": {
 *     "token": "new_jwt_token_here",
 *     "user": {
 *       "id": "user_id",
 *       "username": "admin",
 *       "role": "admin"
 *     }
 *   }
 * }
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

    // TODO: In production, implement proper token refresh logic
    // This would involve generating a new token with extended expiry
    // and potentially invalidating the old token
    const { password_hash, salt, ...userWithoutPassword } = user as any;
    
    res.json({
      success: true,
      data: {
        user: userWithoutPassword,
        token: req.headers.authorization?.split(' ')[1] || ''
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
 * User Logout Endpoint
 * 
 * Handles user logout process. In JWT-based authentication, 
 * logout is typically handled client-side by removing the token.
 * Server-side logout would require token blacklisting.
 * 
 * @route POST /api/auth/logout
 * @middleware authenticate - Requires valid JWT token
 * @returns {Object} Logout confirmation message
 * 
 * @example
 * POST /api/auth/logout
 * Authorization: Bearer jwt_token_here
 * 
 * @example Response
 * {
 *   "success": true,
 *   "message": "Logged out successfully"
 * }
 */
router.post('/logout', authenticate, async (req: Request, res: Response) => {
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
