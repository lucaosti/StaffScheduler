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
import { asyncHandler } from '../middleware/asyncHandler';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { createTimeOffBody, optionalNotesBody, idParam, timeOffListQuery } from '../schemas';
import { TimeOffService } from '../services/TimeOffService';

const respondError = (res: Response, status: number, code: string, message: string): void => {
  res.status(status).json({ success: false, error: { code, message } });
};

export const createTimeOffRouter = (pool: Pool): Router => {
  const router = Router();
  const service = new TimeOffService(pool);

  router.use(authenticate);

  router.post('/', validateBody(createTimeOffBody), asyncHandler(async (req: Request, res: Response) => {
    const created = await service.create({
      userId: req.user!.id,
      startDate: res.locals.body.startDate,
      endDate: res.locals.body.endDate,
      type: res.locals.body.type,
      reason: res.locals.body.reason,
    });
    res.status(201).json({ success: true, data: created });
  }));

  router.get('/', validateQuery(timeOffListQuery), asyncHandler(async (req: Request, res: Response) => {
    const { userId, status } = res.locals.query;
    // Approvers may list anyone's requests; everyone else is pinned to their
    // own, so a userId filter from a non-approver is ignored rather than obeyed.
    const isManager = userHasPermission(req.user, 'timeoff.approve');
    const filters = isManager
      ? { userId, status: status as never }
      : { userId: req.user!.id, status: status as never };
    const list = await service.list(filters);
    res.json({ success: true, data: list });
  }));

  router.get('/:id', validateParams(idParam), asyncHandler(async (req: Request, res: Response) => {
    const { id } = res.locals.params;
    const item = await service.getById(id);
    if (!item) return respondError(res, 404, 'NOT_FOUND', 'Time-off request not found');
    const isOwn = item.userId === req.user!.id;
    const isManager = userHasPermission(req.user, 'timeoff.approve');
    if (!isOwn && !isManager) return respondError(res, 403, 'FORBIDDEN', 'Forbidden');
    res.json({ success: true, data: item });
  }));

  router.post('/:id/approve', requirePermission('timeoff.approve'), validateParams(idParam), validateBody(optionalNotesBody), asyncHandler(async (req: Request, res: Response) => {
    const { id } = res.locals.params;
    const updated = await service.approve(id, req.user!.id, (res.locals.body.notes as string | null | undefined) ?? null);
    res.json({ success: true, data: updated });
  }));

  router.post('/:id/reject', requirePermission('timeoff.approve'), validateParams(idParam), validateBody(optionalNotesBody), asyncHandler(async (req: Request, res: Response) => {
    const { id } = res.locals.params;
    const updated = await service.reject(id, req.user!.id, (res.locals.body.notes as string | null | undefined) ?? null);
    res.json({ success: true, data: updated });
  }));

  router.post('/:id/cancel', validateParams(idParam), asyncHandler(async (req: Request, res: Response) => {
    const { id } = res.locals.params;
    const updated = await service.cancel(id, req.user!.id);
    res.json({ success: true, data: updated });
  }));

  return router;
};
