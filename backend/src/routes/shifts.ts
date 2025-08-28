/**
 * Shift Routes
 * 
 * Handles all shift management operations including CRUD operations,
 * publishing workflow, and shift assignment management.
 * 
 * Features:
 * - Complete shift lifecycle management
 * - Advanced filtering and date range queries
 * - Shift status management and publishing
 * - Assignment tracking and management
 * - Validation and error handling
 * 
 * Security:
 * - Authentication required for all endpoints
 * - Input validation and sanitization
 * - Error message standardization
 * - Audit trail for modifications
 * 
 * @author Luca Ostinelli
 */

import { Router, Request, Response } from 'express';
import { shiftService } from '../services/ShiftService';
import { authenticate } from '../middleware/auth';

const router = Router();

/**
 * Get All Shifts Endpoint
 * 
 * Retrieves shifts with filtering, pagination, and sorting support.
 * Supports department, status, and date range filtering.
 * 
 * @route GET /api/shifts
 * @param {string} [department] - Filter by department
 * @param {string} [status] - Filter by status (draft/published/archived)
 * @param {string} [startDate] - Filter by start date (YYYY-MM-DD)
 * @param {string} [endDate] - Filter by end date (YYYY-MM-DD)
 * @param {number} [page=1] - Page number for pagination
 * @param {number} [limit=20] - Items per page (max 100)
 * @param {string} [sortBy=startDate] - Field to sort by
 * @param {string} [sortOrder=asc] - Sort order (asc/desc)
 * @returns {Object} Paginated shift list with metadata
 * 
 * @example
 * GET /api/shifts?department=Nursing&status=published&startDate=2024-01-01
 * Returns: { success: true, data: [...], pagination: {...} }
 */
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

/**
 * Get Shift by ID Endpoint
 * 
 * Retrieves detailed information for a specific shift.
 * Returns complete shift details including creator information.
 * 
 * @route GET /api/shifts/:id
 * @param {string} id - Shift ID (path parameter)
 * @returns {Object} Shift object with complete details
 * 
 * @example
 * GET /api/shifts/shift-123
 * Returns: { success: true, data: { id: "shift-123", ... } }
 */
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

/**
 * Create New Shift Endpoint
 * 
 * Creates a new shift with comprehensive validation.
 * Validates required fields and ensures business rule compliance.
 * 
 * @route POST /api/shifts
 * @param {Object} body - Shift data object
 * @param {string} body.name - Shift name
 * @param {string} body.startTime - Start time (HH:MM format)
 * @param {string} body.endTime - End time (HH:MM format)
 * @param {string} body.date - Shift date (YYYY-MM-DD format)
 * @param {string} body.department - Department name
 * @param {number} body.minimumStaff - Minimum staff required
 * @param {number} body.maximumStaff - Maximum staff allowed
 * @returns {Object} Created shift object
 */
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

/**
 * Update Shift Endpoint
 * 
 * Updates existing shift information with partial data support.
 * Validates shift existence and prevents conflicts.
 * 
 * @route PUT /api/shifts/:id
 * @param {string} id - Shift ID (path parameter)
 * @param {Object} body - Partial shift data to update
 * @returns {Object} Updated shift object
 */
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

/**
 * Delete Shift Endpoint
 * 
 * Permanently removes a shift from the system.
 * Validates that no assignments exist before deletion.
 * 
 * @route DELETE /api/shifts/:id
 * @param {string} id - Shift ID (path parameter)
 * @returns {Object} Success confirmation message
 */
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

/**
 * Publish Shift Endpoint
 * 
 * Changes shift status to published, making it available for assignment.
 * Published shifts become visible to employees and managers.
 * 
 * @route POST /api/shifts/:id/publish
 * @param {string} id - Shift ID (path parameter)
 * @returns {Object} Published shift object
 */
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

/**
 * Shift Router Module Export
 * 
 * Exports the configured Express router for shift management endpoints.
 * All routes require authentication and return standardized JSON responses.
 */
export default router;
