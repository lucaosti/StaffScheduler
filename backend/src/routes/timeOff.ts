/**
 * Time-off routes (F02).
 *
 * - POST   /api/time-off                       create a request (authenticated)
 * - GET    /api/time-off                       list (own for employees, all for managers)
 * - GET    /api/time-off/:id                   read one (own or manager)
 * - POST   /api/time-off/:id/approve           manager only
 * - POST   /api/time-off/:id/reject            manager only
 * - POST   /api/time-off/:id/cancel            requester only, while pending
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { Router, Request, Response } from 'express';
import { authenticate, requireManager } from '../middleware/auth';
import { TimeOffService } from '../services/TimeOffService';
import { logger } from '../config/logger';

const respondError = (res: Response, status: number, code: string, message: string): void => {
  res.status(status).json({ success: false, error: { code, message } });
};

export const createTimeOffRouter = (pool: Pool): Router => {
  const router = Router();
  const service = new TimeOffService(pool);

  router.use(authenticate);

  router.post('/', async (req: Request, res: Response) => {
    try {
      const created = await service.create({
        userId: req.user!.id,
        startDate: req.body?.startDate,
        endDate: req.body?.endDate,
        type: req.body?.type,
        reason: req.body?.reason,
      });
      res.status(201).json({ success: true, data: created });
    } catch (err) {
      logger.error('time-off create failed', err);
      respondError(res, 400, 'VALIDATION_ERROR', (err as Error).message);
    }
  });

  router.get('/', async (req: Request, res: Response) => {
    try {
      const isManager = req.user!.role === 'admin' || req.user!.role === 'manager';
      const filters = isManager
        ? {
            userId: req.query.userId ? Number(req.query.userId) : undefined,
            status: req.query.status as never,
          }
        : { userId: req.user!.id, status: req.query.status as never };
      const list = await service.list(filters);
      res.json({ success: true, data: list });
    } catch (err) {
      logger.error('time-off list failed', err);
      respondError(res, 500, 'INTERNAL_ERROR', 'Failed to list time-off requests');
    }
  });

  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const item = await service.getById(id);
      if (!item) return respondError(res, 404, 'NOT_FOUND', 'Time-off request not found');
      const isOwn = item.userId === req.user!.id;
      const isManager = req.user!.role === 'admin' || req.user!.role === 'manager';
      if (!isOwn && !isManager) return respondError(res, 403, 'FORBIDDEN', 'Forbidden');
      res.json({ success: true, data: item });
    } catch (err) {
      logger.error('time-off get failed', err);
      respondError(res, 500, 'INTERNAL_ERROR', 'Failed to read time-off request');
    }
  });

  router.post('/:id/approve', requireManager, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const updated = await service.approve(id, req.user!.id, req.body?.notes ?? null);
      res.json({ success: true, data: updated });
    } catch (err) {
      const msg = (err as Error).message;
      const status = msg === 'Time-off request not found' ? 404 : 409;
      respondError(res, status, status === 404 ? 'NOT_FOUND' : 'CONFLICT', msg);
    }
  });

  router.post('/:id/reject', requireManager, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const updated = await service.reject(id, req.user!.id, req.body?.notes ?? null);
      res.json({ success: true, data: updated });
    } catch (err) {
      const msg = (err as Error).message;
      const status = msg === 'Time-off request not found' ? 404 : 409;
      respondError(res, status, status === 404 ? 'NOT_FOUND' : 'CONFLICT', msg);
    }
  });

  router.post('/:id/cancel', async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const updated = await service.cancel(id, req.user!.id);
      res.json({ success: true, data: updated });
    } catch (err) {
      const msg = (err as Error).message;
      const status =
        msg === 'Time-off request not found'
          ? 404
          : msg === 'Forbidden'
            ? 403
            : 409;
      const code = status === 404 ? 'NOT_FOUND' : status === 403 ? 'FORBIDDEN' : 'CONFLICT';
      respondError(res, status, code, msg);
    }
  });

  return router;
};
