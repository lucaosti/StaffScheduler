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
import { authenticate, requirePermission, invalidateAuthContext } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateParams, validateBody } from '../middleware/validation';
import { RbacService } from '../services/RbacService';
import {
  idParam,
  userIdParam,
  userIdAndRoleIdParam,
  createRoleBody,
  updateRoleBody,
  assignRoleBody,
  bulkAssignRoleBody,
} from '../schemas';
import { NotFoundError } from '../errors';

export const createRbacRouter = (pool: Pool): { roles: Router; permissions: Router } => {
  const rbac = new RbacService(pool);

  const permissions = Router();
  permissions.use(authenticate, requirePermission('role.manage'));
  permissions.get('/', asyncHandler(async (_req: Request, res: Response) => {
    res.json({ success: true, data: await rbac.listPermissions() });
  }));

  const roles = Router();
  roles.use(authenticate, requirePermission('role.manage'));

  roles.get('/', asyncHandler(async (_req: Request, res: Response) => {
    res.json({ success: true, data: await rbac.listRoles() });
  }));

  roles.post('/', validateBody(createRoleBody), asyncHandler(async (_req: Request, res: Response) => {
    const created = await rbac.createRole({
      name: res.locals.body.name,
      description: res.locals.body.description,
      permissionCodes: res.locals.body.permissionCodes,
    });
    res.status(201).json({ success: true, data: created });
  }));

  roles.get('/:id', validateParams(idParam), asyncHandler(async (_req: Request, res: Response) => {
    const role = await rbac.getRoleById(res.locals.params.id);
    if (!role) throw new NotFoundError('Role not found');
    res.json({ success: true, data: role });
  }));

  roles.put('/:id', validateParams(idParam), validateBody(updateRoleBody), asyncHandler(async (_req: Request, res: Response) => {
    const updated = await rbac.updateRole(res.locals.params.id, {
      name: res.locals.body.name,
      description: res.locals.body.description,
      permissionCodes: res.locals.body.permissionCodes,
    });
    res.json({ success: true, data: updated });
  }));

  roles.delete('/:id', validateParams(idParam), asyncHandler(async (_req: Request, res: Response) => {
    await rbac.deleteRole(res.locals.params.id);
    res.json({ success: true });
  }));

  roles.post('/bulk-assign', validateBody(bulkAssignRoleBody), asyncHandler(async (req: Request, res: Response) => {
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
  }));

  roles.get('/users/:userId', validateParams(userIdParam), asyncHandler(async (_req: Request, res: Response) => {
    const assignments = await rbac.getUserRoles(res.locals.params.userId);
    res.json({ success: true, data: assignments });
  }));

  roles.post('/users/:userId', validateParams(userIdParam), validateBody(assignRoleBody), asyncHandler(async (req: Request, res: Response) => {
    const { roleId, scopeOrgUnitId, expiresAt, justification } = res.locals.body;
    await rbac.assignRole(
      res.locals.params.userId,
      roleId,
      scopeOrgUnitId ?? null,
      expiresAt ?? null,
      req.user?.id,
      justification ?? null
    );
    // Drop any cached auth context so the new grant applies immediately
    // on this instance even when the permission cache is enabled.
    invalidateAuthContext(res.locals.params.userId);
    res.status(201).json({ success: true });
  }));

  roles.delete('/users/:userId/:roleId', validateParams(userIdAndRoleIdParam), asyncHandler(async (req: Request, res: Response) => {
    const rawScope = req.query.scopeOrgUnitId;
    const scope = rawScope ? (() => {
      const n = parseInt(String(rawScope), 10);
      return isNaN(n) || n <= 0 ? null : n;
    })() : null;
    const justification = typeof req.body?.justification === 'string' ? req.body.justification : null;
    await rbac.removeRole(res.locals.params.userId, res.locals.params.roleId, scope, req.user?.id, justification);
    invalidateAuthContext(res.locals.params.userId);
    res.json({ success: true });
  }));

  return { roles, permissions };
};
