import { Router, Request, Response } from 'express';
import { assignmentService } from '../services/AssignmentService';
import { authenticate } from '../middleware/auth';

const router = Router();

// Get all assignments
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const employeeId = req.query.employeeId as string;
    const shiftId = req.query.shiftId as string;
    const status = req.query.status as string;

    let assignments: any[] = [];

    if (employeeId) {
      assignments = await assignmentService.findByEmployee(employeeId, status);
    } else if (shiftId) {
      assignments = await assignmentService.findByShift(shiftId, status);
    } else {
      // Return empty array if no specific filter is provided
      assignments = [];
    }

    res.json({
      success: true,
      data: assignments,
      pagination: {
        page: 1,
        limit: assignments.length,
        total: assignments.length,
        pages: 1,
        hasNext: false,
        hasPrev: false
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: (error as Error).message
      }
    });
  }
});

// Get assignment by ID
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const assignmentId = req.params.id;
    const assignment = await assignmentService.findById(assignmentId);

    if (!assignment) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Assignment not found'
        }
      });
    }

    res.json({
      success: true,
      data: assignment
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: (error as Error).message
      }
    });
  }
});

// Create new assignment
router.post('/', authenticate, async (req: Request, res: Response) => {
  try {
    const { employeeId, shiftId, role } = req.body;

    // Basic validation
    if (!employeeId || !shiftId || !role) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Employee ID, shift ID, and role are required'
        }
      });
    }

    const assignment = await assignmentService.createAssignment(employeeId, shiftId, role, req.user?.id || 'system');

    res.status(201).json({
      success: true,
      data: assignment
    });
  } catch (error) {
    const message = (error as Error).message;
    let statusCode = 500;
    
    if (message.includes('not found')) statusCode = 404;
    else if (message.includes('already assigned') || message.includes('conflict')) statusCode = 409;
    
    res.status(statusCode).json({
      success: false,
      error: {
        code: statusCode === 404 ? 'NOT_FOUND' : statusCode === 409 ? 'CONFLICT' : 'INTERNAL_ERROR',
        message
      }
    });
  }
});

// Update assignment (can only cancel it)
router.put('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const assignmentId = req.params.id;
    const { action } = req.body;

    if (action === 'cancel') {
      await assignmentService.cancelAssignment(assignmentId);
      
      res.json({
        success: true,
        message: 'Assignment cancelled successfully'
      });
    } else {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Only cancel action is supported'
        }
      });
    }
  } catch (error) {
    const message = (error as Error).message;
    const statusCode = message.includes('not found') ? 404 : 500;
    
    res.status(statusCode).json({
      success: false,
      error: {
        code: statusCode === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR',
        message
      }
    });
  }
});

// Delete assignment
router.delete('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const assignmentId = req.params.id;

    await assignmentService.deleteAssignment(assignmentId);

    res.json({
      success: true,
      message: 'Assignment deleted successfully'
    });
  } catch (error) {
    const message = (error as Error).message;
    const statusCode = message.includes('not found') ? 404 : 500;
    
    res.status(statusCode).json({
      success: false,
      error: {
        code: statusCode === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR',
        message
      }
    });
  }
});

// Approve assignment
router.post('/:id/approve', authenticate, async (req: Request, res: Response) => {
  try {
    const assignmentId = req.params.id;
    const approvedBy = req.user?.id || 'system';

    const assignment = await assignmentService.approveAssignment(assignmentId, approvedBy);

    res.json({
      success: true,
      data: assignment,
      message: 'Assignment approved successfully'
    });
  } catch (error) {
    const message = (error as Error).message;
    let statusCode = 500;
    
    if (message.includes('not found')) statusCode = 404;
    else if (message.includes('cannot approve')) statusCode = 409;
    
    res.status(statusCode).json({
      success: false,
      error: {
        code: statusCode === 404 ? 'NOT_FOUND' : statusCode === 409 ? 'CONFLICT' : 'INTERNAL_ERROR',
        message
      }
    });
  }
});

// Reject assignment
router.post('/:id/reject', authenticate, async (req: Request, res: Response) => {
  try {
    const assignmentId = req.params.id;
    const rejectedBy = req.user?.id || 'system';
    const reason = req.body.reason;

    const assignment = await assignmentService.rejectAssignment(assignmentId, rejectedBy, reason);

    res.json({
      success: true,
      data: assignment,
      message: 'Assignment rejected successfully'
    });
  } catch (error) {
    const message = (error as Error).message;
    let statusCode = 500;
    
    if (message.includes('not found')) statusCode = 404;
    else if (message.includes('cannot reject')) statusCode = 409;
    
    res.status(statusCode).json({
      success: false,
      error: {
        code: statusCode === 404 ? 'NOT_FOUND' : statusCode === 409 ? 'CONFLICT' : 'INTERNAL_ERROR',
        message
      }
    });
  }
});

export default router;
