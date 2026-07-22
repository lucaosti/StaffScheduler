import { Router, Request, Response } from 'express';
import { Pool } from 'mysql2/promise';
import { AssignmentService } from '../services/AssignmentService';
import { authenticate, requirePermission, userHasPermission } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateParams, validateBody, validateQuery } from '../middleware/validation';
import {
  idParam,
  userIdParam,
  shiftIdParam,
  departmentIdParam,
  assignmentListQuery,
  createAssignmentBody,
  bulkCreateAssignmentsBody,
  updateAssignmentBody,
} from '../schemas';
import { User } from '../types';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { parsePagination, sendPaginated } from '../middleware/pagination';

export const createAssignmentsRouter = (pool: Pool) => {
  const router = Router();
  const assignmentService = new AssignmentService(pool);

// Get all assignments.
//
// The filters below were documented in the OpenAPI spec long before the
// handler read them: it called getAllAssignments() with no arguments, so a
// request for one user's assignments returned everyone's. They are now parsed
// from a schema, and the listing is bounded — see AssignmentService for why an
// oversized unpaginated request is refused rather than truncated.
router.get('/', authenticate, requirePermission('assignment.manage'), validateQuery(assignmentListQuery), asyncHandler(async (req: Request, res: Response) => {
  // page/pageSize belong to the pagination envelope, not to the SQL filters.
  const { page: _page, pageSize: _pageSize, ...filters } = res.locals.query;
  const pagination = parsePagination(req);

  if (pagination) {
    const [total, assignments] = await Promise.all([
      assignmentService.countAssignments(filters),
      assignmentService.getAllAssignments(filters, { limit: pagination.pageSize, offset: pagination.offset }),
    ]);
    return sendPaginated(res, assignments, total, pagination);
  }

  const assignments = await assignmentService.getAllAssignments(filters);
  res.json({ success: true, data: assignments });
}));

// Get assignment by ID
// Allowed when: the caller holds assignment.manage OR the assignment belongs to the caller.
router.get('/:id', authenticate, validateParams(idParam), asyncHandler(async (req: Request, res: Response) => {
  const { id } = res.locals.params;
  const actor = req.user as User;

  const assignment = await assignmentService.getAssignmentById(id);
  if (!assignment) throw new NotFoundError('Assignment not found');

  const canManage = userHasPermission(actor, 'assignment.manage');
  const isOwn = (assignment as any).userId === actor.id;
  if (!canManage && !isOwn) throw new ForbiddenError();

  res.json({ success: true, data: assignment });
}));

// Create new assignment
router.post('/', authenticate, requirePermission('assignment.manage'), validateBody(createAssignmentBody), asyncHandler(async (req: Request, res: Response) => {
  const assignment = await assignmentService.createAssignment({
    ...res.locals.body,
    actorId: req.user?.id,
  });

  res.status(201).json({
    success: true,
    data: assignment,
    message: 'Assignment created successfully'
  });
}));

// Update assignment
router.put('/:id', authenticate, requirePermission('assignment.manage'), validateParams(idParam), validateBody(updateAssignmentBody), asyncHandler(async (req: Request, res: Response) => {
  const { id } = res.locals.params;

  const assignment = await assignmentService.updateAssignment(id, {
    ...res.locals.body,
    actorId: req.user?.id,
  });
  res.json({
    success: true,
    data: assignment,
    message: 'Assignment updated successfully'
  });
}));

// Delete assignment
router.delete('/:id', authenticate, requirePermission('assignment.manage'), validateParams(idParam), asyncHandler(async (req: Request, res: Response) => {
  const { id } = res.locals.params;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;

  await assignmentService.deleteAssignment(id, req.user?.id, reason);
  res.json({
    success: true,
    message: 'Assignment deleted successfully'
  });
}));

// Get assignments by user
// Allowed when: the caller holds assignment.manage OR is requesting their own assignments.
router.get('/user/:userId', authenticate, validateParams(userIdParam), asyncHandler(async (req: Request, res: Response) => {
  const { userId } = res.locals.params;
  const actor = req.user as User;

  const canManage = userHasPermission(actor, 'assignment.manage');
  if (!canManage && actor.id !== userId) throw new ForbiddenError();

  const assignments = await assignmentService.getAssignmentsByUser(userId);
  res.json({ success: true, data: assignments });
}));

// Get assignments by shift
router.get('/shift/:shiftId', authenticate, requirePermission('assignment.manage'), validateParams(shiftIdParam), asyncHandler(async (_req: Request, res: Response) => {
  const { shiftId } = res.locals.params;

  const assignments = await assignmentService.getAssignmentsByShift(shiftId);
  res.json({ success: true, data: assignments });
}));

// Get assignments by department
router.get('/department/:departmentId', authenticate, requirePermission('assignment.manage'), validateParams(departmentIdParam), asyncHandler(async (req: Request, res: Response) => {
  const { departmentId } = res.locals.params;
  const rawStatus = req.query.status as string | undefined;
  const VALID_STATUSES = ['pending', 'confirmed', 'cancelled', 'completed'];
  if (rawStatus !== undefined && !VALID_STATUSES.includes(rawStatus)) {
    throw new ValidationError(`status must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  const assignments = await assignmentService.getAssignmentsByDepartment(
    departmentId,
    rawStatus
  );
  res.json({ success: true, data: assignments });
}));

// Bulk create assignments
router.post('/bulk', authenticate, requirePermission('assignment.manage'), validateBody(bulkCreateAssignmentsBody), asyncHandler(async (_req: Request, res: Response) => {
  const { assignments } = res.locals.body;

  const createdAssignments = await assignmentService.bulkCreateAssignments(assignments);

  res.status(201).json({
    success: true,
    data: { assignments: createdAssignments, count: createdAssignments.length },
    message: `${createdAssignments.length} assignments created successfully`
  });
}));

// Confirm assignment
// Only the assigned user or a manager (assignment.manage) may confirm.
router.patch('/:id/confirm', authenticate, validateParams(idParam), asyncHandler(async (req: Request, res: Response) => {
  const { id } = res.locals.params;
  const actor = req.user as User;

  const existing = await assignmentService.getAssignmentById(id);
  if (!existing) throw new NotFoundError('Assignment not found');

  const canManage = userHasPermission(actor, 'assignment.manage');
  const isOwn = (existing as any).userId === actor.id;
  if (!canManage && !isOwn) throw new ForbiddenError();

  const assignment = await assignmentService.confirmAssignment(id, actor.id);
  res.json({
    success: true,
    data: assignment,
    message: 'Assignment confirmed successfully'
  });
}));

// Decline assignment
// Only the assigned user or a manager (assignment.manage) may decline.
router.patch('/:id/decline', authenticate, validateParams(idParam), asyncHandler(async (req: Request, res: Response) => {
  const { id } = res.locals.params;
  const actor = req.user as User;

  const existing = await assignmentService.getAssignmentById(id);
  if (!existing) throw new NotFoundError('Assignment not found');

  const canManage = userHasPermission(actor, 'assignment.manage');
  const isOwn = (existing as any).userId === actor.id;
  if (!canManage && !isOwn) throw new ForbiddenError();

  const assignment = await assignmentService.declineAssignment(id, actor.id);

  res.json({
    success: true,
    data: assignment,
    message: 'Assignment declined successfully'
  });
}));

// Complete assignment
// Only a manager (assignment.manage) may mark an assignment complete.
router.patch('/:id/complete', authenticate, requirePermission('assignment.manage'), validateParams(idParam), asyncHandler(async (req: Request, res: Response) => {
  const { id } = res.locals.params;

  const assignment = await assignmentService.completeAssignment(id, req.user?.id);
  res.json({
    success: true,
    data: assignment,
    message: 'Assignment completed successfully'
  });
}));

// Get available employees for shift
router.get('/shift/:shiftId/available-employees', authenticate, requirePermission('assignment.manage'), validateParams(shiftIdParam), asyncHandler(async (_req: Request, res: Response) => {
  const { shiftId } = res.locals.params;

  const employees = await assignmentService.getAvailableEmployeesForShift(shiftId);
  res.json({ success: true, data: employees });
}));

  return router;
};
