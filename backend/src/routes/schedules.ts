import { Router, Request, Response } from 'express';
import { Pool } from 'mysql2/promise';
import { ScheduleService } from '../services/ScheduleService';
import { authenticate, requireRole } from '../middleware/auth';

export const createSchedulesRouter = (pool: Pool) => {
  const router = Router();
  const scheduleService = new ScheduleService(pool);

// Get all schedules
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const schedules = await scheduleService.getAllSchedules();
    res.json({ success: true, data: schedules });
  } catch (error) {
    console.error('Error fetching schedules:', error);
    res.status(500).json({ 
      success: false, 
      error: { message: 'Failed to fetch schedules' }
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
        error: { message: 'Invalid schedule ID' }
      });
    }

    const schedule = await scheduleService.getScheduleById(id);
    if (!schedule) {
      return res.status(404).json({ 
        success: false, 
        error: { message: 'Schedule not found' }
      });
    }

    res.json({ success: true, data: schedule });
  } catch (error) {
    console.error('Error fetching schedule:', error);
    res.status(500).json({ 
      success: false, 
      error: { message: 'Failed to fetch schedule' }
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
        error: { message: 'Invalid schedule ID' }
      });
    }

    const schedule = await scheduleService.getScheduleWithShifts(id);
    if (!schedule) {
      return res.status(404).json({ 
        success: false, 
        error: { message: 'Schedule not found' }
      });
    }

    res.json({ success: true, data: schedule });
  } catch (error) {
    console.error('Error fetching schedule with shifts:', error);
    res.status(500).json({ 
      success: false, 
      error: { message: 'Failed to fetch schedule with shifts' }
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
        error: { message: 'User not authenticated' }
      });
    }

    const schedule = await scheduleService.createSchedule(req.body);
    
    res.status(201).json({ 
      success: true, 
      data: schedule,
      message: 'Schedule created successfully'
    });
  } catch (error) {
    console.error('Error creating schedule:', error);
    res.status(500).json({ 
      success: false, 
      error: { message: 'Failed to create schedule' }
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
        error: { message: 'Invalid schedule ID' }
      });
    }

    const success = await scheduleService.updateSchedule(id, req.body);
    if (!success) {
      return res.status(404).json({ 
        success: false, 
        error: { message: 'Schedule not found' }
      });
    }

    const schedule = await scheduleService.getScheduleById(id);
    res.json({ 
      success: true, 
      data: schedule,
      message: 'Schedule updated successfully'
    });
  } catch (error) {
    console.error('Error updating schedule:', error);
    res.status(500).json({ 
      success: false, 
      error: { message: 'Failed to update schedule' }
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
        error: { message: 'Invalid schedule ID' }
      });
    }

    const success = await scheduleService.deleteSchedule(id);
    if (!success) {
      return res.status(404).json({ 
        success: false, 
        error: { message: 'Schedule not found' }
      });
    }

    res.json({ 
      success: true, 
      message: 'Schedule deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting schedule:', error);
    res.status(500).json({ 
      success: false, 
      error: { message: 'Failed to delete schedule' }
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
        error: { message: 'Invalid department ID' }
      });
    }

    const schedules = await scheduleService.getSchedulesByDepartment(departmentId);
    res.json({ success: true, data: schedules });
  } catch (error) {
    console.error('Error fetching schedules by department:', error);
    res.status(500).json({ 
      success: false, 
      error: { message: 'Failed to fetch schedules by department' }
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
        error: { message: 'Invalid user ID' }
      });
    }

    const schedules = await scheduleService.getSchedulesByUser(userId);
    res.json({ success: true, data: schedules });
  } catch (error) {
    console.error('Error fetching schedules by user:', error);
    res.status(500).json({ 
      success: false, 
      error: { message: 'Failed to fetch schedules by user' }
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
        error: { message: 'Invalid schedule ID' }
      });
    }

    const success = await scheduleService.publishSchedule(id);
    if (!success) {
      return res.status(404).json({ 
        success: false, 
        error: { message: 'Schedule not found' }
      });
    }

    res.json({ 
      success: true, 
      message: 'Schedule published successfully'
    });
  } catch (error) {
    console.error('Error publishing schedule:', error);
    res.status(500).json({ 
      success: false, 
      error: { message: 'Failed to publish schedule' }
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
        error: { message: 'Invalid schedule ID' }
      });
    }

    const success = await scheduleService.archiveSchedule(id);
    if (!success) {
      return res.status(404).json({ 
        success: false, 
        error: { message: 'Schedule not found' }
      });
    }

    res.json({ 
      success: true, 
      message: 'Schedule archived successfully'
    });
  } catch (error) {
    console.error('Error archiving schedule:', error);
    res.status(500).json({ 
      success: false, 
      error: { message: 'Failed to archive schedule' }
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
        error: { message: 'Invalid schedule ID' }
      });
    }

    const user = req.user;
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        error: { message: 'User not authenticated' }
      });
    }

    const { name, startDate, endDate } = req.body;
    if (!name || !startDate || !endDate) {
      return res.status(400).json({ 
        success: false, 
        error: { message: 'Name, start date, and end date are required' }
      });
    }

    const newSchedule = await scheduleService.duplicateSchedule(id, name, startDate, endDate);
    
    res.status(201).json({ 
      success: true, 
      data: newSchedule,
      message: 'Schedule duplicated successfully'
    });
  } catch (error) {
    console.error('Error duplicating schedule:', error);
    res.status(500).json({ 
      success: false, 
      error: { message: 'Failed to duplicate schedule' }
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
        error: { message: 'Invalid schedule ID' }
      });
    }

    const user = req.user;
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        error: { message: 'User not authenticated' }
      });
    }

    // Get schedule with details
    const schedule = await scheduleService.getScheduleById(id);
    if (!schedule) {
      return res.status(404).json({ 
        success: false, 
        error: { message: 'Schedule not found' }
      });
    }

    // Generate optimized assignments
    const result = await scheduleService.generateOptimizedSchedule(id, user.id);
    
    res.json({ 
      success: true,
      data: result,
      message: 'Schedule generated successfully'
    });
  } catch (error) {
    console.error('Error generating schedule:', error);
    res.status(500).json({ 
      success: false, 
      error: { message: 'Failed to generate schedule' }
    });
  }
});

  return router;
};

export default createSchedulesRouter;
