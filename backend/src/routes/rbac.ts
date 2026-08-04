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
import { validateParams, validateBody, validateQuery } from '../middleware/validation';
import { RbacService } from '../services/RbacService';
import { RoleTimelineService } from '../services/RoleTimelineService';
import {
  idParam,
  userIdParam,
  userIdAndRoleIdParam,
  createRoleBody,
  updateRoleBody,
  assignRoleBody,
  bulkAssignRoleBody,
  roleRevokeQuery,
  roleTimelineQuery,
  auditJustificationBody,
} from '../schemas';
import { NotFoundError } from '../errors';

export const createRbacRouter = (pool: Pool): { roles: Router; permissions: Router } => {
  const rbac = new RbacService(pool);
  const timeline = new RoleTimelineService(pool);

  const permissions = Router();
  permissions.use(authenticate, requirePermission('role.manage'));
  permissions.get('/', async (_req: Request, res: Response) => {
    res.json({ success: true, data: await rbac.listPermissions() });
  });

  const roles = Router();
  roles.use(authenticate, requirePermission('role.manage'));

  roles.get('/', async (_req: Request, res: Response) => {
    res.json({ success: true, data: await rbac.listRoles() });
  });

  roles.post('/', validateBody(createRoleBody), async (_req: Request, res: Response) => {
    const created = await rbac.createRole({
      name: res.locals.body.name,
      description: res.locals.body.description,
      permissionCodes: res.locals.body.permissionCodes,
    });
    res.status(201).json({ success: true, data: created });
  });

  roles.get('/:id', validateParams(idParam), async (_req: Request, res: Response) => {
    const role = await rbac.getRoleById(res.locals.params.id);
    if (!role) throw new NotFoundError('Role not found');
    res.json({ success: true, data: role });
  });

  roles.put('/:id', validateParams(idParam), validateBody(updateRoleBody), async (_req: Request, res: Response) => {
    const updated = await rbac.updateRole(res.locals.params.id, {
      name: res.locals.body.name,
      description: res.locals.body.description,
      permissionCodes: res.locals.body.permissionCodes,
    });
    res.json({ success: true, data: updated });
  });

  roles.delete('/:id', validateParams(idParam), async (_req: Request, res: Response) => {
    await rbac.deleteRole(res.locals.params.id);
    res.json({ success: true });
  });

  roles.post('/bulk-assign', validateBody(bulkAssignRoleBody), async (req: Request, res: Response) => {
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
  });

  roles.get('/users/:userId', validateParams(userIdParam), async (_req: Request, res: Response) => {
    const assignments = await rbac.getUserRoles(res.locals.params.userId);
    res.json({ success: true, data: assignments });
  });

  roles.post('/users/:userId', validateParams(userIdParam), validateBody(assignRoleBody), async (req: Request, res: Response) => {
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
    await invalidateAuthContext(res.locals.params.userId);
    res.status(201).json({ success: true });
  });

  roles.delete('/users/:userId/:roleId', validateParams(userIdAndRoleIdParam), validateQuery(roleRevokeQuery), validateBody(auditJustificationBody), async (req: Request, res: Response) => {
    // A scoped grant is revoked by naming its org unit; omitting it revokes
    // the unscoped grant. The schema rejects a non-positive value outright,
    // where the inline parse used to silently coerce it to "unscoped".
    const scope = res.locals.query.scopeOrgUnitId ?? null;
    const justification = res.locals.body.justification ?? null;
    await rbac.removeRole(res.locals.params.userId, res.locals.params.roleId, scope, req.user?.id, justification);
    await invalidateAuthContext(res.locals.params.userId);
    res.json({ success: true });
  });

  /**
   * Everything that happened to one person's roles, plus what they hold now.
   *
   * Both are returned together on purpose: the current grants are authoritative
   * and the events explain them, but neither is derivable from the other — a
   * grant predating the audit log has no event, and an expired one produced no
   * event when it lapsed. See RoleTimelineService.
   */
  roles.get('/users/:userId/timeline', validateParams(userIdParam), validateQuery(roleTimelineQuery), async (_req: Request, res: Response) => {
    const data = await timeline.getTimeline({
      userId: res.locals.params.userId,
      ...(res.locals.query.since ? { since: res.locals.query.since } : {}),
    });
    res.json({ success: true, data });
  });

  /** The same, from the role's side: everyone who has ever held it. */
  roles.get('/:id/timeline', validateParams(idParam), validateQuery(roleTimelineQuery), async (_req: Request, res: Response) => {
    const data = await timeline.getTimeline({
      roleId: res.locals.params.id,
      ...(res.locals.query.since ? { since: res.locals.query.since } : {}),
    });
    res.json({ success: true, data });
  });

  return { roles, permissions };
};
