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
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { createTimeOffBody, optionalNotesBody, idParam, timeOffListQuery } from '../schemas';
import { TimeOffService } from '../services/TimeOffService';
import { z } from 'zod';
import { AuditLogService } from '../services/AuditLogService';
import { ExportService } from '../services/ExportService';
import { timeOffColumns } from '../services/exportColumns';
import { accessScope } from '../middleware/accessScope';
import { scopeFilter } from '../services/access/AccessPolicy';

const respondError = (res: Response, status: number, code: string, message: string): void => {
  res.status(status).json({ success: false, error: { code, message } });
};

export const createTimeOffRouter = (pool: Pool): Router => {
  const router = Router();
  const service = new TimeOffService(pool);
  const exporter = new ExportService(new AuditLogService(pool));
  const scope = accessScope(pool);

  /**
   * The listing filters. A non-approver is pinned to their own requests, so a
   * `userId` from one is ignored rather than obeyed.
   *
   * Shared with `/export` because this is the rule that decides whether someone
   * can download other people's stated reasons for absence.
   */
  const listFilters = (req: Request, query: z.infer<typeof timeOffListQuery>) => {
    const { userId, status } = query;
    const isManager = userHasPermission(req.user, 'timeoff.approve');
    return isManager
      ? { userId, status: status as never, orgUnitIds: scopeFilter(req.user!, 'timeoff.approve') }
      : { userId: req.user!.id, status: status as never };
  };

  router.use(authenticate);

  router.post('/', validateBody(createTimeOffBody), async (req: Request, res: Response) => {
    const created = await service.create({
      userId: req.user!.id,
      startDate: res.locals.body.startDate,
      endDate: res.locals.body.endDate,
      type: res.locals.body.type,
      reason: res.locals.body.reason,
    });
    res.status(201).json({ success: true, data: created });
  });

  router.get('/', validateQuery(timeOffListQuery), async (req: Request, res: Response) => {
    const filters = listFilters(req, res.locals.query);
    const list = await service.list(filters);
    res.json({ success: true, data: list });
  });

  // Before `/:id`, so "export" is not read as a request id.
  router.get('/export', validateQuery(timeOffListQuery), async (req: Request, res: Response) => {
    const filters = listFilters(req, res.locals.query);
    const rows = await service.list(filters);
    await exporter.send(res, {
      actorId: req.user?.id ?? null,
      dataset: 'time-off',
      rows,
      columns: timeOffColumns,
      filters,
      format: res.locals.query.format,
    });
  });

  router.get('/:id', validateParams(idParam), scope.ownerOr('timeoff.approve', 'timeOff', 'params.id'), async (_req: Request, res: Response) => {
    const item = await service.getById(res.locals.params.id);
    if (!item) return respondError(res, 404, 'NOT_FOUND', 'Time-off request not found');
    res.json({ success: true, data: item });
  });

  router.post('/:id/approve', requirePermission('timeoff.approve'), validateParams(idParam), validateBody(optionalNotesBody), scope.reach('timeoff.approve', 'timeOff', 'params.id'), async (req: Request, res: Response) => {
    const { id } = res.locals.params;
    const updated = await service.approve(id, req.user!.id, (res.locals.body.notes as string | null | undefined) ?? null, req.user!.organizationName ?? null);
    res.json({ success: true, data: updated });
  });

  router.post('/:id/reject', requirePermission('timeoff.approve'), validateParams(idParam), validateBody(optionalNotesBody), scope.reach('timeoff.approve', 'timeOff', 'params.id'), async (req: Request, res: Response) => {
    const { id } = res.locals.params;
    const updated = await service.reject(id, req.user!.id, (res.locals.body.notes as string | null | undefined) ?? null, req.user!.organizationName ?? null);
    res.json({ success: true, data: updated });
  });

  router.post('/:id/cancel', validateParams(idParam), async (req: Request, res: Response) => {
    const { id } = res.locals.params;
    const updated = await service.cancel(id, req.user!.id);
    res.json({ success: true, data: updated });
  });

  return router;
};
