import { Router, Request, Response } from 'express';
import { Pool } from 'mysql2/promise';
import { ScheduleService } from '../services/ScheduleService';
import { authenticate, requirePermission } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { parsePagination, sendPaginated } from '../middleware/pagination';
import { validateParams, validateBody } from '../middleware/validation';
import {
  idParam,
  departmentIdParam,
  userIdParam,
  createScheduleBody,
  duplicateScheduleBody,
  updateScheduleBody,
} from '../schemas';

export const createSchedulesRouter = (pool: Pool) => {
  const router = Router();
  const scheduleService = new ScheduleService(pool);

// Get all schedules
router.get('/', authenticate, requirePermission('schedule.read'), asyncHandler(async (req: Request, res: Response) => {
  const scope = req.user?.allowedOrgUnitIds;
  const filters = scope !== null && scope !== undefined ? { orgUnitIds: scope } : undefined;
  const pagination = parsePagination(req);
  if (pagination) {
    const [total, schedules] = await Promise.all([
      scheduleService.countSchedules(filters),
      scheduleService.getAllSchedules(filters, { limit: pagination.pageSize, offset: pagination.offset }),
    ]);
    return sendPaginated(res, schedules, total, pagination);
  }
  const schedules = await scheduleService.getAllSchedules(filters);
  res.json({ success: true, data: schedules });
}));

// Get schedule by ID
router.get('/:id', authenticate, requirePermission('schedule.read'), validateParams(idParam), asyncHandler(async (req: Request, res: Response) => {
  const { id } = res.locals.params;

  const schedule = await scheduleService.getScheduleById(id);
  if (!schedule) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Schedule not found' }
    });
  }

  const scope = req.user?.allowedOrgUnitIds;
  if (scope !== null && scope !== undefined) {
    const deptOrgUnitId = schedule.departmentOrgUnitId ?? null;
    if (deptOrgUnitId === null || !scope.includes(deptOrgUnitId)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access to this schedule is outside your scope' },
      });
    }
  }

  res.json({ success: true, data: schedule });
}));

// Get schedule with shifts
router.get('/:id/shifts', authenticate, requirePermission('schedule.read'), validateParams(idParam), asyncHandler(async (req: Request, res: Response) => {
  const { id } = res.locals.params;

  const schedule = await scheduleService.getScheduleWithShifts(id);
  if (!schedule) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Schedule not found' }
    });
  }

  // Enforce org-unit scope — same rule as GET /:id.
  const scope = req.user?.allowedOrgUnitIds;
  if (scope !== null && scope !== undefined) {
    const deptOrgUnitId = schedule.departmentOrgUnitId ?? null;
    if (deptOrgUnitId === null || !scope.includes(deptOrgUnitId)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access to this schedule is outside your scope' },
      });
    }
  }

  res.json({ success: true, data: schedule });
}));

// Create new schedule
router.post('/', authenticate, requirePermission('schedule.manage'), validateBody(createScheduleBody), asyncHandler(async (req: Request, res: Response) => {
  // Guaranteed by authenticate, as on every protected route.
  const user = req.user!;

  const schedule = await scheduleService.createSchedule({ ...res.locals.body, createdBy: user.id });

  res.status(201).json({
    success: true,
    data: schedule,
    message: 'Schedule created successfully'
  });
}));

// Update schedule
router.put('/:id', authenticate, requirePermission('schedule.manage'), validateParams(idParam), validateBody(updateScheduleBody), asyncHandler(async (_req: Request, res: Response) => {
  const { id } = res.locals.params;

  const schedule = await scheduleService.updateSchedule(id, res.locals.body);
  res.json({
    success: true,
    data: schedule,
    message: 'Schedule updated successfully'
  });
}));

// Delete schedule
router.delete('/:id', authenticate, requirePermission('schedule.manage'), validateParams(idParam), asyncHandler(async (_req: Request, res: Response) => {
  const { id } = res.locals.params;

  await scheduleService.deleteSchedule(id);
  res.json({
    success: true,
    message: 'Schedule deleted successfully'
  });
}));

// Get schedules by department
router.get('/department/:departmentId', authenticate, requirePermission('schedule.read'), validateParams(departmentIdParam), asyncHandler(async (_req: Request, res: Response) => {
  const { departmentId } = res.locals.params;

  const schedules = await scheduleService.getSchedulesByDepartment(departmentId);
  res.json({ success: true, data: schedules });
}));

// Get schedules by user
// Allowed when: the caller holds schedule.manage OR is querying their own schedules.
router.get('/user/:userId', authenticate, validateParams(userIdParam), asyncHandler(async (req: Request, res: Response) => {
  const { userId } = res.locals.params;
  const actor = req.user;

  const canManage = actor?.permissions?.includes('schedule.manage') ?? false;
  if (!canManage && actor?.id !== userId) {
    return res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Access denied' }
    });
  }

  const schedules = await scheduleService.getSchedulesByUser(userId);
  res.json({ success: true, data: schedules });
}));

// Publish schedule
router.patch('/:id/publish', authenticate, requirePermission('schedule.publish'), validateParams(idParam), asyncHandler(async (req: Request, res: Response) => {
  const { id } = res.locals.params;

  const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
  const schedule = await scheduleService.publishSchedule(id, req.user!.id, reason);
  res.json({
    success: true,
    data: schedule,
    message: 'Schedule published successfully'
  });
}));

// Archive schedule
router.patch('/:id/archive', authenticate, requirePermission('schedule.manage'), validateParams(idParam), asyncHandler(async (req: Request, res: Response) => {
  const { id } = res.locals.params;

  const schedule = await scheduleService.archiveSchedule(id, req.user!.id);
  res.json({
    success: true,
    data: schedule,
    message: 'Schedule archived successfully'
  });
}));

// Duplicate schedule
router.post('/:id/duplicate', authenticate, requirePermission('schedule.manage'), validateParams(idParam), validateBody(duplicateScheduleBody), asyncHandler(async (_req: Request, res: Response) => {
  const { id } = res.locals.params;
  const { name, startDate, endDate } = res.locals.body;

  const newSchedule = await scheduleService.duplicateSchedule(id, name, startDate, endDate);

  res.status(201).json({
    success: true,
    data: newSchedule,
    message: 'Schedule duplicated successfully'
  });
}));

// Generate optimized schedule
router.post('/:id/generate', authenticate, requirePermission('schedule.optimize'), validateParams(idParam), asyncHandler(async (req: Request, res: Response) => {
  const { id } = res.locals.params;

  // Guaranteed by authenticate, as on every protected route.
  const user = req.user!;

  const schedule = await scheduleService.getScheduleById(id);
  if (!schedule) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Schedule not found' }
    });
  }

  const result = await scheduleService.generateOptimizedSchedule(id, user.id);

  res.json({
    success: true,
    data: result,
    message: 'Schedule generated successfully'
  });
}));

  return router;
};
