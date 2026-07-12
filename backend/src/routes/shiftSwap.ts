/**
 * Shift swap routes (F01).
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { Router, Request, Response } from 'express';
import { authenticate, requirePermission, userHasPermission } from '../middleware/auth';
import { validateBody, validateParams } from '../middleware/validation';
import { createShiftSwapBody, optionalNotesBody, idParam } from '../schemas';
import { ShiftSwapService } from '../services/ShiftSwapService';
import { mapServiceError } from '../utils/httpErrors';
import { logger } from '../config/logger';

const respondError = (res: Response, status: number, code: string, message: string): void => {
  res.status(status).json({ success: false, error: { code, message } });
};

export const createShiftSwapRouter = (pool: Pool): Router => {
  const router = Router();
  const service = new ShiftSwapService(pool);

  router.use(authenticate);

  router.post('/', validateBody(createShiftSwapBody), async (req: Request, res: Response) => {
    try {
      const created = await service.create({
        requesterUserId: req.user!.id,
        requesterAssignmentId: res.locals.body.requesterAssignmentId,
        targetAssignmentId: res.locals.body.targetAssignmentId,
        notes: res.locals.body.notes,
      });
      res.status(201).json({ success: true, data: created });
    } catch (err) {
      logger.error('shift-swap create failed', err);
      respondError(res, 400, 'VALIDATION_ERROR', (err as Error).message);
    }
  });

  router.get('/', async (req: Request, res: Response) => {
    try {
      const isManager = userHasPermission(req.user, 'shiftswap.approve');
      const filters = isManager
        ? {
            userId: req.query.userId ? Number(req.query.userId) : undefined,
            status: req.query.status as never,
          }
        : { userId: req.user!.id, status: req.query.status as never };
      const list = await service.list(filters);
      res.json({ success: true, data: list });
    } catch (err) {
      logger.error('shift-swap list failed', err);
      respondError(res, 500, 'INTERNAL_ERROR', 'Failed to list swap requests');
    }
  });

  router.get('/:id', validateParams(idParam), async (req: Request, res: Response) => {
    try {
      const { id } = res.locals.params;
      const item = await service.getById(id);
      if (!item) return respondError(res, 404, 'NOT_FOUND', 'Shift swap request not found');
      const involves =
        item.requesterUserId === req.user!.id || item.targetUserId === req.user!.id;
      const isManager = userHasPermission(req.user, 'shiftswap.approve');
      if (!involves && !isManager) return respondError(res, 403, 'FORBIDDEN', 'Forbidden');
      res.json({ success: true, data: item });
    } catch (err) {
      logger.error('shift-swap get failed', err);
      respondError(res, 500, 'INTERNAL_ERROR', 'Failed to read swap request');
    }
  });

  router.post('/:id/approve', requirePermission('shiftswap.approve'), validateParams(idParam), validateBody(optionalNotesBody), async (req: Request, res: Response) => {
    try {
      const { id } = res.locals.params;
      const updated = await service.approve(id, req.user!.id, (res.locals.body.notes as string | null | undefined) ?? null);
      res.json({ success: true, data: updated });
    } catch (err) {
      const { status, code, message } = mapServiceError(err);
      respondError(res, status, code, message);
    }
  });

  router.post('/:id/decline', requirePermission('shiftswap.approve'), validateParams(idParam), validateBody(optionalNotesBody), async (req: Request, res: Response) => {
    try {
      const { id } = res.locals.params;
      const updated = await service.decline(id, req.user!.id, (res.locals.body.notes as string | null | undefined) ?? null);
      res.json({ success: true, data: updated });
    } catch (err) {
      const { status, code, message } = mapServiceError(err);
      respondError(res, status, code, message);
    }
  });

  router.post('/:id/cancel', validateParams(idParam), async (req: Request, res: Response) => {
    try {
      const { id } = res.locals.params;
      const updated = await service.cancel(id, req.user!.id);
      res.json({ success: true, data: updated });
    } catch (err) {
      const { status, code, message } = mapServiceError(err);
      respondError(res, status, code, message);
    }
  });

  return router;
};
