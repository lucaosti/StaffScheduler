/**
 * On-call routes (F21).
 *
 *   GET    /api/on-call/periods              list (filters)
 *   POST   /api/on-call/periods              create  (manager)
 *   GET    /api/on-call/periods/:id          read
 *   PUT    /api/on-call/periods/:id          update  (manager)
 *   DELETE /api/on-call/periods/:id          delete  (manager)
 *   GET    /api/on-call/periods/:id/assignments
 *   POST   /api/on-call/periods/:id/assign   manager assigns user
 *   DELETE /api/on-call/periods/:id/assign/:userId
 *   GET    /api/on-call/me                   own on-call schedule
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { Router, Request, Response } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateParams, validateBody, validateQuery } from '../middleware/validation';
import { idParam, idAndUserIdParam, createOnCallPeriodBody, updateOnCallPeriodBody, onCallAssignBody, onCallMineQuery, onCallPeriodListQuery } from '../schemas';
import { OnCallService } from '../services/OnCallService';

const error = (res: Response, status: number, code: string, message: string): void => {
  res.status(status).json({ success: false, error: { code, message } });
};


export const createOnCallRouter = (pool: Pool): Router => {
  const router = Router();
  const service = new OnCallService(pool);

  router.use(authenticate);

  router.get('/me', validateQuery(onCallMineQuery), asyncHandler(async (req: Request, res: Response) => {
    const { start: rangeStart, end: rangeEnd } = res.locals.query;
    const data = await service.listForUser(req.user!.id, { rangeStart, rangeEnd });
    res.json({ success: true, data });
  }));

  // Read access mirrors GET /shifts (schedule.read): on-call periods are
  // schedule-adjacent data, not privileged like reports/audit/settings.
  router.get('/periods', requirePermission('schedule.read'), validateQuery(onCallPeriodListQuery), asyncHandler(async (_req: Request, res: Response) => {
    const { start: rangeStart, end: rangeEnd, departmentId, status } = res.locals.query;
    const data = await service.listPeriods({
      departmentId,
      status: status as never,
      rangeStart,
      rangeEnd,
    });
    res.json({ success: true, data });
  }));

  router.post('/periods', requirePermission('oncall.manage'), validateBody(createOnCallPeriodBody), asyncHandler(async (_req: Request, res: Response) => {
    const created = await service.createPeriod(res.locals.body);
    res.status(201).json({ success: true, data: created });
  }));

  router.get('/periods/:id', requirePermission('schedule.read'), validateParams(idParam), asyncHandler(async (_req: Request, res: Response) => {
    const period = await service.getPeriodById(res.locals.params.id);
    if (!period) return error(res, 404, 'NOT_FOUND', 'On-call period not found');
    res.json({ success: true, data: period });
  }));

  router.put('/periods/:id', requirePermission('oncall.manage'), validateParams(idParam), validateBody(updateOnCallPeriodBody), asyncHandler(async (_req: Request, res: Response) => {
    const updated = await service.updatePeriod(res.locals.params.id, res.locals.body);
    res.json({ success: true, data: updated });
  }));

  router.delete('/periods/:id', requirePermission('oncall.manage'), validateParams(idParam), asyncHandler(async (_req: Request, res: Response) => {
    await service.deletePeriod(res.locals.params.id);
    res.json({ success: true });
  }));

  router.get('/periods/:id/assignments', requirePermission('schedule.read'), validateParams(idParam), asyncHandler(async (_req: Request, res: Response) => {
    const data = await service.listAssignments(res.locals.params.id);
    res.json({ success: true, data });
  }));

  router.post('/periods/:id/assign', requirePermission('oncall.manage'), validateParams(idParam), validateBody(onCallAssignBody), asyncHandler(async (req: Request, res: Response) => {
    const data = await service.assign(
      res.locals.params.id,
      res.locals.body.userId,
      req.user!.id,
      res.locals.body.notes ?? null
    );
    res.status(201).json({ success: true, data });
  }));

  router.delete('/periods/:id/assign/:userId', requirePermission('oncall.manage'), validateParams(idAndUserIdParam), asyncHandler(async (_req: Request, res: Response) => {
    const ok = await service.unassign(res.locals.params.id, res.locals.params.userId);
    if (!ok) return error(res, 404, 'NOT_FOUND', 'Assignment not found');
    res.json({ success: true });
  }));

  return router;
};
