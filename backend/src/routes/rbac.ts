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
import { authenticate, requirePermission } from '../middleware/auth';
import { RbacService } from '../services/RbacService';
import { logger } from '../config/logger';

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

  roles.post('/', async (req: Request, res: Response) => {
    try {
      const created = await rbac.createRole({
        name: req.body?.name,
        description: req.body?.description,
        permissionCodes: req.body?.permissionCodes,
      });
      res.status(201).json({ success: true, data: created });
    } catch (err) {
      const msg = (err as Error).message;
      respondError(res, statusFor(msg), statusFor(msg) === 409 ? 'CONFLICT' : 'VALIDATION_ERROR', msg);
    }
  });

  roles.get('/:id', async (req: Request, res: Response) => {
    try {
      const role = await rbac.getRoleById(Number(req.params.id));
      if (!role) return respondError(res, 404, 'NOT_FOUND', 'Role not found');
      res.json({ success: true, data: role });
    } catch (err) {
      logger.error('get role failed', err);
      respondError(res, 500, 'INTERNAL_ERROR', 'Failed to read role');
    }
  });

  roles.put('/:id', async (req: Request, res: Response) => {
    try {
      const updated = await rbac.updateRole(Number(req.params.id), {
        name: req.body?.name,
        description: req.body?.description,
        permissionCodes: req.body?.permissionCodes,
      });
      res.json({ success: true, data: updated });
    } catch (err) {
      const msg = (err as Error).message;
      respondError(res, statusFor(msg), statusFor(msg) === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR', msg);
    }
  });

  roles.delete('/:id', async (req: Request, res: Response) => {
    try {
      await rbac.deleteRole(Number(req.params.id));
      res.json({ success: true });
    } catch (err) {
      const msg = (err as Error).message;
      respondError(res, statusFor(msg), statusFor(msg) === 404 ? 'NOT_FOUND' : 'CONFLICT', msg);
    }
  });

  roles.post('/users/:userId', async (req: Request, res: Response) => {
    try {
      const roleId = Number(req.body?.roleId);
      if (!roleId) return respondError(res, 400, 'VALIDATION_ERROR', 'roleId is required');
      await rbac.assignRole(
        Number(req.params.userId),
        roleId,
        req.body?.scopeOrgUnitId ?? null,
        req.body?.expiresAt ?? null
      );
      res.status(201).json({ success: true });
    } catch (err) {
      respondError(res, 400, 'VALIDATION_ERROR', (err as Error).message);
    }
  });

  roles.delete('/users/:userId/:roleId', async (req: Request, res: Response) => {
    try {
      const scope = req.query.scopeOrgUnitId ? Number(req.query.scopeOrgUnitId) : null;
      await rbac.removeRole(Number(req.params.userId), Number(req.params.roleId), scope);
      res.json({ success: true });
    } catch (err) {
      respondError(res, 400, 'VALIDATION_ERROR', (err as Error).message);
    }
  });

  return { roles, permissions };
};
