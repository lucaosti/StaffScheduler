/**
 * Authentication Middleware
 * 
 * Provides JWT-based authentication and role-based authorization for API endpoints.
 * Implements secure token validation, user verification, and hierarchical permissions.
 * 
 * Features:
 * - JWT token validation and decoding
 * - User status verification (active/inactive)
 * - Role-based access control
 * - Hierarchical permission checking
 * - Request context enhancement with user data
 * 
 * @author Luca Ostinelli
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../types';
import { UserService } from '../services/UserService';
import { config } from '../config';
import { logger } from '../config/logger';

/**
 * Extend Express Request Interface
 * 
 * Adds user property to Express Request object for authenticated routes.
 * Allows middleware to attach user information for downstream handlers.
 */
declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

/**
 * Authenticated Request Interface
 * 
 * Type-safe interface for requests that have been authenticated.
 * Guarantees that user property is available and populated.
 */
export interface AuthenticatedRequest extends Request {
  user: User;
}

/**
 * Authentication Middleware Class
 * 
 * Handles all authentication and authorization logic for API endpoints.
 * Provides methods for token validation, role checking, and permission verification.
 */
export class AuthMiddleware {
  private userService: UserService;

  constructor() {
    this.userService = new UserService();
  }

  /**
   * JWT Authentication Middleware
   * 
   * Validates JWT tokens and attaches user information to request context.
   * Ensures only authenticated users can access protected endpoints.
   * 
   * @param req - Express request object
   * @param res - Express response object  
   * @param next - Express next function
   * 
   * @throws {401} When token is missing, invalid, or user is inactive
   * @throws {403} When user account is disabled or suspended
   * 
   * @example
   * router.get('/protected', authenticate, (req, res) => {
   *   // req.user is now available and contains user data
   *   const currentUser = req.user;
   * });
   */
  async authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Extract token from Authorization header (Bearer format)
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

      if (!token) {
        res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication token required'
          }
        });
        return;
      }

      // Verify and decode JWT token
      const decoded = jwt.verify(token, config.jwt.secret) as any;
      
      // Fetch current user data from database
      const user = await this.userService.findById(decoded.userId);
      
      // Verify user exists and is active
      if (!user || !user.isActive) {
        res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'User not found or inactive'
          }
        });
        return;
      }

      // Attach user to request context for downstream handlers
      req.user = user;
      next();
    } catch (error) {
      logger.warn('Authentication failed', { error: (error as Error).message });
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired token'
        }
      });
    }
  }

  /**
   * Role-Based Authorization Middleware
   * 
   * Restricts access to endpoints based on user roles.
   * Supports multiple roles for flexible access control.
   * 
   * @param roles - Array of allowed roles for the endpoint
   * @returns Express middleware function
   * 
   * @example
   * // Only admins and managers can access
   * router.post('/admin-action', 
   *   authenticate, 
   *   authorize(['admin', 'manager']), 
   *   handlerFunction
   * );
   */
  authorize(roles: ('admin' | 'manager' | 'employee')[]): (req: Request, res: Response, next: NextFunction) => void {
    return (req: Request, res: Response, next: NextFunction): void => {
      const user = req.user;
      if (!user) {
        res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required'
          }
        });
        return;
      }

      // Check if user's role is in the allowed roles list
      if (!roles.includes(user.role)) {
        res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Insufficient permissions'
          }
        });
        return;
      }

      next();
    };
  }

  /**
   * Permission-Based Authorization Middleware
   * 
   * Provides fine-grained access control based on specific permissions.
   * Supports resource-action combinations for detailed authorization.
   * 
   * @param resource - The resource being accessed (e.g., 'employees', 'shifts')
   * @param action - The action being performed (e.g., 'read', 'write', 'delete')
   * @returns Express middleware function
   * 
   * @example
   * router.delete('/employees/:id', 
   *   authenticate, 
   *   requirePermission('employees', 'delete'), 
   *   deleteEmployeeHandler
   * );
   */
  requirePermission(
    resource: string, 
    action: string
  ): (req: Request, res: Response, next: NextFunction) => void {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const user = req.user;
      if (!user) {
        res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required'
          }
        });
        return;
      }

      // Check if user has the required permission
      const hasPermission = this.checkPermission(user, resource, action);
      
      if (!hasPermission) {
        res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: `Permission denied for ${action} on ${resource}`
          }
        });
        return;
      }

      next();
    };
  }

  /**
   * Permission Checker Helper
   * 
   * Determines if a user has permission to perform an action on a resource.
   * Implements hierarchical permission model with role-based defaults.
   * 
   * @param user - The user to check permissions for
   * @param resource - The resource being accessed
   * @param action - The action being performed
   * @returns Boolean indicating if permission is granted
   * 
   * Permission Hierarchy:
   * - Admin: Full access to all resources and actions
   * - Manager: Read/write access to operational resources
   * - Employee: Read-only access to personal schedules
   */
  private checkPermission(user: User, resource: string, action: string): boolean {
    // Admins have full access to everything
    if (user.role === 'admin') return true;
    
    // Managers have access to operational resources
    if (user.role === 'manager') {
      const managerResources = ['employees', 'shifts', 'schedules', 'reports'];
      return managerResources.includes(resource);
    }
    
    // Employees have limited read-only access
    if (user.role === 'employee') {
      const employeeResources = ['schedules'];
      return employeeResources.includes(resource) && action === 'read';
    }
    
    return false;
  }
}

/**
 * Singleton Instance Creation
 * 
 * Creates and exports a singleton instance of the AuthMiddleware class.
 * Provides convenient exported functions for use in route definitions.
 */
export const authMiddleware = new AuthMiddleware();

/**
 * Exported Middleware Functions
 * 
 * Bound methods from the singleton instance for direct use in Express routes.
 * Maintains proper 'this' context while providing clean import syntax.
 */
export const authenticate = authMiddleware.authenticate.bind(authMiddleware);
export const authorize = authMiddleware.authorize.bind(authMiddleware);
export const requirePermission = authMiddleware.requirePermission.bind(authMiddleware);

export default authMiddleware;
