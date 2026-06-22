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

// In-memory JTI blacklist for server-side token revocation on logout.
// Each entry stores the expiry timestamp (ms). A background interval prunes
// expired entries every hour so the map stays bounded even under sustained
// logout traffic. MAX_JTI_BLACKLIST_SIZE caps absolute memory usage.
const MAX_JTI_BLACKLIST_SIZE = 100_000;
const _jtiBlacklist = new Map<string, number>();

const _pruneBlacklist = (): void => {
  const now = Date.now();
  for (const [jti, exp] of _jtiBlacklist) {
    if (now > exp) _jtiBlacklist.delete(jti);
  }
};

// Prune every hour regardless of access patterns.
const _pruneInterval = setInterval(_pruneBlacklist, 60 * 60 * 1000);
_pruneInterval.unref(); // don't block process exit

export const addToBlacklist = (jti: string, expiresAt?: number): void => {
  // Drop oldest entry if at capacity (FIFO approximation).
  if (_jtiBlacklist.size >= MAX_JTI_BLACKLIST_SIZE) {
    const firstKey = _jtiBlacklist.keys().next().value;
    if (firstKey !== undefined) _jtiBlacklist.delete(firstKey);
  }
  const exp = expiresAt ?? Date.now() + 24 * 60 * 60 * 1000; // default: 24 h
  _jtiBlacklist.set(jti, exp);
};

const _isBlacklisted = (jti: string): boolean => {
  const exp = _jtiBlacklist.get(jti);
  if (exp === undefined) return false;
  if (Date.now() > exp) {
    _jtiBlacklist.delete(jti); // prune expired entry on access
    return false;
  }
  return true;
};

// Extend Express Request to include user and token JTI
declare module 'express-serve-static-core' {
  interface Request {
    user?: User;
    tokenJti?: string;
    tokenExp?: number; // ms timestamp of token expiry, used to set blacklist TTL
  }
}

/**
 * JWT Token Payload Interface
 */
interface JWTPayload {
  userId: string;
  jti?: string;
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
    // Accept token from httpOnly cookie first, then Authorization header.
    const cookieToken: string | undefined = req.cookies?.token;
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
    const token = cookieToken || bearerToken;

    if (!token) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'MISSING_TOKEN',
          message: 'Authorization token is required'
        }
      });
    }

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

    if (decodedToken.jti && _isBlacklisted(decodedToken.jti)) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'TOKEN_REVOKED',
          message: 'Token has been revoked'
        }
      });
    }

    if (decodedToken.jti) {
      req.tokenJti = decodedToken.jti;
      if (decodedToken.exp) req.tokenExp = decodedToken.exp * 1000; // convert JWT seconds to ms
    }

    const pool = database.getPool();
    const userService = new UserService(pool);
    const rawUserId = decodedToken.userId;
    if (typeof rawUserId !== 'string' && typeof rawUserId !== 'number') {
      return res.status(401).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid token payload' } });
    }
    const userId = parseInt(String(rawUserId), 10);
    if (isNaN(userId) || userId <= 0) {
      return res.status(401).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid token payload' } });
    }
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
      return res.status(503).json({
        success: false,
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable' },
      });
    }
  };
};
