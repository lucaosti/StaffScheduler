import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../types';
import { UserService } from '../services/UserService';
import { config } from '../config';
import { logger } from '../config/logger';

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export interface AuthenticatedRequest extends Request {
  user: User;
}

export class AuthMiddleware {
  private userService: UserService;

  constructor() {
    this.userService = new UserService();
  }

  // JWT Authentication
  async authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
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

      const decoded = jwt.verify(token, config.jwt.secret) as any;
      const user = await this.userService.findById(decoded.userId);
      
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

  // Role-based authorization
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

  // Permission-based authorization
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

      // For now, simple role-based permissions
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

  // Simple permission checker
  private checkPermission(user: User, resource: string, action: string): boolean {
    if (user.role === 'admin') return true;
    if (user.role === 'manager') {
      const managerResources = ['employees', 'shifts', 'schedules', 'reports'];
      return managerResources.includes(resource);
    }
    if (user.role === 'employee') {
      const employeeResources = ['schedules'];
      return employeeResources.includes(resource) && action === 'read';
    }
    return false;
  }
}

// Create singleton instance
export const authMiddleware = new AuthMiddleware();
export const authenticate = authMiddleware.authenticate.bind(authMiddleware);
export const authorize = authMiddleware.authorize.bind(authMiddleware);
export const requirePermission = authMiddleware.requirePermission.bind(authMiddleware);

export default authMiddleware;
