/**
 * Attendance routes — clock-in/clock-out punches.
 *
 * - POST   /api/attendance/clock-in            clock in (authenticated, self)
 * - POST   /api/attendance/:id/clock-out       clock out own open record
 * - GET    /api/attendance                     list (own for employees, all for approvers)
 * - GET    /api/attendance/:id                 read one (own or approver)
 * - POST   /api/attendance/:id/approve         requires attendance.approve
 * - POST   /api/attendance/:id/reject          requires attendance.approve
 * - GET    /api/attendance/cost-estimate       planned vs. actual cost (payroll module)
 *
 * Gated by the `attendance` module: routes 404 for orgs where it's disabled.
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { Router, Request, Response } from 'express';
import { authenticate, requirePermission, requireModuleForUser, userHasPermission } from '../middleware/auth';
import { validateBody, validateParams } from '../middleware/validation';
import { clockInBody, optionalNotesBody, idParam } from '../schemas';
import { AttendanceService } from '../services/AttendanceService';
import { logger } from '../config/logger';

const respondError = (res: Response, status: number, code: string, message: string): void => {
  res.status(status).json({ success: false, error: { code, message } });
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const createAttendanceRouter = (pool: Pool): Router => {
  const router = Router();
  const service = new AttendanceService(pool);

  router.use(authenticate, requireModuleForUser('attendance'));

  router.post('/clock-in', validateBody(clockInBody), async (req: Request, res: Response) => {
    try {
      const created = await service.clockIn(req.user!.id, res.locals.body.notes ?? null);
      res.status(201).json({ success: true, data: created });
    } catch (err) {
      logger.error('attendance clock-in failed', err);
      respondError(res, 409, 'CONFLICT', (err as Error).message);
    }
  });

  router.post('/:id/clock-out', validateParams(idParam), validateBody(optionalNotesBody), async (req: Request, res: Response) => {
    try {
      const { id } = res.locals.params;
      const updated = await service.clockOut(req.user!.id, id, (res.locals.body.notes as string | null | undefined) ?? null);
      res.json({ success: true, data: updated });
    } catch (err) {
      const msg = (err as Error).message;
      const status = msg === 'Attendance record not found' ? 404 : msg === 'Forbidden' ? 403 : 409;
      const code = status === 404 ? 'NOT_FOUND' : status === 403 ? 'FORBIDDEN' : 'CONFLICT';
      respondError(res, status, code, msg);
    }
  });

  router.get('/cost-estimate', requireModuleForUser('payroll'), requirePermission('attendance.read'), async (req: Request, res: Response) => {
    try {
      const start = req.query.startDate as string | undefined;
      const end = req.query.endDate as string | undefined;
      if (!start || !end || !ISO_DATE_RE.test(start) || !ISO_DATE_RE.test(end)) {
        return respondError(res, 400, 'VALIDATION_ERROR', 'startDate and endDate (YYYY-MM-DD) are required');
      }
      const departmentId = req.query.departmentId ? Number(req.query.departmentId) : undefined;
      const estimate = await service.getCostEstimate({ startDate: start, endDate: end, departmentId });
      res.json({ success: true, data: estimate });
    } catch (err) {
      logger.error('attendance cost-estimate failed', err);
      respondError(res, 500, 'INTERNAL_ERROR', 'Failed to compute cost estimate');
    }
  });

  router.get('/', async (req: Request, res: Response) => {
    try {
      const isApprover = userHasPermission(req.user, 'attendance.read') || userHasPermission(req.user, 'attendance.approve');
      const filters = isApprover
        ? {
            userId: req.query.userId ? Number(req.query.userId) : undefined,
            status: req.query.status as never,
            rangeStart: req.query.startDate as string | undefined,
            rangeEnd: req.query.endDate as string | undefined,
          }
        : {
            userId: req.user!.id,
            status: req.query.status as never,
            rangeStart: req.query.startDate as string | undefined,
            rangeEnd: req.query.endDate as string | undefined,
          };
      const list = await service.list(filters);
      res.json({ success: true, data: list });
    } catch (err) {
      logger.error('attendance list failed', err);
      respondError(res, 500, 'INTERNAL_ERROR', 'Failed to list attendance records');
    }
  });

  router.get('/:id', validateParams(idParam), async (req: Request, res: Response) => {
    try {
      const { id } = res.locals.params;
      const item = await service.getById(id);
      if (!item) return respondError(res, 404, 'NOT_FOUND', 'Attendance record not found');
      const isOwn = item.userId === req.user!.id;
      const isApprover = userHasPermission(req.user, 'attendance.read') || userHasPermission(req.user, 'attendance.approve');
      if (!isOwn && !isApprover) return respondError(res, 403, 'FORBIDDEN', 'Forbidden');
      res.json({ success: true, data: item });
    } catch (err) {
      logger.error('attendance get failed', err);
      respondError(res, 500, 'INTERNAL_ERROR', 'Failed to read attendance record');
    }
  });

  router.post('/:id/approve', requirePermission('attendance.approve'), validateParams(idParam), validateBody(optionalNotesBody), async (req: Request, res: Response) => {
    try {
      const { id } = res.locals.params;
      const updated = await service.approve(id, req.user!.id, (res.locals.body.notes as string | null | undefined) ?? null);
      res.json({ success: true, data: updated });
    } catch (err) {
      const msg = (err as Error).message;
      const status = msg === 'Attendance record not found' ? 404 : 409;
      respondError(res, status, status === 404 ? 'NOT_FOUND' : 'CONFLICT', msg);
    }
  });

  router.post('/:id/reject', requirePermission('attendance.approve'), validateParams(idParam), validateBody(optionalNotesBody), async (req: Request, res: Response) => {
    try {
      const { id } = res.locals.params;
      const updated = await service.reject(id, req.user!.id, (res.locals.body.notes as string | null | undefined) ?? null);
      res.json({ success: true, data: updated });
    } catch (err) {
      const msg = (err as Error).message;
      const status = msg === 'Attendance record not found' ? 404 : 409;
      respondError(res, status, status === 404 ? 'NOT_FOUND' : 'CONFLICT', msg);
    }
  });

  return router;
};
