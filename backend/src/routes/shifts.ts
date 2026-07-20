import { Router, Request, Response } from 'express';
import { Pool } from 'mysql2/promise';
import { ShiftService } from '../services/ShiftService';
import { authenticate, requirePermission } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { parsePagination, sendPaginated } from '../middleware/pagination';
import { validateParams, validateBody } from '../middleware/validation';
import {
  idParam,
  scheduleIdParam,
  departmentIdParam,
  createShiftBody,
  updateShiftBody,
  createShiftTemplateBody,
  updateShiftTemplateBody,
} from '../schemas';

export const createShiftsRouter = (pool: Pool) => {
  const router = Router();
  const shiftService = new ShiftService(pool);

// Shift Template Routes

// Get all shift templates
router.get('/templates', authenticate, requirePermission('schedule.read'), asyncHandler(async (_req: Request, res: Response) => {
  const templates = await shiftService.getAllShiftTemplates();
  res.json({ success: true, data: templates });
}));

// Get shift template by ID
router.get('/templates/:id', authenticate, requirePermission('schedule.read'), validateParams(idParam), asyncHandler(async (_req: Request, res: Response) => {
  const { id } = res.locals.params;

  const template = await shiftService.getShiftTemplateById(id);
  if (!template) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Shift template not found' }
    });
  }

  res.json({ success: true, data: template });
}));

// Create new shift template
router.post('/templates', authenticate, requirePermission('shift.manage'), validateBody(createShiftTemplateBody), asyncHandler(async (_req: Request, res: Response) => {
  const template = await shiftService.createShiftTemplate(res.locals.body);

  res.status(201).json({
    success: true,
    data: template,
    message: 'Shift template created successfully'
  });
}));

// Update shift template
router.put('/templates/:id', authenticate, requirePermission('shift.manage'), validateParams(idParam), validateBody(updateShiftTemplateBody), asyncHandler(async (_req: Request, res: Response) => {
  const { id } = res.locals.params;

  const template = await shiftService.updateShiftTemplate(id, res.locals.body);
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
}));

// Delete shift template
router.delete('/templates/:id', authenticate, requirePermission('shift.manage'), validateParams(idParam), asyncHandler(async (_req: Request, res: Response) => {
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
}));

// Shift Routes

// Get all shifts
router.get('/', authenticate, requirePermission('schedule.read'), asyncHandler(async (req: Request, res: Response) => {
  const scope = req.user?.allowedOrgUnitIds;
  const filters = {
    ...(scope !== null && scope !== undefined ? { orgUnitIds: scope } : {}),
    ...(req.query.scheduleId ? { scheduleId: Number(req.query.scheduleId) } : {}),
    ...(req.query.departmentId ? { departmentId: Number(req.query.departmentId) } : {}),
    ...(req.query.startDate ? { startDate: req.query.startDate as string } : {}),
    ...(req.query.endDate ? { endDate: req.query.endDate as string } : {}),
    ...(req.query.status ? { status: req.query.status as string } : {}),
  };
  const pagination = parsePagination(req);
  if (pagination) {
    const [total, shifts] = await Promise.all([
      shiftService.countShifts(filters),
      shiftService.getAllShifts(filters, { limit: pagination.pageSize, offset: pagination.offset }),
    ]);
    return sendPaginated(res, shifts, total, pagination);
  }
  const shifts = await shiftService.getAllShifts(filters);
  res.json({ success: true, data: shifts });
}));

// Get shift by ID
router.get('/:id', authenticate, requirePermission('schedule.read'), validateParams(idParam), asyncHandler(async (req: Request, res: Response) => {
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
}));

// Create new shift
router.post('/', authenticate, requirePermission('shift.manage'), validateBody(createShiftBody), asyncHandler(async (_req: Request, res: Response) => {
  const shift = await shiftService.createShift(res.locals.body);

  res.status(201).json({
    success: true,
    data: shift,
    message: 'Shift created successfully'
  });
}));

// Update shift
router.put('/:id', authenticate, requirePermission('shift.manage'), validateParams(idParam), validateBody(updateShiftBody), asyncHandler(async (_req: Request, res: Response) => {
  const { id } = res.locals.params;

  const shift = await shiftService.updateShift(id, res.locals.body);
  res.json({
    success: true,
    data: shift,
    message: 'Shift updated successfully'
  });
}));

// Delete shift
router.delete('/:id', authenticate, requirePermission('shift.manage'), validateParams(idParam), asyncHandler(async (_req: Request, res: Response) => {
  const { id } = res.locals.params;

  await shiftService.deleteShift(id);
  res.json({
    success: true,
    message: 'Shift deleted successfully'
  });
}));

// Get shifts by schedule
router.get('/schedule/:scheduleId', authenticate, validateParams(scheduleIdParam), asyncHandler(async (_req: Request, res: Response) => {
  const { scheduleId } = res.locals.params;

  const shifts = await shiftService.getShiftsBySchedule(scheduleId);
  res.json({ success: true, data: shifts });
}));

// Get shifts by department
router.get('/department/:departmentId', authenticate, validateParams(departmentIdParam), asyncHandler(async (_req: Request, res: Response) => {
  const { departmentId } = res.locals.params;

  const shifts = await shiftService.getShiftsByDepartment(departmentId);
  res.json({ success: true, data: shifts });
}));

  return router;
};
