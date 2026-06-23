import { Router, Request, Response } from 'express';
import { Pool } from 'mysql2/promise';
import { ScheduleService } from '../services/ScheduleService';
import { authenticate, requirePermission } from '../middleware/auth';
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
import { logger } from '../config/logger';

export const createSchedulesRouter = (pool: Pool) => {
  const router = Router();
  const scheduleService = new ScheduleService(pool);

// Get all schedules
router.get('/', authenticate, requirePermission('schedule.read'), async (req: Request, res: Response) => {
  try {
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
  } catch (error) {
    logger.error('Error fetching schedules:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch schedules' }
    });
  }
});

// Get schedule by ID
router.get('/:id', authenticate, requirePermission('schedule.read'), validateParams(idParam), async (req: Request, res: Response) => {
  try {
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
  } catch (error) {
    logger.error('Error fetching schedule:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch schedule' }
    });
  }
});

// Get schedule with shifts
router.get('/:id/shifts', authenticate, requirePermission('schedule.read'), validateParams(idParam), async (req: Request, res: Response) => {
  try {
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
  } catch (error) {
    logger.error('Error fetching schedule with shifts:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch schedule with shifts' }
    });
  }
});

// Create new schedule
router.post('/', authenticate, requirePermission('schedule.manage'), validateBody(createScheduleBody), async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'User not authenticated' }
      });
    }

    const schedule = await scheduleService.createSchedule({ ...res.locals.body, createdBy: user.id });

    res.status(201).json({
      success: true,
      data: schedule,
      message: 'Schedule created successfully'
    });
  } catch (error) {
    logger.error('Error creating schedule:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to create schedule' }
    });
  }
});

// Update schedule
router.put('/:id', authenticate, requirePermission('schedule.manage'), validateParams(idParam), validateBody(updateScheduleBody), async (_req: Request, res: Response) => {
  try {
    const { id } = res.locals.params;

    const schedule = await scheduleService.updateSchedule(id, res.locals.body);
    res.json({
      success: true,
      data: schedule,
      message: 'Schedule updated successfully'
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update schedule';
    if (message.toLowerCase().includes('not found')) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message } });
    }
    logger.error('Error updating schedule:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to update schedule' }
    });
  }
});

// Delete schedule
router.delete('/:id', authenticate, requirePermission('schedule.manage'), validateParams(idParam), async (_req: Request, res: Response) => {
  try {
    const { id } = res.locals.params;

    await scheduleService.deleteSchedule(id);
    res.json({
      success: true,
      message: 'Schedule deleted successfully'
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete schedule';
    if (message.toLowerCase().includes('not found')) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message } });
    }
    if (message.toLowerCase().includes('only draft')) {
      return res.status(409).json({ success: false, error: { code: 'CONFLICT', message } });
    }
    logger.error('Error deleting schedule:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to delete schedule' }
    });
  }
});

// Get schedules by department
router.get('/department/:departmentId', authenticate, requirePermission('schedule.read'), validateParams(departmentIdParam), async (_req: Request, res: Response) => {
  try {
    const { departmentId } = res.locals.params;

    const schedules = await scheduleService.getSchedulesByDepartment(departmentId);
    res.json({ success: true, data: schedules });
  } catch (error) {
    logger.error('Error fetching schedules by department:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch schedules by department' }
    });
  }
});

// Get schedules by user
// Allowed when: the caller holds schedule.manage OR is querying their own schedules.
router.get('/user/:userId', authenticate, validateParams(userIdParam), async (req: Request, res: Response) => {
  try {
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
  } catch (error) {
    logger.error('Error fetching schedules by user:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch schedules by user' }
    });
  }
});

// Publish schedule
router.patch('/:id/publish', authenticate, requirePermission('schedule.publish'), validateParams(idParam), async (req: Request, res: Response) => {
  try {
    const { id } = res.locals.params;

    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    const schedule = await scheduleService.publishSchedule(id, req.user!.id, reason);
    res.json({
      success: true,
      data: schedule,
      message: 'Schedule published successfully'
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to publish schedule';
    if (message.toLowerCase().includes('not found')) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message } });
    }
    logger.error('Error publishing schedule:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to publish schedule' }
    });
  }
});

// Archive schedule
router.patch('/:id/archive', authenticate, requirePermission('schedule.manage'), validateParams(idParam), async (req: Request, res: Response) => {
  try {
    const { id } = res.locals.params;

    const schedule = await scheduleService.archiveSchedule(id, req.user!.id);
    res.json({
      success: true,
      data: schedule,
      message: 'Schedule archived successfully'
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to archive schedule';
    if (message.toLowerCase().includes('not found')) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message } });
    }
    logger.error('Error archiving schedule:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to archive schedule' }
    });
  }
});

// Duplicate schedule
router.post('/:id/duplicate', authenticate, requirePermission('schedule.manage'), validateParams(idParam), validateBody(duplicateScheduleBody), async (req: Request, res: Response) => {
  try {
    const { id } = res.locals.params;

    const user = req.user;
    if (!user) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'User not authenticated' }
      });
    }

    const { name, startDate, endDate } = res.locals.body;

    const newSchedule = await scheduleService.duplicateSchedule(id, name, startDate, endDate);

    res.status(201).json({
      success: true,
      data: newSchedule,
      message: 'Schedule duplicated successfully'
    });
  } catch (error) {
    logger.error('Error duplicating schedule:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to duplicate schedule' }
    });
  }
});

// Generate optimized schedule
router.post('/:id/generate', authenticate, requirePermission('schedule.optimize'), validateParams(idParam), async (req: Request, res: Response) => {
  try {
    const { id } = res.locals.params;

    const user = req.user;
    if (!user) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'User not authenticated' }
      });
    }

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
  } catch (error) {
    logger.error('Error generating schedule:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to generate schedule' }
    });
  }
});

  return router;
};
