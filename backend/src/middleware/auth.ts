/**
 * Authentication & Authorization Middleware
 *
 * JWT-based authentication plus permission-based authorization. The former
 * hardcoded role checks (`requireAdmin` / `requireManager` / `requireRole`)
 * have been replaced by `requirePermission(code)`, which consults the user's
 * effective permissions resolved from the configurable RBAC model. The token
 * carries only the user id; permissions are resolved from the database on every
 * request so role/permission changes take effect immediately.
 *
 * @author Luca Ostinelli
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../types';
import { UserService } from '../services/UserService';
import { RbacService } from '../services/RbacService';
import { ModuleService } from '../services/ModuleService';
import { config } from '../config';
import { logger } from '../config/logger';
import { database } from '../config/database';

// Single ModuleService instance per process — shares the in-process cache.
let _moduleService: ModuleService | null = null;
const getModuleService = (): ModuleService => {
  if (!_moduleService) _moduleService = new ModuleService(database.getPool());
  return _moduleService;
};

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
  iat?: number;
  exp?: number;
}

/**
 * Returns true when the authenticated user holds the given permission code.
 * Safe to call in route bodies for finer-grained, in-handler authorization.
 */
export const userHasPermission = (user: User | undefined, code: string): boolean =>
  Boolean(user?.permissions?.includes(code));

/**
 * Main Authentication Middleware
 *
 * Validates JWT tokens, loads the user and their effective permissions into the
 * request context. All protected routes must use this middleware.
 */
export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  try {
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

    let decodedToken: JWTPayload;
    try {
      decodedToken = jwt.verify(token, config.jwt.secret) as JWTPayload;
    } catch (_error) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid or expired token'
        }
      });
    }

    const pool = database.getPool();
    const userService = new UserService(pool);
    const userId = parseInt(decodedToken.userId.toString());
    const user = await userService.getUserById(userId);
    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found or inactive'
        }
      });
    }

    // Resolve effective permissions and role assignments for this request.
    const rbac = new RbacService(pool);
    const [permissions, roles] = await Promise.all([
      rbac.getEffectivePermissions(userId),
      rbac.getUserRoles(userId),
    ]);
    user.permissions = permissions;
    user.roles = roles;

    // Compute the org-unit scope for data filtering. For users with no scoped
    // roles this is a no-op (null = full access, zero extra queries).
    user.allowedOrgUnitIds = await rbac.computeAllowedOrgUnitIds(roles);

    req.user = user;

    logger.debug('User authenticated', { userId: user.id });

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
 * Permission-based Authorization Middleware
 *
 * Restricts access to users holding the given permission code. Replaces the
 * previous role-based guards.
 *
 * @param code - Required permission code (e.g. `schedule.manage`)
 */
export const requirePermission = (code: string) => {
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

    if (!userHasPermission(user, code)) {
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
 * Module-guard Middleware
 *
 * Returns 404 when the specified module is disabled so that consumers (both
 * authenticated and unauthenticated) get no signal about the route's
 * existence. Call this BEFORE `authenticate` on routes where the entire
 * module should be invisible.
 *
 * @param code - Module code to check (e.g. `reporting`, `notifications`)
 */
export const requireModule = (code: string) => {
  return async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const enabled = await getModuleService().isEnabled(code);
      if (!enabled) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Not Found' },
        });
      }
      next();
    } catch (err) {
      logger.error('requireModule check failed:', err);
      // Fail open: let the request through if module status cannot be determined.
      next();
    }
  };
};
