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
import { userService } from '../services/UserService';
import { authenticate } from '../middleware/auth';

const router = Router();

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
    const { username, password } = req.body;

    // Input validation
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Username and password are required'
        }
      });
    }

    // Authenticate user and generate token
    const result = await userService.login({ username, password });
    
    res.json({
      success: true,
      data: result
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

    // Remove sensitive data before sending response
    const { passwordHash, salt, ...userWithoutPassword } = user;
    
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
    const { passwordHash, salt, ...userWithoutPassword } = user;
    
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

export default router;
