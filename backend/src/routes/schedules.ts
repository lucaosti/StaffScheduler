import { Router, Request, Response } from 'express';
import { Pool } from 'mysql2/promise';
import { ScheduleService } from '../services/ScheduleService';
import { authenticate, requireRole } from '../middleware/auth';
import { logger } from '../config/logger';

export const createSchedulesRouter = (pool: Pool) => {
  const router = Router();
  const scheduleService = new ScheduleService(pool);

// Get all schedules
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const schedules = await scheduleService.getAllSchedules();
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
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Invalid schedule ID' }
      });
    }

    const schedule = await scheduleService.getScheduleById(id);
    if (!schedule) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Schedule not found' }
      });
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
router.get('/:id/shifts', authenticate, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Invalid schedule ID' }
      });
    }

    const schedule = await scheduleService.getScheduleWithShifts(id);
    if (!schedule) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Schedule not found' }
      });
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
router.post('/', authenticate, requireRole(['admin', 'manager']), async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'User not authenticated' }
      });
    }

    const schedule = await scheduleService.createSchedule({ ...req.body, createdBy: user.id });

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
router.put('/:id', authenticate, requireRole(['admin', 'manager']), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Invalid schedule ID' }
      });
    }

    const schedule = await scheduleService.updateSchedule(id, req.body);
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
router.delete('/:id', authenticate, requireRole(['admin', 'manager']), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Invalid schedule ID' }
      });
    }

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
router.get('/department/:departmentId', authenticate, async (req: Request, res: Response) => {
  try {
    const departmentId = parseInt(req.params.departmentId);
    if (isNaN(departmentId)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Invalid department ID' }
      });
    }

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
router.get('/user/:userId', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Invalid user ID' }
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
router.patch('/:id/publish', authenticate, requireRole(['admin', 'manager']), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Invalid schedule ID' }
      });
    }

    const schedule = await scheduleService.publishSchedule(id);
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
router.patch('/:id/archive', authenticate, requireRole(['admin', 'manager']), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Invalid schedule ID' }
      });
    }

    const schedule = await scheduleService.archiveSchedule(id);
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
router.post('/:id/duplicate', authenticate, requireRole(['admin', 'manager']), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Invalid schedule ID' }
      });
    }

    const user = req.user;
    if (!user) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'User not authenticated' }
      });
    }

    const { name, startDate, endDate } = req.body;
    if (!name || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Name, start date, and end date are required' }
      });
    }

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
router.post('/:id/generate', authenticate, requireRole(['admin', 'manager']), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Invalid schedule ID' }
      });
    }

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

export default createSchedulesRouter;
