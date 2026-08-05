/**
 * Shift routes — `/api/shifts`, covering both shift templates and the concrete
 * shifts generated from them.
 *
 * ROUTE ORDER IS LOAD-BEARING HERE, NOT COSMETIC. `/templates` and
 * `/templates/:id` are registered BEFORE `/:id`. Express matches in
 * registration order, so with the reverse ordering a request for
 * `GET /api/shifts/templates` would match `/:id` with `id = "templates"`,
 * fail `idParam` validation (`positiveInt`) and return a 400 that names a path
 * parameter the caller never supplied. Any new literal-prefixed route must go
 * above the `/:id` block for the same reason.
 *
 * WHY TEMPLATES AND SHIFTS SHARE A ROUTER. A template is the recurring pattern
 * ("weekday early shift, 2-4 people, needs a first-aider") and a shift is one
 * dated instance of it. They are separate tables, but the permissions, the
 * consumers and the vocabulary are the same, and splitting them would mean two
 * routers whose endpoints are only ever used together. The `shift.manage`
 * permission covers writes to both; reads sit under `schedule.read`, because
 * seeing the shifts is inseparable from seeing the schedule.
 *
 * @author Luca Ostinelli
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'mysql2/promise';
import { ShiftService } from '../services/ShiftService';
import { DemandForecastService } from '../services/DemandForecastService';
import { z } from 'zod';
import { AuditLogService } from '../services/AuditLogService';
import { ExportService } from '../services/ExportService';
import { shiftColumns } from '../services/exportColumns';
import { authenticate, requirePermission } from '../middleware/auth';
import { parsePagination, sendPaginated } from '../middleware/pagination';
import { validateParams, validateBody, validateQuery } from '../middleware/validation';
import {
  idParam,
  scheduleIdParam,
  departmentIdParam,
  createShiftBody,
  updateShiftBody,
  createShiftTemplateBody,
  updateShiftTemplateBody,
  shiftListQuery,
  staffingSuggestionQuery,
} from '../schemas';

export const createShiftsRouter = (pool: Pool) => {
  const router = Router();
  const shiftService = new ShiftService(pool);
const forecastService = new DemandForecastService(pool);
const exporter = new ExportService(new AuditLogService(pool));

/**
 * The listing filters, org-unit scope included.
 *
 * Shared with `/export` so the file and the screen are filtered by one rule.
 * The scope clause is the part that must not be written twice.
 */
const listFilters = (req: Request, query: z.infer<typeof shiftListQuery>) => {
  const scope = req.user?.allowedOrgUnitIds;
  const { date, startDate, endDate, page: _page, pageSize: _pageSize, ...rest } = query;
  // `date` is the documented single-day convenience form. An explicit range wins
  // if both are supplied.
  return {
    ...(scope !== null && scope !== undefined ? { orgUnitIds: scope } : {}),
    ...rest,
    ...(date ? { startDate: date, endDate: date } : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
  };
};

// Shift Template Routes

router.get('/templates', authenticate, requirePermission('schedule.read'), async (_req: Request, res: Response) => {
  const templates = await shiftService.getAllShiftTemplates();
  res.json({ success: true, data: templates });
});

router.get('/templates/:id', authenticate, requirePermission('schedule.read'), validateParams(idParam), async (_req: Request, res: Response) => {
  const { id } = res.locals.params;

  const template = await shiftService.getShiftTemplateById(id);
  if (!template) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Shift template not found' }
    });
  }

  res.json({ success: true, data: template });
});

router.post('/templates', authenticate, requirePermission('shift.manage'), validateBody(createShiftTemplateBody), async (_req: Request, res: Response) => {
  const template = await shiftService.createShiftTemplate(res.locals.body);

  res.status(201).json({
    success: true,
    data: template,
    message: 'Shift template created successfully'
  });
});

router.put('/templates/:id', authenticate, requirePermission('shift.manage'), validateParams(idParam), validateBody(updateShiftTemplateBody), async (_req: Request, res: Response) => {
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
});

router.delete('/templates/:id', authenticate, requirePermission('shift.manage'), validateParams(idParam), async (_req: Request, res: Response) => {
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
});

// Shift Routes

router.get('/', authenticate, requirePermission('schedule.read'), validateQuery(shiftListQuery), async (req: Request, res: Response) => {
  const filters = listFilters(req, res.locals.query);
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
});

// Before `/:id`, so "export" is not read as a shift id.
router.get('/export', authenticate, requirePermission('schedule.read'), validateQuery(shiftListQuery), async (req: Request, res: Response) => {
  const filters = listFilters(req, res.locals.query);
  const shifts = await shiftService.getAllShifts(filters);
  await exporter.sendCsv(res, {
    actorId: req.user?.id ?? null,
    dataset: 'shifts',
    rows: shifts,
    columns: shiftColumns,
    filters,
  });
});

// Before `/:id`, so "staffing-suggestion" is not read as a shift id.
router.get('/staffing-suggestion', authenticate, requirePermission('schedule.read'), validateQuery(staffingSuggestionQuery), async (_req: Request, res: Response) => {
  const suggestion = await forecastService.suggestMinStaff(res.locals.query);
  res.json({ success: true, data: suggestion });
});

router.get('/:id', authenticate, requirePermission('schedule.read'), validateParams(idParam), async (req: Request, res: Response) => {
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
});

router.post('/', authenticate, requirePermission('shift.manage'), validateBody(createShiftBody), async (_req: Request, res: Response) => {
  const shift = await shiftService.createShift(res.locals.body);

  res.status(201).json({
    success: true,
    data: shift,
    message: 'Shift created successfully'
  });
});

router.put('/:id', authenticate, requirePermission('shift.manage'), validateParams(idParam), validateBody(updateShiftBody), async (_req: Request, res: Response) => {
  const { id } = res.locals.params;

  const shift = await shiftService.updateShift(id, res.locals.body);
  res.json({
    success: true,
    data: shift,
    message: 'Shift updated successfully'
  });
});

router.delete('/:id', authenticate, requirePermission('shift.manage'), validateParams(idParam), async (_req: Request, res: Response) => {
  const { id } = res.locals.params;

  await shiftService.deleteShift(id);
  res.json({
    success: true,
    message: 'Shift deleted successfully'
  });
});

router.get('/schedule/:scheduleId', authenticate, validateParams(scheduleIdParam), async (_req: Request, res: Response) => {
  const { scheduleId } = res.locals.params;

  const shifts = await shiftService.getShiftsBySchedule(scheduleId);
  res.json({ success: true, data: shifts });
});

router.get('/department/:departmentId', authenticate, validateParams(departmentIdParam), async (_req: Request, res: Response) => {
  const { departmentId } = res.locals.params;

  const shifts = await shiftService.getShiftsByDepartment(departmentId);
  res.json({ success: true, data: shifts });
});

  return router;
};
