/**
 * RBAC administration routes.
 *
 * Exposes the configurable role/permission model so administrators can define
 * roles, attach permissions, and grant/revoke roles to users at runtime — with
 * no code changes. Mounted at `/api/roles` and `/api/permissions`.
 *
 *   GET    /api/permissions                 list the permission catalog
 *   GET    /api/roles                        list roles (with their permissions)
 *   POST   /api/roles                        create a role
 *   GET    /api/roles/:id                     read a role
 *   PUT    /api/roles/:id                     update a role / its permissions
 *   DELETE /api/roles/:id                     delete a non-system role
 *   POST   /api/roles/users/:userId           assign a role to a user
 *   DELETE /api/roles/users/:userId/:roleId   remove a role from a user
 *
 * All endpoints require the `role.manage` permission.
 *
 * @author Luca Ostinelli
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'mysql2/promise';
import { z } from 'zod';
import { authenticate, requirePermission } from '../middleware/auth';
import { validateParams, validateBody } from '../middleware/validation';
import { RbacService } from '../services/RbacService';
import { idParam, userIdParam, userIdAndRoleIdParam, createRoleBody, updateRoleBody } from '../schemas';
import { logger } from '../config/logger';

const assignRoleBody = z.object({
  roleId: z.number().int().positive(),
  scopeOrgUnitId: z.number().int().positive().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  justification: z.string().max(1000).nullable().optional(),
});

const bulkAssignRoleBody = z.object({
  roleId: z.number().int().positive(),
  userIds: z.array(z.number().int().positive()).min(1).max(500),
  scopeOrgUnitId: z.number().int().positive().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  justification: z.string().max(1000).nullable().optional(),
});

const respondError = (res: Response, status: number, code: string, message: string): void => {
  res.status(status).json({ success: false, error: { code, message } });
};

const statusFor = (message: string): number =>
  message.toLowerCase().includes('not found')
    ? 404
    : message.toLowerCase().includes('already exists')
      ? 409
      : message.toLowerCase().includes('cannot be deleted')
        ? 409
        : 400;

export const createRbacRouter = (pool: Pool): { roles: Router; permissions: Router } => {
  const rbac = new RbacService(pool);

  const permissions = Router();
  permissions.use(authenticate, requirePermission('role.manage'));
  permissions.get('/', async (_req: Request, res: Response) => {
    try {
      res.json({ success: true, data: await rbac.listPermissions() });
    } catch (err) {
      logger.error('list permissions failed', err);
      respondError(res, 500, 'INTERNAL_ERROR', 'Failed to list permissions');
    }
  });

  const roles = Router();
  roles.use(authenticate, requirePermission('role.manage'));

  roles.get('/', async (_req: Request, res: Response) => {
    try {
      res.json({ success: true, data: await rbac.listRoles() });
    } catch (err) {
      logger.error('list roles failed', err);
      respondError(res, 500, 'INTERNAL_ERROR', 'Failed to list roles');
    }
  });

  roles.post('/', validateBody(createRoleBody), async (_req: Request, res: Response) => {
    try {
      const created = await rbac.createRole({
        name: res.locals.body.name,
        description: res.locals.body.description,
        permissionCodes: res.locals.body.permissionCodes,
      });
      res.status(201).json({ success: true, data: created });
    } catch (err) {
      const msg = (err as Error).message;
      respondError(res, statusFor(msg), statusFor(msg) === 409 ? 'CONFLICT' : 'VALIDATION_ERROR', msg);
    }
  });

  roles.get('/:id', validateParams(idParam), async (_req: Request, res: Response) => {
    try {
      const role = await rbac.getRoleById(res.locals.params.id);
      if (!role) return respondError(res, 404, 'NOT_FOUND', 'Role not found');
      res.json({ success: true, data: role });
    } catch (err) {
      logger.error('get role failed', err);
      respondError(res, 500, 'INTERNAL_ERROR', 'Failed to read role');
    }
  });

  roles.put('/:id', validateParams(idParam), validateBody(updateRoleBody), async (_req: Request, res: Response) => {
    try {
      const updated = await rbac.updateRole(res.locals.params.id, {
        name: res.locals.body.name,
        description: res.locals.body.description,
        permissionCodes: res.locals.body.permissionCodes,
      });
      res.json({ success: true, data: updated });
    } catch (err) {
      const msg = (err as Error).message;
      respondError(res, statusFor(msg), statusFor(msg) === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR', msg);
    }
  });

  roles.delete('/:id', validateParams(idParam), async (_req: Request, res: Response) => {
    try {
      await rbac.deleteRole(res.locals.params.id);
      res.json({ success: true });
    } catch (err) {
      const msg = (err as Error).message;
      respondError(res, statusFor(msg), statusFor(msg) === 404 ? 'NOT_FOUND' : 'CONFLICT', msg);
    }
  });

  roles.post('/bulk-assign', validateBody(bulkAssignRoleBody), async (req: Request, res: Response) => {
    try {
      const { roleId, userIds, scopeOrgUnitId, expiresAt, justification } = res.locals.body;
      const result = await rbac.bulkAssignRole(
        userIds,
        roleId,
        scopeOrgUnitId ?? null,
        expiresAt ?? null,
        req.user?.id,
        justification ?? null
      );
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      respondError(res, 400, 'VALIDATION_ERROR', (err as Error).message);
    }
  });

  roles.get('/users/:userId', validateParams(userIdParam), async (_req: Request, res: Response) => {
    try {
      const assignments = await rbac.getUserRoles(res.locals.params.userId);
      res.json({ success: true, data: assignments });
    } catch (err) {
      logger.error('get user roles failed', err);
      respondError(res, 500, 'INTERNAL_ERROR', 'Failed to get user roles');
    }
  });

  roles.post('/users/:userId', validateParams(userIdParam), validateBody(assignRoleBody), async (req: Request, res: Response) => {
    try {
      const { roleId, scopeOrgUnitId, expiresAt, justification } = res.locals.body;
      await rbac.assignRole(
        res.locals.params.userId,
        roleId,
        scopeOrgUnitId ?? null,
        expiresAt ?? null,
        req.user?.id,
        justification ?? null
      );
      res.status(201).json({ success: true });
    } catch (err) {
      respondError(res, 400, 'VALIDATION_ERROR', (err as Error).message);
    }
  });

  roles.delete('/users/:userId/:roleId', validateParams(userIdAndRoleIdParam), async (req: Request, res: Response) => {
    try {
      const rawScope = req.query.scopeOrgUnitId;
      const scope = rawScope ? (() => {
        const n = parseInt(String(rawScope), 10);
        return isNaN(n) || n <= 0 ? null : n;
      })() : null;
      const justification = typeof req.body?.justification === 'string' ? req.body.justification : null;
      await rbac.removeRole(res.locals.params.userId, res.locals.params.roleId, scope, req.user?.id, justification);
      res.json({ success: true });
    } catch (err) {
      respondError(res, 400, 'VALIDATION_ERROR', (err as Error).message);
    }
  });

  return { roles, permissions };
};
