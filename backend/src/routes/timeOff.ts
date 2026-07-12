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
import { authenticate, requirePermission, userHasPermission } from '../middleware/auth';
import { validateBody, validateParams } from '../middleware/validation';
import { createTimeOffBody, optionalNotesBody, idParam } from '../schemas';
import { TimeOffService } from '../services/TimeOffService';
import { mapServiceError } from '../utils/httpErrors';
import { logger } from '../config/logger';

const respondError = (res: Response, status: number, code: string, message: string): void => {
  res.status(status).json({ success: false, error: { code, message } });
};

export const createTimeOffRouter = (pool: Pool): Router => {
  const router = Router();
  const service = new TimeOffService(pool);

  router.use(authenticate);

  router.post('/', validateBody(createTimeOffBody), async (req: Request, res: Response) => {
    try {
      const created = await service.create({
        userId: req.user!.id,
        startDate: res.locals.body.startDate,
        endDate: res.locals.body.endDate,
        type: res.locals.body.type,
        reason: res.locals.body.reason,
      });
      res.status(201).json({ success: true, data: created });
    } catch (err) {
      logger.error('time-off create failed', err);
      respondError(res, 400, 'VALIDATION_ERROR', (err as Error).message);
    }
  });

  router.get('/', async (req: Request, res: Response) => {
    try {
      const isManager = userHasPermission(req.user, 'timeoff.approve');
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

  router.get('/:id', validateParams(idParam), async (req: Request, res: Response) => {
    try {
      const { id } = res.locals.params;
      const item = await service.getById(id);
      if (!item) return respondError(res, 404, 'NOT_FOUND', 'Time-off request not found');
      const isOwn = item.userId === req.user!.id;
      const isManager = userHasPermission(req.user, 'timeoff.approve');
      if (!isOwn && !isManager) return respondError(res, 403, 'FORBIDDEN', 'Forbidden');
      res.json({ success: true, data: item });
    } catch (err) {
      logger.error('time-off get failed', err);
      respondError(res, 500, 'INTERNAL_ERROR', 'Failed to read time-off request');
    }
  });

  router.post('/:id/approve', requirePermission('timeoff.approve'), validateParams(idParam), validateBody(optionalNotesBody), async (req: Request, res: Response) => {
    try {
      const { id } = res.locals.params;
      const updated = await service.approve(id, req.user!.id, (res.locals.body.notes as string | null | undefined) ?? null);
      res.json({ success: true, data: updated });
    } catch (err) {
      const { status, code, message } = mapServiceError(err);
      respondError(res, status, code, message);
    }
  });

  router.post('/:id/reject', requirePermission('timeoff.approve'), validateParams(idParam), validateBody(optionalNotesBody), async (req: Request, res: Response) => {
    try {
      const { id } = res.locals.params;
      const updated = await service.reject(id, req.user!.id, (res.locals.body.notes as string | null | undefined) ?? null);
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
