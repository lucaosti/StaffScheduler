import { Router, Request, Response } from 'express';
import { Pool } from 'mysql2/promise';
import { AssignmentService } from '../services/AssignmentService';
import { authenticate, requireRole } from '../middleware/auth';
import { logger } from '../config/logger';

export const createAssignmentsRouter = (pool: Pool) => {
  const router = Router();
  const assignmentService = new AssignmentService(pool);

// Get all assignments
router.get('/', authenticate, async (_req: Request, res: Response) => {
  try {
    const assignments = await assignmentService.getAllAssignments();
    res.json({ success: true, data: assignments });
  } catch (error) {
    logger.error('Error fetching assignments:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch assignments' }
    });
  }
});

// Get assignment by ID
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Invalid assignment ID' }
      });
    }

    const assignment = await assignmentService.getAssignmentById(id);
    if (!assignment) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Assignment not found' }
      });
    }

    res.json({ success: true, data: assignment });
  } catch (error) {
    logger.error('Error fetching assignment:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch assignment' }
    });
  }
});

// Create new assignment
router.post('/', authenticate, requireRole(['admin', 'manager']), async (req: Request, res: Response) => {
  try {
    const assignment = await assignmentService.createAssignment(req.body);

    res.status(201).json({
      success: true,
      data: assignment,
      message: 'Assignment created successfully'
    });
  } catch (error) {
    logger.error('Error creating assignment:', error);
    const message = error instanceof Error ? error.message : 'Failed to create assignment';
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message }
    });
  }
});

// Update assignment
router.put('/:id', authenticate, requireRole(['admin', 'manager']), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Invalid assignment ID' }
      });
    }

    const assignment = await assignmentService.updateAssignment(id, req.body);
    res.json({
      success: true,
      data: assignment,
      message: 'Assignment updated successfully'
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update assignment';
    if (message.toLowerCase().includes('not found')) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message } });
    }
    logger.error('Error updating assignment:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to update assignment' }
    });
  }
});

// Delete assignment
router.delete('/:id', authenticate, requireRole(['admin', 'manager']), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Invalid assignment ID' }
      });
    }

    await assignmentService.deleteAssignment(id);
    res.json({
      success: true,
      message: 'Assignment deleted successfully'
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete assignment';
    if (message.toLowerCase().includes('not found')) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message } });
    }
    logger.error('Error deleting assignment:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to delete assignment' }
    });
  }
});

// Get assignments by user
router.get('/user/:userId', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Invalid user ID' }
      });
    }

    const assignments = await assignmentService.getAssignmentsByUser(userId);
    res.json({ success: true, data: assignments });
  } catch (error) {
    logger.error('Error fetching assignments by user:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch assignments by user' }
    });
  }
});

// Get assignments by shift
router.get('/shift/:shiftId', authenticate, async (req: Request, res: Response) => {
  try {
    const shiftId = parseInt(req.params.shiftId);
    if (isNaN(shiftId)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Invalid shift ID' }
      });
    }

    const assignments = await assignmentService.getAssignmentsByShift(shiftId);
    res.json({ success: true, data: assignments });
  } catch (error) {
    logger.error('Error fetching assignments by shift:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch assignments by shift' }
    });
  }
});

// Get assignments by department
router.get('/department/:departmentId', authenticate, async (req: Request, res: Response) => {
  try {
    const departmentId = parseInt(req.params.departmentId);
    if (isNaN(departmentId)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Invalid department ID' }
      });
    }

    const { status } = req.query;
    const assignments = await assignmentService.getAssignmentsByDepartment(
      departmentId,
      status as string
    );
    res.json({ success: true, data: assignments });
  } catch (error) {
    logger.error('Error fetching assignments by department:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch assignments by department' }
    });
  }
});

// Bulk create assignments
router.post('/bulk', authenticate, requireRole(['admin', 'manager']), async (req: Request, res: Response) => {
  try {
    const { assignments } = req.body;
    if (!Array.isArray(assignments)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Assignments must be an array' }
      });
    }

    const createdAssignments = await assignmentService.bulkCreateAssignments(assignments);

    res.status(201).json({
      success: true,
      data: { assignments: createdAssignments, count: createdAssignments.length },
      message: `${createdAssignments.length} assignments created successfully`
    });
  } catch (error) {
    logger.error('Error bulk creating assignments:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to bulk create assignments' }
    });
  }
});

// Confirm assignment
router.patch('/:id/confirm', authenticate, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Invalid assignment ID' }
      });
    }

    const assignment = await assignmentService.confirmAssignment(id);
    res.json({
      success: true,
      data: assignment,
      message: 'Assignment confirmed successfully'
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to confirm assignment';
    if (message.toLowerCase().includes('not found')) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message } });
    }
    if (message.toLowerCase().includes('already confirmed')) {
      return res.status(409).json({ success: false, error: { code: 'CONFLICT', message } });
    }
    logger.error('Error confirming assignment:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to confirm assignment' }
    });
  }
});

// Decline assignment
router.patch('/:id/decline', authenticate, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Invalid assignment ID' }
      });
    }

    const assignment = await assignmentService.declineAssignment(id);

    res.json({
      success: true,
      data: assignment,
      message: 'Assignment declined successfully'
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to decline assignment';
    if (message.toLowerCase().includes('not found')) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message } });
    }
    logger.error('Error declining assignment:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to decline assignment' }
    });
  }
});

// Complete assignment
router.patch('/:id/complete', authenticate, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Invalid assignment ID' }
      });
    }

    const assignment = await assignmentService.completeAssignment(id);
    res.json({
      success: true,
      data: assignment,
      message: 'Assignment completed successfully'
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to complete assignment';
    if (message.toLowerCase().includes('not found')) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message } });
    }
    logger.error('Error completing assignment:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to complete assignment' }
    });
  }
});

// Get available employees for shift
router.get('/shift/:shiftId/available-employees', authenticate, async (req: Request, res: Response) => {
  try {
    const shiftId = parseInt(req.params.shiftId);
    if (isNaN(shiftId)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Invalid shift ID' }
      });
    }

    const employees = await assignmentService.getAvailableEmployeesForShift(shiftId);
    res.json({ success: true, data: employees });
  } catch (error) {
    logger.error('Error fetching available employees:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch available employees' }
    });
  }
});

  return router;
};

