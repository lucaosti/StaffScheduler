/**
 * Shift swap routes (F01).
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { Router, Request, Response } from 'express';
import { authenticate, requirePermission, userHasPermission } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { createShiftSwapBody, optionalNotesBody, idParam, shiftSwapListQuery } from '../schemas';
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

  router.get('/', validateQuery(shiftSwapListQuery), asyncHandler(async (req: Request, res: Response) => {
    const { userId, status } = res.locals.query;
    // Approvers may list anyone's requests; everyone else is pinned to their
    // own, so a userId filter from a non-approver is ignored rather than obeyed.
    const isManager = userHasPermission(req.user, 'shiftswap.approve');
    const filters = {
      userId: isManager ? userId : req.user!.id,
      status: status as never,
    };
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
