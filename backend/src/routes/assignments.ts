import { Router, Request, Response } from 'express';
import { Pool } from 'mysql2/promise';
import { AssignmentService } from '../services/AssignmentService';
import { authenticate, requirePermission, userHasPermission } from '../middleware/auth';
import { validateParams, validateBody } from '../middleware/validation';
import {
  idParam,
  userIdParam,
  shiftIdParam,
  departmentIdParam,
  createAssignmentBody,
  bulkCreateAssignmentsBody,
} from '../schemas';
import { User } from '../types';
import { logger } from '../config/logger';

export const createAssignmentsRouter = (pool: Pool) => {
  const router = Router();
  const assignmentService = new AssignmentService(pool);

// Get all assignments
router.get('/', authenticate, requirePermission('assignment.manage'), async (_req: Request, res: Response) => {
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
// Allowed when: the caller holds assignment.manage OR the assignment belongs to the caller.
router.get('/:id', authenticate, validateParams(idParam), async (req: Request, res: Response) => {
  try {
    const { id } = res.locals.params;
    const actor = req.user as User;

    const assignment = await assignmentService.getAssignmentById(id);
    if (!assignment) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Assignment not found' }
      });
    }

    const canManage = userHasPermission(actor, 'assignment.manage');
    const isOwn = (assignment as any).userId === actor.id;
    if (!canManage && !isOwn) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access denied' }
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
router.post('/', authenticate, requirePermission('assignment.manage'), validateBody(createAssignmentBody), async (_req: Request, res: Response) => {
  try {
    const assignment = await assignmentService.createAssignment(res.locals.body);

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
router.put('/:id', authenticate, requirePermission('assignment.manage'), validateParams(idParam), async (req: Request, res: Response) => {
  try {
    const { id } = res.locals.params;

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
router.delete('/:id', authenticate, requirePermission('assignment.manage'), validateParams(idParam), async (_req: Request, res: Response) => {
  try {
    const { id } = res.locals.params;

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
// Allowed when: the caller holds assignment.manage OR is requesting their own assignments.
router.get('/user/:userId', authenticate, validateParams(userIdParam), async (req: Request, res: Response) => {
  try {
    const { userId } = res.locals.params;
    const actor = req.user as User;

    const canManage = userHasPermission(actor, 'assignment.manage');
    if (!canManage && actor.id !== userId) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access denied' }
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
router.get('/shift/:shiftId', authenticate, requirePermission('assignment.manage'), validateParams(shiftIdParam), async (_req: Request, res: Response) => {
  try {
    const { shiftId } = res.locals.params;

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
router.get('/department/:departmentId', authenticate, requirePermission('assignment.manage'), validateParams(departmentIdParam), async (req: Request, res: Response) => {
  try {
    const { departmentId } = res.locals.params;
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
router.post('/bulk', authenticate, requirePermission('assignment.manage'), validateBody(bulkCreateAssignmentsBody), async (_req: Request, res: Response) => {
  try {
    const { assignments } = res.locals.body;

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
// Only the assigned user or a manager (assignment.manage) may confirm.
router.patch('/:id/confirm', authenticate, validateParams(idParam), async (req: Request, res: Response) => {
  try {
    const { id } = res.locals.params;
    const actor = req.user as User;

    const existing = await assignmentService.getAssignmentById(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Assignment not found' } });
    }

    const canManage = userHasPermission(actor, 'assignment.manage');
    const isOwn = (existing as any).userId === actor.id;
    if (!canManage && !isOwn) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied' } });
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
// Only the assigned user or a manager (assignment.manage) may decline.
router.patch('/:id/decline', authenticate, validateParams(idParam), async (req: Request, res: Response) => {
  try {
    const { id } = res.locals.params;
    const actor = req.user as User;

    const existing = await assignmentService.getAssignmentById(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Assignment not found' } });
    }

    const canManage = userHasPermission(actor, 'assignment.manage');
    const isOwn = (existing as any).userId === actor.id;
    if (!canManage && !isOwn) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied' } });
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
// Only a manager (assignment.manage) may mark an assignment complete.
router.patch('/:id/complete', authenticate, requirePermission('assignment.manage'), validateParams(idParam), async (_req: Request, res: Response) => {
  try {
    const { id } = res.locals.params;

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
router.get('/shift/:shiftId/available-employees', authenticate, requirePermission('assignment.manage'), validateParams(shiftIdParam), async (_req: Request, res: Response) => {
  try {
    const { shiftId } = res.locals.params;

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
