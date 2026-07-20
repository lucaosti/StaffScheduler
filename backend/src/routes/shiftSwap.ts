/**
 * Shift swap routes (F01).
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { Router, Request, Response } from 'express';
import { authenticate, requirePermission, userHasPermission } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateBody, validateParams } from '../middleware/validation';
import { createShiftSwapBody, optionalNotesBody, idParam } from '../schemas';
import { ShiftSwapService } from '../services/ShiftSwapService';

const respondError = (res: Response, status: number, code: string, message: string): void => {
  res.status(status).json({ success: false, error: { code, message } });
};

export const createShiftSwapRouter = (pool: Pool): Router => {
  const router = Router();
  const service = new ShiftSwapService(pool);

  router.use(authenticate);

  router.post('/', validateBody(createShiftSwapBody), asyncHandler(async (req: Request, res: Response) => {
    const created = await service.create({
      requesterUserId: req.user!.id,
      requesterAssignmentId: res.locals.body.requesterAssignmentId,
      targetAssignmentId: res.locals.body.targetAssignmentId,
      notes: res.locals.body.notes,
    });
    res.status(201).json({ success: true, data: created });
  }));

  router.get('/', asyncHandler(async (req: Request, res: Response) => {
    const isManager = userHasPermission(req.user, 'shiftswap.approve');
    const filters = isManager
      ? {
          userId: req.query.userId ? Number(req.query.userId) : undefined,
          status: req.query.status as never,
        }
      : { userId: req.user!.id, status: req.query.status as never };
    const list = await service.list(filters);
    res.json({ success: true, data: list });
  }));

  router.get('/:id', validateParams(idParam), asyncHandler(async (req: Request, res: Response) => {
    const { id } = res.locals.params;
    const item = await service.getById(id);
    if (!item) return respondError(res, 404, 'NOT_FOUND', 'Shift swap request not found');
    const involves =
      item.requesterUserId === req.user!.id || item.targetUserId === req.user!.id;
    const isManager = userHasPermission(req.user, 'shiftswap.approve');
    if (!involves && !isManager) return respondError(res, 403, 'FORBIDDEN', 'Forbidden');
    res.json({ success: true, data: item });
  }));

  router.post('/:id/approve', requirePermission('shiftswap.approve'), validateParams(idParam), validateBody(optionalNotesBody), asyncHandler(async (req: Request, res: Response) => {
    const { id } = res.locals.params;
    const updated = await service.approve(id, req.user!.id, (res.locals.body.notes as string | null | undefined) ?? null);
    res.json({ success: true, data: updated });
  }));

  router.post('/:id/decline', requirePermission('shiftswap.approve'), validateParams(idParam), validateBody(optionalNotesBody), asyncHandler(async (req: Request, res: Response) => {
    const { id } = res.locals.params;
    const updated = await service.decline(id, req.user!.id, (res.locals.body.notes as string | null | undefined) ?? null);
    res.json({ success: true, data: updated });
  }));

  router.post('/:id/cancel', validateParams(idParam), asyncHandler(async (req: Request, res: Response) => {
    const { id } = res.locals.params;
    const updated = await service.cancel(id, req.user!.id);
    res.json({ success: true, data: updated });
  }));

  return router;
};
