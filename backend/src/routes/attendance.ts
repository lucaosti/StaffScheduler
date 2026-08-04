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
import { asyncHandler } from '../middleware/asyncHandler';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { clockInBody, optionalNotesBody, idParam, costEstimateQuery, attendanceListQuery } from '../schemas';
import { AttendanceService } from '../services/AttendanceService';
import { z } from 'zod';
import { AuditLogService } from '../services/AuditLogService';
import { ExportService } from '../services/ExportService';
import { attendanceColumns } from '../services/exportColumns';

const respondError = (res: Response, status: number, code: string, message: string): void => {
  res.status(status).json({ success: false, error: { code, message } });
};


export const createAttendanceRouter = (pool: Pool): Router => {
  const router = Router();
  const service = new AttendanceService(pool);
  const exporter = new ExportService(new AuditLogService(pool));

  /**
   * The listing filters, with the caller pinned to their own records unless they
   * approve or read attendance.
   *
   * Shared with `/export`: this is the rule that decides whether someone can
   * download other people's clock-in times, and it must exist once.
   */
  const listFilters = (req: Request, query: z.infer<typeof attendanceListQuery>) => {
    const { userId, status, startDate: rangeStart, endDate: rangeEnd } = query;
    const isApprover = userHasPermission(req.user, 'attendance.read') || userHasPermission(req.user, 'attendance.approve');
    return {
      userId: isApprover ? userId : req.user!.id,
      status: status as never,
      rangeStart,
      rangeEnd,
    };
  };

  router.use(authenticate, requireModuleForUser('attendance'));

  router.post('/clock-in', validateBody(clockInBody), asyncHandler(async (req: Request, res: Response) => {
    const { notes, latitude, longitude } = res.locals.body;
    const location = latitude !== undefined && longitude !== undefined ? { lat: latitude, lng: longitude } : null;
    const created = await service.clockIn(req.user!.id, notes ?? null, location);
    res.status(201).json({ success: true, data: created });
  }));

  router.post('/:id/clock-out', validateParams(idParam), validateBody(optionalNotesBody), asyncHandler(async (req: Request, res: Response) => {
    const { id } = res.locals.params;
    const updated = await service.clockOut(req.user!.id, id, (res.locals.body.notes as string | null | undefined) ?? null);
    res.json({ success: true, data: updated });
  }));

  router.get('/cost-estimate', requireModuleForUser('payroll'), requirePermission('attendance.read'), validateQuery(costEstimateQuery), asyncHandler(async (_req: Request, res: Response) => {
    const { startDate, endDate, departmentId } = res.locals.query;
    const estimate = await service.getCostEstimate({ startDate, endDate, departmentId });
    res.json({ success: true, data: estimate });
  }));

  router.get('/', validateQuery(attendanceListQuery), asyncHandler(async (req: Request, res: Response) => {
    const filters = listFilters(req, res.locals.query);
    const list = await service.list(filters);
    res.json({ success: true, data: list });
  }));

  // Before `/:id`, so "export" is not read as a record id.
  router.get('/export', validateQuery(attendanceListQuery), asyncHandler(async (req: Request, res: Response) => {
    const filters = listFilters(req, res.locals.query);
    const rows = await service.list(filters);
    await exporter.sendCsv(res, {
      actorId: req.user?.id ?? null,
      dataset: 'attendance',
      rows,
      columns: attendanceColumns,
      filters,
    });
  }));

  router.get('/:id', validateParams(idParam), asyncHandler(async (req: Request, res: Response) => {
    const { id } = res.locals.params;
    const item = await service.getById(id);
    if (!item) return respondError(res, 404, 'NOT_FOUND', 'Attendance record not found');
    const isOwn = item.userId === req.user!.id;
    const isApprover = userHasPermission(req.user, 'attendance.read') || userHasPermission(req.user, 'attendance.approve');
    if (!isOwn && !isApprover) return respondError(res, 403, 'FORBIDDEN', 'Forbidden');
    res.json({ success: true, data: item });
  }));

  router.post('/:id/approve', requirePermission('attendance.approve'), validateParams(idParam), validateBody(optionalNotesBody), asyncHandler(async (req: Request, res: Response) => {
    const { id } = res.locals.params;
    const updated = await service.approve(id, req.user!.id, (res.locals.body.notes as string | null | undefined) ?? null);
    res.json({ success: true, data: updated });
  }));

  router.post('/:id/reject', requirePermission('attendance.approve'), validateParams(idParam), validateBody(optionalNotesBody), asyncHandler(async (req: Request, res: Response) => {
    const { id } = res.locals.params;
    const updated = await service.reject(id, req.user!.id, (res.locals.body.notes as string | null | undefined) ?? null);
    res.json({ success: true, data: updated });
  }));

  return router;
};
