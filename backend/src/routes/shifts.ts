/**
 * Shift Management Routes
 *
 * Handles all shift-related operations including:
 * - Shift template CRUD operations
 * - Individual shift management
 * - Schedule-based shift retrieval
 * - Department-specific shift filtering
 *
 * Authentication: Required on all endpoints
 * Authorization: Manager/Admin roles required for creation/modification
 *
 * @author Luca Ostinelli
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'mysql2/promise';
import { ShiftService } from '../services/ShiftService';
import { authenticate, requirePermission } from '../middleware/auth';
import { parsePagination, sendPaginated } from '../middleware/pagination';
import { validateParams, validateBody } from '../middleware/validation';
import {
  idParam,
  scheduleIdParam,
  departmentIdParam,
  createShiftBody,
} from '../schemas';
import { logger } from '../config/logger';

export const createShiftsRouter = (pool: Pool) => {
  const router = Router();
  const shiftService = new ShiftService(pool);

// Shift Template Routes

// Get all shift templates
router.get('/templates', authenticate, async (_req: Request, res: Response) => {
  try {
    const templates = await shiftService.getAllShiftTemplates();
    res.json({ success: true, data: templates });
  } catch (error) {
    logger.error('Error fetching shift templates:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch shift templates' }
    });
  }
});

// Get shift template by ID
router.get('/templates/:id', authenticate, validateParams(idParam), async (_req: Request, res: Response) => {
  try {
    const { id } = res.locals.params;

    const template = await shiftService.getShiftTemplateById(id);
    if (!template) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Shift template not found' }
      });
    }

    res.json({ success: true, data: template });
  } catch (error) {
    logger.error('Error fetching shift template:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch shift template' }
    });
  }
});

// Create new shift template
router.post('/templates', authenticate, requirePermission('shift.manage'), async (req: Request, res: Response) => {
  try {
    const templateId = await shiftService.createShiftTemplate(req.body);
    const template = await shiftService.getShiftTemplateById(templateId);

    res.status(201).json({
      success: true,
      data: template,
      message: 'Shift template created successfully'
    });
  } catch (error) {
    logger.error('Error creating shift template:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to create shift template' }
    });
  }
});

// Update shift template
router.put('/templates/:id', authenticate, requirePermission('shift.manage'), validateParams(idParam), async (req: Request, res: Response) => {
  try {
    const { id } = res.locals.params;

    const template = await shiftService.updateShiftTemplate(id, req.body);
    if (!template) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Shift template not found' }
      });
    }

    res.json({
      success: true,
      data: template,
      message: 'Shift template updated successfully'
    });
  } catch (error) {
    logger.error('Error updating shift template:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to update shift template' }
    });
  }
});

// Delete shift template
router.delete('/templates/:id', authenticate, requirePermission('shift.manage'), validateParams(idParam), async (_req: Request, res: Response) => {
  try {
    const { id } = res.locals.params;

    const success = await shiftService.deleteShiftTemplate(id);
    if (!success) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Shift template not found' }
      });
    }

    res.json({
      success: true,
      message: 'Shift template deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting shift template:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to delete shift template' }
    });
  }
});

// Shift Routes

// Get all shifts
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const scope = req.user?.allowedOrgUnitIds;
    const shifts = await shiftService.getAllShifts(
      scope !== null && scope !== undefined ? { orgUnitIds: scope } : undefined
    );
    const pagination = parsePagination(req);
    if (pagination) {
      const sliced = shifts.slice(pagination.offset, pagination.offset + pagination.pageSize);
      return sendPaginated(res, sliced, shifts.length, pagination);
    }
    res.json({ success: true, data: shifts });
  } catch (error) {
    logger.error('Error fetching shifts:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch shifts' }
    });
  }
});

// Get shift by ID
router.get('/:id', authenticate, validateParams(idParam), async (req: Request, res: Response) => {
  try {
    const { id } = res.locals.params;

    const shift = await shiftService.getShiftById(id);
    if (!shift) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Shift not found' }
      });
    }

    // Enforce org-unit scope when the caller has a restricted scope.
    const scope = req.user?.allowedOrgUnitIds;
    if (scope !== null && scope !== undefined) {
      const shiftOrgUnitId = (shift as any).orgUnitId ?? (shift as any).departmentOrgUnitId ?? null;
      if (shiftOrgUnitId === null || !scope.includes(shiftOrgUnitId)) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Access to this shift is outside your scope' },
        });
      }
    }

    res.json({ success: true, data: shift });
  } catch (error) {
    logger.error('Error fetching shift:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch shift' }
    });
  }
});

// Create new shift
router.post('/', authenticate, requirePermission('shift.manage'), validateBody(createShiftBody), async (_req: Request, res: Response) => {
  try {
    const shift = await shiftService.createShift(res.locals.body);

    res.status(201).json({
      success: true,
      data: shift,
      message: 'Shift created successfully'
    });
  } catch (error) {
    logger.error('Error creating shift:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to create shift' }
    });
  }
});

// Update shift
router.put('/:id', authenticate, requirePermission('shift.manage'), validateParams(idParam), async (req: Request, res: Response) => {
  try {
    const { id } = res.locals.params;

    const shift = await shiftService.updateShift(id, req.body);
    res.json({
      success: true,
      data: shift,
      message: 'Shift updated successfully'
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update shift';
    if (message.toLowerCase().includes('not found')) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message } });
    }
    logger.error('Error updating shift:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to update shift' }
    });
  }
});

// Delete shift
router.delete('/:id', authenticate, requirePermission('shift.manage'), validateParams(idParam), async (_req: Request, res: Response) => {
  try {
    const { id } = res.locals.params;

    await shiftService.deleteShift(id);
    res.json({
      success: true,
      message: 'Shift deleted successfully'
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete shift';
    if (message.toLowerCase().includes('not found')) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message } });
    }
    logger.error('Error deleting shift:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to delete shift' }
    });
  }
});

// Get shifts by schedule
router.get('/schedule/:scheduleId', authenticate, validateParams(scheduleIdParam), async (_req: Request, res: Response) => {
  try {
    const { scheduleId } = res.locals.params;

    const shifts = await shiftService.getShiftsBySchedule(scheduleId);
    res.json({ success: true, data: shifts });
  } catch (error) {
    logger.error('Error fetching shifts by schedule:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch shifts by schedule' }
    });
  }
});

// Get shifts by department
router.get('/department/:departmentId', authenticate, validateParams(departmentIdParam), async (_req: Request, res: Response) => {
  try {
    const { departmentId } = res.locals.params;

    const shifts = await shiftService.getShiftsByDepartment(departmentId);
    res.json({ success: true, data: shifts });
  } catch (error) {
    logger.error('Error fetching shifts by department:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch shifts by department' }
    });
  }
});

  return router;
};
