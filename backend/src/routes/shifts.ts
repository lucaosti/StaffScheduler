import { Router, Request, Response } from 'express';
import { shiftService } from '../services/ShiftService';
import { authenticate } from '../middleware/auth';

const router = Router();

// Get all shifts
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const filters = {
      department: req.query.department as string,
      status: req.query.status as 'draft' | 'published' | 'archived',
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
    };

    const pagination = {
      page: parseInt(req.query.page as string) || 1,
      limit: Math.min(parseInt(req.query.limit as string) || 20, 100),
      sortBy: req.query.sortBy as string || 'startDate',
      sortOrder: (req.query.sortOrder as string) === 'desc' ? 'desc' as const : 'asc' as const
    };

    const result = await shiftService.findAll(filters, pagination);

    res.json({
      success: true,
      data: result.shifts,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total: result.total,
        pages: Math.ceil(result.total / pagination.limit),
        hasNext: pagination.page < Math.ceil(result.total / pagination.limit),
        hasPrev: pagination.page > 1
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

// Get shift by ID
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const shiftId = req.params.id;
    const shift = await shiftService.findById(shiftId);

    if (!shift) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Shift not found'
        }
      });
    }

    res.json({
      success: true,
      data: shift
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

// Create new shift
router.post('/', authenticate, async (req: Request, res: Response) => {
  try {
    const shiftData = req.body;

    // Basic validation
    if (!shiftData.name || !shiftData.startDate || !shiftData.endDate || !shiftData.department) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Name, start date, end date, and department are required'
        }
      });
    }

    const shift = await shiftService.createShift(shiftData, req.user?.id || 'system');

    res.status(201).json({
      success: true,
      data: shift
    });
  } catch (error) {
    const message = (error as Error).message;
    const statusCode = message.includes('conflict') || message.includes('overlap') ? 409 : 500;
    
    res.status(statusCode).json({
      success: false,
      error: {
        code: statusCode === 409 ? 'CONFLICT' : 'INTERNAL_ERROR',
        message
      }
    });
  }
});

// Update shift
router.put('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const shiftId = req.params.id;
    const updateData = req.body;

    const shift = await shiftService.updateShift(shiftId, updateData);

    res.json({
      success: true,
      data: shift
    });
  } catch (error) {
    const message = (error as Error).message;
    let statusCode = 500;
    
    if (message.includes('not found')) statusCode = 404;
    else if (message.includes('conflict') || message.includes('overlap')) statusCode = 409;
    
    res.status(statusCode).json({
      success: false,
      error: {
        code: statusCode === 404 ? 'NOT_FOUND' : statusCode === 409 ? 'CONFLICT' : 'INTERNAL_ERROR',
        message
      }
    });
  }
});

// Delete shift
router.delete('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const shiftId = req.params.id;

    await shiftService.deleteShift(shiftId);

    res.json({
      success: true,
      message: 'Shift deleted successfully'
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

// Publish shift
router.post('/:id/publish', authenticate, async (req: Request, res: Response) => {
  try {
    const shiftId = req.params.id;

    const shift = await shiftService.publishShift(shiftId);

    res.json({
      success: true,
      data: shift,
      message: 'Shift published successfully'
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

export default router;
