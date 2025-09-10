/**
 * Authentication Middleware
 * 
 * Updated to work with the real database schema and user roles.
 * Implements JWT-based authentication with proper role checking.
 * 
 * @author Luca Ostinelli
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../types';
import { UserService } from '../services/UserService';
import { config } from '../config';
import { logger } from '../config/logger';
import { database } from '../config/database';

// Extend Express Request to include user
declare module 'express-serve-static-core' {
  interface Request {
    user?: User;
  }
}

/**
 * JWT Token Payload Interface
 */
interface JWTPayload {
  userId: string;
  email: string;
  role: 'admin' | 'manager' | 'department_manager' | 'employee';
  iat?: number;
  exp?: number;
}

/**
 * Main Authentication Middleware
 * 
 * Validates JWT tokens and loads user information into the request context.
 * All protected routes must use this middleware.
 */
export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'MISSING_TOKEN',
          message: 'Authorization token is required'
        }
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify and decode JWT token
    let decodedToken: JWTPayload;
    try {
      decodedToken = jwt.verify(token, config.jwt.secret) as JWTPayload;
    } catch (error) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid or expired token'
        }
      });
    }

    // Get user from database
    const userService = new UserService(database.getPool());
    const user = await userService.getUserById(parseInt(decodedToken.userId.toString()));
    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found or inactive'
        }
      });
    }

    // Attach user to request object
    req.user = user;

    // Log authentication success
    logger.info(`User authenticated: ${user.email}`, { 
      userId: user.id, 
      role: user.role,
      endpoint: req.path 
    });

    next();
  } catch (error) {
    logger.error('Authentication error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'AUTH_ERROR',
        message: 'Authentication failed'
      }
    });
  }
};

/**
 * Role-based Authorization Middleware
 * 
 * Restricts access based on user roles. Supports multiple roles.
 * 
 * @param roles - Array of allowed roles
 * @returns Express middleware function
 */
export const requireRole = (roles: Array<'admin' | 'manager' | 'department_manager' | 'employee'>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    
    if (!user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required'
        }
      });
    }

    if (!roles.includes(user.role)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Insufficient privileges'
        }
      });
    }

    next();
  };
};

/**
 * Admin Only Middleware
 * 
 * Restricts access to admin users only.
 * Used for system-wide administrative functions.
 */
export const requireAdmin = requireRole(['admin']);

/**
 * Manager and Above Middleware
 * 
 * Allows access to admin, manager, and department_manager roles.
 * Used for management functions.
 */
export const requireManager = requireRole(['admin', 'manager', 'department_manager']);

/**
 * Check Resource Permission
 * 
 * Checks if user has permission for specific resource and action.
 * 
 * @param resource - Resource type
 * @param action - Action type
 * @returns Express middleware function
 */
export const requirePermission = (resource: string, action: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    
    if (!user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required'
        }
      });
    }

    // TODO: Implement permission checking
    // const hasPermission = userService.hasPermission(user, resource, action);
    const hasPermission = true; // For now, allow all authenticated users
    
    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: `Access denied for ${action} on ${resource}`
        }
      });
    }

    next();
  };
};
