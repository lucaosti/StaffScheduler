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
import { validateParams, validateBody } from '../middleware/validation';
import { idParam, idAndUserIdParam, createOrgUnitBody, updateOrgUnitBody, addOrgMemberBody, createLoanBody, optionalNotesBody } from '../schemas';
import { OrgUnitService } from '../services/OrgUnitService';
import { EmployeeLoanService } from '../services/EmployeeLoanService';
import { AuditLogService } from '../services/AuditLogService';
import { logger } from '../config/logger';

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

  router.get('/units', async (_req, res: Response) => {
    try {
      res.json({ success: true, data: await units.list() });
    } catch (err) {
      logger.error('org units list failed', err);
      respondError(res, 500, 'INTERNAL_ERROR', 'Failed to list org units');
    }
  });

  router.get('/units/tree', async (_req, res: Response) => {
    try {
      res.json({ success: true, data: await units.tree() });
    } catch (err) {
      logger.error('org tree failed', err);
      respondError(res, 500, 'INTERNAL_ERROR', 'Failed to build org tree');
    }
  });

  router.get('/units/:id', async (req: Request, res: Response) => {
    try {
      const u = await units.getById(Number(req.params.id));
      if (!u) return respondError(res, 404, 'NOT_FOUND', 'Org unit not found');
      res.json({ success: true, data: u });
    } catch (err) {
      logger.error('org unit get failed', err);
      respondError(res, 500, 'INTERNAL_ERROR', 'Failed to read org unit');
    }
  });

  router.post('/units', requirePermission('org_unit.manage'), validateBody(createOrgUnitBody), async (req: Request, res: Response) => {
    try {
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
    } catch (err) {
      respondError(res, 400, 'VALIDATION_ERROR', (err as Error).message);
    }
  });

  router.put('/units/:id', requirePermission('org_unit.manage'), validateParams(idParam), validateBody(updateOrgUnitBody), async (req: Request, res: Response) => {
    try {
      const updated = await units.update(res.locals.params.id, res.locals.body);
      await audit.write({
        actorId: req.user!.id, action: 'org_unit.update',
        entityType: 'org_unit', entityId: res.locals.params.id,
        after: res.locals.body,
      });
      res.json({ success: true, data: updated });
    } catch (err) {
      const msg = (err as Error).message;
      const status = msg.includes('not found') ? 404 : 400;
      respondError(res, status, status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR', msg);
    }
  });

  router.delete('/units/:id', requirePermission('org_unit.manage'), async (req: Request, res: Response) => {
    try {
      await units.remove(Number(req.params.id));
      await audit.write({
        actorId: req.user!.id, action: 'org_unit.delete',
        entityType: 'org_unit', entityId: Number(req.params.id),
      });
      res.json({ success: true });
    } catch (err) {
      const msg = (err as Error).message;
      const status = msg.includes('not found') ? 404 : 400;
      respondError(res, status, status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR', msg);
    }
  });

  // ------------- Memberships -------------

  router.get('/units/:id/members', async (req: Request, res: Response) => {
    try {
      res.json({ success: true, data: await units.listMembers(Number(req.params.id)) });
    } catch (err) {
      logger.error('members list failed', err);
      respondError(res, 500, 'INTERNAL_ERROR', 'Failed to list members');
    }
  });

  router.post('/units/:id/members', requirePermission('employee.manage'), validateParams(idParam), validateBody(addOrgMemberBody), async (_req: Request, res: Response) => {
    try {
      const created = await units.addMember(
        res.locals.body.userId,
        res.locals.params.id,
        Boolean(res.locals.body.isPrimary)
      );
      res.status(201).json({ success: true, data: created });
    } catch (err) {
      respondError(res, 400, 'VALIDATION_ERROR', (err as Error).message);
    }
  });

  router.patch(
    '/units/:id/members/:userId/primary',
    requirePermission('employee.manage'),
    validateParams(idAndUserIdParam),
    async (_req: Request, res: Response) => {
      try {
        const { id, userId } = res.locals.params;
        await units.setPrimary(userId, id);
        res.json({ success: true });
      } catch (err) {
        const msg = (err as Error).message;
        const status = msg.includes('not found') ? 404 : 400;
        respondError(res, status, status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR', msg);
      }
    }
  );

  router.delete(
    '/units/:id/members/:userId',
    requirePermission('employee.manage'),
    validateParams(idAndUserIdParam),
    async (_req: Request, res: Response) => {
      try {
        const { id, userId } = res.locals.params;
        await units.removeMember(userId, id);
        res.json({ success: true });
      } catch (err) {
        respondError(res, 400, 'VALIDATION_ERROR', (err as Error).message);
      }
    }
  );

  // ------------- Loans -------------

  router.get('/loans', async (req: Request, res: Response) => {
    try {
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
    } catch (err) {
      logger.error('loan list failed', err);
      respondError(res, 500, 'INTERNAL_ERROR', 'Failed to list loans');
    }
  });

  router.post('/loans', requirePermission('loan.request'), validateBody(createLoanBody), async (req: Request, res: Response) => {
    try {
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
    } catch (err) {
      respondError(res, 400, 'VALIDATION_ERROR', (err as Error).message);
    }
  });

  router.post('/loans/:id/approve', requirePermission('loan.approve'), validateBody(optionalNotesBody), async (req: Request, res: Response) => {
    try {
      const updated = await loans.approve(Number(req.params.id), req.user!.id, (res.locals.body.notes as string | null | undefined) ?? null);
      res.json({ success: true, data: updated });
    } catch (err) {
      const msg = (err as Error).message;
      const status =
        msg.includes('not found') ? 404 : msg === 'Forbidden' ? 403 : 409;
      const code =
        status === 404 ? 'NOT_FOUND' : status === 403 ? 'FORBIDDEN' : 'CONFLICT';
      respondError(res, status, code, msg);
    }
  });

  router.post('/loans/:id/reject', requirePermission('loan.approve'), validateBody(optionalNotesBody), async (req: Request, res: Response) => {
    try {
      const updated = await loans.reject(Number(req.params.id), req.user!.id, (res.locals.body.notes as string | null | undefined) ?? null);
      res.json({ success: true, data: updated });
    } catch (err) {
      const msg = (err as Error).message;
      const status =
        msg.includes('not found') ? 404 : msg === 'Forbidden' ? 403 : 409;
      const code =
        status === 404 ? 'NOT_FOUND' : status === 403 ? 'FORBIDDEN' : 'CONFLICT';
      respondError(res, status, code, msg);
    }
  });

  router.post('/loans/:id/cancel', async (req: Request, res: Response) => {
    try {
      const updated = await loans.cancel(Number(req.params.id), req.user!.id);
      res.json({ success: true, data: updated });
    } catch (err) {
      const msg = (err as Error).message;
      const status =
        msg.includes('not found') ? 404 : msg === 'Forbidden' ? 403 : 409;
      const code = status === 404 ? 'NOT_FOUND' : status === 403 ? 'FORBIDDEN' : 'CONFLICT';
      respondError(res, status, code, msg);
    }
  });

  return router;
};
