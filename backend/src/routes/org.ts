/**
 * Org tree, memberships, and employee loans.
 *
 * - GET    /api/org/units                    list flat
 * - GET    /api/org/units/tree               nested tree (forest)
 * - GET    /api/org/units/:id                read one
 * - POST   /api/org/units                    create (admin)
 * - PUT    /api/org/units/:id                update (admin)
 * - DELETE /api/org/units/:id                delete (admin)
 * - GET    /api/org/units/:id/members        list members
 * - POST   /api/org/units/:id/members        add member (admin/manager)
 * - PATCH  /api/org/units/:id/members/:userId/primary  set primary (admin/manager)
 * - DELETE /api/org/units/:id/members/:userId          remove (admin/manager)
 * - GET    /api/org/loans                    list loans
 * - POST   /api/org/loans                    create loan request (manager)
 * - POST   /api/org/loans/:id/approve        approve (approver)
 * - POST   /api/org/loans/:id/reject         reject (approver)
 * - POST   /api/org/loans/:id/cancel         cancel (requester)
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { Router, Request, Response } from 'express';
import { authenticate, requirePermission, userHasPermission } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateParams, validateBody } from '../middleware/validation';
import { idParam, idAndUserIdParam, createOrgUnitBody, updateOrgUnitBody, addOrgMemberBody, createLoanBody, optionalNotesBody } from '../schemas';
import { OrgUnitService } from '../services/OrgUnitService';
import { EmployeeLoanService } from '../services/EmployeeLoanService';
import { AuditLogService } from '../services/AuditLogService';

const respondError = (res: Response, status: number, code: string, message: string): void => {
  res.status(status).json({ success: false, error: { code, message } });
};

export const createOrgRouter = (pool: Pool): Router => {
  const router = Router();
  const units = new OrgUnitService(pool);
  const loans = new EmployeeLoanService(pool);
  const audit = new AuditLogService(pool);

  router.use(authenticate);

  // ------------- Org units -------------

  router.get('/units', requirePermission('org_unit.read'), asyncHandler(async (_req, res: Response) => {
    res.json({ success: true, data: await units.list() });
  }));

  router.get('/units/tree', requirePermission('org_unit.read'), asyncHandler(async (_req, res: Response) => {
    res.json({ success: true, data: await units.tree() });
  }));

  router.get('/units/:id', requirePermission('org_unit.read'), validateParams(idParam), asyncHandler(async (_req: Request, res: Response) => {
    const u = await units.getById(res.locals.params.id);
    if (!u) return respondError(res, 404, 'NOT_FOUND', 'Org unit not found');
    res.json({ success: true, data: u });
  }));

  router.post('/units', requirePermission('org_unit.manage'), validateBody(createOrgUnitBody), asyncHandler(async (req: Request, res: Response) => {
    const created = await units.create({
      name: res.locals.body.name,
      description: res.locals.body.description,
      parentId: res.locals.body.parentId ?? null,
      managerUserId: res.locals.body.managerUserId ?? null,
    });
    await audit.write({
      actorId: req.user!.id, action: 'org_unit.create',
      entityType: 'org_unit', entityId: created.id,
      after: { name: created.name, parentId: created.parentId },
    });
    res.status(201).json({ success: true, data: created });
  }));

  router.put('/units/:id', requirePermission('org_unit.manage'), validateParams(idParam), validateBody(updateOrgUnitBody), asyncHandler(async (req: Request, res: Response) => {
    const updated = await units.update(res.locals.params.id, res.locals.body);
    await audit.write({
      actorId: req.user!.id, action: 'org_unit.update',
      entityType: 'org_unit', entityId: res.locals.params.id,
      after: res.locals.body,
    });
    res.json({ success: true, data: updated });
  }));

  router.delete('/units/:id', requirePermission('org_unit.manage'), validateParams(idParam), asyncHandler(async (req: Request, res: Response) => {
    await units.remove(res.locals.params.id);
    await audit.write({
      actorId: req.user!.id, action: 'org_unit.delete',
      entityType: 'org_unit', entityId: res.locals.params.id,
    });
    res.json({ success: true });
  }));

  // ------------- Memberships -------------

  router.get('/units/:id/members', requirePermission('org_unit.read'), validateParams(idParam), asyncHandler(async (_req: Request, res: Response) => {
    res.json({ success: true, data: await units.listMembers(res.locals.params.id) });
  }));

  // Display-ready member list (name/email/position) for the "browse offices" view.
  router.get('/units/:id/members/detailed', requirePermission('org_unit.read'), validateParams(idParam), asyncHandler(async (_req: Request, res: Response) => {
    res.json({ success: true, data: await units.listMembersDetailed(res.locals.params.id) });
  }));

  // Chain of superiors for a user, from their own unit's manager up to the top
  // of the tree. Defaults to the caller; open to any authenticated user, same
  // visibility as the rest of the org tree (org_unit.read).
  router.get('/manager-chain/:userId?', asyncHandler(async (req: Request, res: Response) => {
    const targetId = req.params.userId ? Number(req.params.userId) : req.user!.id;
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return respondError(res, 400, 'VALIDATION_ERROR', 'userId must be a positive integer');
    }
    res.json({ success: true, data: await units.getManagerChain(targetId) });
  }));

  router.post('/units/:id/members', requirePermission('employee.manage'), validateParams(idParam), validateBody(addOrgMemberBody), asyncHandler(async (_req: Request, res: Response) => {
    const created = await units.addMember(
      res.locals.body.userId,
      res.locals.params.id,
      Boolean(res.locals.body.isPrimary)
    );
    res.status(201).json({ success: true, data: created });
  }));

  router.patch(
    '/units/:id/members/:userId/primary',
    requirePermission('employee.manage'),
    validateParams(idAndUserIdParam),
    asyncHandler(async (_req: Request, res: Response) => {
      const { id, userId } = res.locals.params;
      await units.setPrimary(userId, id);
      res.json({ success: true });
  })
  );

  router.delete(
    '/units/:id/members/:userId',
    requirePermission('employee.manage'),
    validateParams(idAndUserIdParam),
    asyncHandler(async (_req: Request, res: Response) => {
      const { id, userId } = res.locals.params;
      await units.removeMember(userId, id);
      res.json({ success: true });
  })
  );

  // ------------- Loans -------------

  router.get('/loans', asyncHandler(async (req: Request, res: Response) => {
    const isManager = userHasPermission(req.user, 'loan.approve');
    const filters = isManager
      ? {
          userId: req.query.userId ? Number(req.query.userId) : undefined,
          toOrgUnitId: req.query.toOrgUnitId ? Number(req.query.toOrgUnitId) : undefined,
          fromOrgUnitId: req.query.fromOrgUnitId ? Number(req.query.fromOrgUnitId) : undefined,
          status: (req.query.status as never) ?? undefined,
        }
      : { userId: req.user!.id, status: (req.query.status as never) ?? undefined };
    res.json({ success: true, data: await loans.list(filters) });
  }));

  router.post('/loans', requirePermission('loan.request'), validateBody(createLoanBody), asyncHandler(async (req: Request, res: Response) => {
    const created = await loans.create({
      userId: res.locals.body.userId,
      fromOrgUnitId: res.locals.body.fromOrgUnitId,
      toOrgUnitId: res.locals.body.toOrgUnitId,
      startDate: res.locals.body.startDate,
      endDate: res.locals.body.endDate,
      reason: res.locals.body.reason,
      requestedBy: req.user!.id,
    });
    res.status(201).json({ success: true, data: created });
  }));

  router.post('/loans/:id/approve', requirePermission('loan.approve'), validateParams(idParam), validateBody(optionalNotesBody), asyncHandler(async (req: Request, res: Response) => {
    const updated = await loans.approve(res.locals.params.id, req.user!.id, (res.locals.body.notes as string | null | undefined) ?? null);
    res.json({ success: true, data: updated });
  }));

  router.post('/loans/:id/reject', requirePermission('loan.approve'), validateParams(idParam), validateBody(optionalNotesBody), asyncHandler(async (req: Request, res: Response) => {
    const updated = await loans.reject(res.locals.params.id, req.user!.id, (res.locals.body.notes as string | null | undefined) ?? null);
    res.json({ success: true, data: updated });
  }));

  router.post('/loans/:id/cancel', validateParams(idParam), asyncHandler(async (req: Request, res: Response) => {
    const updated = await loans.cancel(res.locals.params.id, req.user!.id);
    res.json({ success: true, data: updated });
  }));

  return router;
};
