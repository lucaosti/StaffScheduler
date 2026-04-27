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
import { authenticate, requireAdmin, requireManager } from '../middleware/auth';
import { OrgUnitService } from '../services/OrgUnitService';
import { EmployeeLoanService } from '../services/EmployeeLoanService';
import { logger } from '../config/logger';

const respondError = (res: Response, status: number, code: string, message: string): void => {
  res.status(status).json({ success: false, error: { code, message } });
};

export const createOrgRouter = (pool: Pool): Router => {
  const router = Router();
  const units = new OrgUnitService(pool);
  const loans = new EmployeeLoanService(pool);

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

  router.post('/units', requireAdmin, async (req: Request, res: Response) => {
    try {
      const created = await units.create({
        name: req.body?.name,
        description: req.body?.description,
        parentId: req.body?.parentId ?? null,
        managerUserId: req.body?.managerUserId ?? null,
      });
      res.status(201).json({ success: true, data: created });
    } catch (err) {
      respondError(res, 400, 'VALIDATION_ERROR', (err as Error).message);
    }
  });

  router.put('/units/:id', requireAdmin, async (req: Request, res: Response) => {
    try {
      const updated = await units.update(Number(req.params.id), req.body ?? {});
      res.json({ success: true, data: updated });
    } catch (err) {
      const msg = (err as Error).message;
      const status = msg.includes('not found') ? 404 : 400;
      respondError(res, status, status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR', msg);
    }
  });

  router.delete('/units/:id', requireAdmin, async (req: Request, res: Response) => {
    try {
      await units.remove(Number(req.params.id));
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

  router.post('/units/:id/members', requireManager, async (req: Request, res: Response) => {
    try {
      const userId = Number(req.body?.userId);
      if (!userId) return respondError(res, 400, 'VALIDATION_ERROR', 'userId is required');
      const created = await units.addMember(
        userId,
        Number(req.params.id),
        Boolean(req.body?.isPrimary)
      );
      res.status(201).json({ success: true, data: created });
    } catch (err) {
      respondError(res, 400, 'VALIDATION_ERROR', (err as Error).message);
    }
  });

  router.patch(
    '/units/:id/members/:userId/primary',
    requireManager,
    async (req: Request, res: Response) => {
      try {
        await units.setPrimary(Number(req.params.userId), Number(req.params.id));
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
    requireManager,
    async (req: Request, res: Response) => {
      try {
        await units.removeMember(Number(req.params.userId), Number(req.params.id));
        res.json({ success: true });
      } catch (err) {
        respondError(res, 400, 'VALIDATION_ERROR', (err as Error).message);
      }
    }
  );

  // ------------- Loans -------------

  router.get('/loans', async (req: Request, res: Response) => {
    try {
      const isManager = req.user!.role === 'admin' || req.user!.role === 'manager';
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

  router.post('/loans', requireManager, async (req: Request, res: Response) => {
    try {
      const created = await loans.create({
        userId: Number(req.body?.userId),
        fromOrgUnitId: Number(req.body?.fromOrgUnitId),
        toOrgUnitId: Number(req.body?.toOrgUnitId),
        startDate: req.body?.startDate,
        endDate: req.body?.endDate,
        reason: req.body?.reason,
        requestedBy: req.user!.id,
      });
      res.status(201).json({ success: true, data: created });
    } catch (err) {
      respondError(res, 400, 'VALIDATION_ERROR', (err as Error).message);
    }
  });

  router.post('/loans/:id/approve', requireManager, async (req: Request, res: Response) => {
    try {
      const updated = await loans.approve(Number(req.params.id), req.user!.id, req.body?.notes ?? null);
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

  router.post('/loans/:id/reject', requireManager, async (req: Request, res: Response) => {
    try {
      const updated = await loans.reject(Number(req.params.id), req.user!.id, req.body?.notes ?? null);
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
