/**
 * Assignment routes — `/api/assignments`: who works which shift, and the
 * status transitions on that relationship.
 *
 * WHY THE LIST ENDPOINT REFUSES LARGE UNPAGINATED RESULTS RATHER THAN
 * TRUNCATING. `shift_assignments` is the fastest-growing table in the schema —
 * one row per person per shift, indefinitely — and the list query joins four
 * tables. An unpaginated request matching more than the cap is answered with a
 * `ValidationError`, not a silently shortened list, because a short list that
 * looks complete hides missing assignments and the caller has no way to tell.
 * Same reasoning as the audit export, which refuses rather than truncates.
 *
 * This endpoint is also where a real data-scoping defect lived: the handler
 * took `_req` and called `getAllAssignments()` with no arguments, so all seven
 * documented filters were discarded and a caller narrowing by `userId` received
 * everyone's rows. The fix was not to pass the arguments but to make the class
 * of bug impossible — `validateQuery` now ties the documented contract to the
 * parsing code, and the spec generator fails if the two disagree.
 *
 * WHY CONFIRM/DECLINE ARE NOT GATED ON `assignment.manage`. An employee
 * confirming or declining their OWN assignment is self-service; requiring the
 * management permission would mean only managers could respond on an
 * employee's behalf, which defeats the purpose. The handlers check ownership
 * in-line instead. `complete` is management-gated because it asserts that work
 * actually happened.
 *
 * @author Luca Ostinelli
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'mysql2/promise';
import { AssignmentService } from '../services/AssignmentService';
import { AuditLogService } from '../services/AuditLogService';
import { ExportService } from '../services/ExportService';
import { assignmentColumns } from '../services/exportColumns';
import { SwapCandidateService } from '../services/SwapCandidateService';
import { RbacService } from '../services/RbacService';
import { authenticate, requirePermission, userHasPermission } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateParams, validateBody, validateQuery } from '../middleware/validation';
import {
  idParam,
  userIdParam,
  shiftIdParam,
  departmentIdParam,
  assignmentListQuery,
  assignmentsByDepartmentQuery,
  auditReasonBody,
  createAssignmentBody,
  bulkCreateAssignmentsBody,
  updateAssignmentBody,
} from '../schemas';
import { User } from '../types';
import { ForbiddenError, NotFoundError } from '../errors';
import { parsePagination, sendPaginated } from '../middleware/pagination';

export const createAssignmentsRouter = (pool: Pool) => {
  const router = Router();
  const assignmentService = new AssignmentService(pool);
const exporter = new ExportService(new AuditLogService(pool));

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

// Before `/:id`, so "export" is not read as an assignment id.
router.get('/export', authenticate, requirePermission('assignment.manage'), validateQuery(assignmentListQuery), asyncHandler(async (req: Request, res: Response) => {
  const { page: _page, pageSize: _pageSize, ...filters } = res.locals.query;
  // The unpaginated listing refuses an oversized result rather than truncating
  // it (see AssignmentService); the export inherits that, which is the right
  // failure — a silently truncated file is a wrong answer that looks complete.
  const assignments = await assignmentService.getAllAssignments(filters);
  await exporter.sendCsv(res, {
    actorId: req.user?.id ?? null,
    dataset: 'assignments',
    rows: assignments,
    columns: assignmentColumns,
    filters,
  });
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
router.delete('/:id', authenticate, requirePermission('assignment.manage'), validateParams(idParam), validateBody(auditReasonBody), asyncHandler(async (req: Request, res: Response) => {
  const { id } = res.locals.params;
  const reason = res.locals.body.reason;

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

// Which of other people's shifts this one could be swapped for.
//
// Deliberately NOT gated on `assignment.manage`. Proposing a swap is something
// an ordinary employee does, and every other endpoint that lists someone
// else's assignments requires that permission — which left the swap feature
// reachable only by someone who already knew a colleague's numeric assignment
// id. The service enforces the two things that make this safe: the caller must
// own the assignment, and the answer is bounded by the org units they belong
// to, resolved here rather than accepted from the request.
router.get('/:id/swap-candidates', authenticate, validateParams(idParam), asyncHandler(async (req: Request, res: Response) => {
  const { id } = res.locals.params;
  const actor = req.user as User;

  // `allowedOrgUnitIds` is NULL for anyone whose roles carry no scope, and
  // NULL means unrestricted — so membership is the bound, narrowed further by
  // a scoped role where there is one. The same reasoning as the timeline, and
  // for the same reason: this is a question about seeing people.
  const scoped = actor.allowedOrgUnitIds ?? null;
  let orgUnitIds: number[] | null;
  if (userHasPermission(actor, 'assignment.manage')) {
    orgUnitIds = scoped;
  } else {
    const own = await new RbacService(pool).getUserOrgUnitSubtreeIds(actor.id);
    orgUnitIds = scoped === null ? own : own.filter((unit) => scoped.includes(unit));
  }

  const result = await new SwapCandidateService(pool).forAssignment(id, actor.id, orgUnitIds);
  res.json({ success: true, data: result });
}));

// Get assignments by shift
router.get('/shift/:shiftId', authenticate, requirePermission('assignment.manage'), validateParams(shiftIdParam), asyncHandler(async (_req: Request, res: Response) => {
  const { shiftId } = res.locals.params;

  const assignments = await assignmentService.getAssignmentsByShift(shiftId);
  res.json({ success: true, data: assignments });
}));

// Get assignments by department
router.get('/department/:departmentId', authenticate, requirePermission('assignment.manage'), validateParams(departmentIdParam), validateQuery(assignmentsByDepartmentQuery), asyncHandler(async (_req: Request, res: Response) => {
  const { departmentId } = res.locals.params;
  // The allowed statuses used to be a literal array checked inline here; the
  // schema now owns them, so the enum cannot drift from the documented one.
  const assignments = await assignmentService.getAssignmentsByDepartment(
    departmentId,
    res.locals.query.status
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
