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
 * employee's behalf, which defeats the purpose. Those routes declare
 * `scope.ownerOr` instead: the owner passes, anyone else needs
 * `assignment.manage` over the shift's unit. `complete` is management-gated
 * because it asserts that work actually happened.
 *
 * ORG-UNIT SCOPE (#813). An assignment is in scope through its shift's
 * department. Creating one names a shift AND a person, and both are checked: a
 * shift in another unit would put work there, and a person from another unit
 * would pull them into the caller's schedule without that unit's say.
 *
 * @author Luca Ostinelli
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'mysql2/promise';
import { z } from 'zod';
import { AssignmentService } from '../services/AssignmentService';
import { AuditLogService } from '../services/AuditLogService';
import { ExportService } from '../services/ExportService';
import { assignmentColumns } from '../services/exportColumns';
import { SwapCandidateService } from '../services/SwapCandidateService';
import { RbacService } from '../services/RbacService';
import { scopeFilter } from '../services/access/AccessPolicy';
import { authenticate, requirePermission, userHasPermission } from '../middleware/auth';
import { accessScope } from '../middleware/accessScope';
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
  batchCreateAssignmentsBody,
  updateAssignmentBody,
} from '../schemas';
import { User } from '../types';
import { NotFoundError } from '../errors';
import { parsePagination, sendPaginated } from '../middleware/pagination';
import { runBatch } from '../utils/batch';

export const createAssignmentsRouter = (pool: Pool) => {
  const router = Router();
  const assignmentService = new AssignmentService(pool);
const exporter = new ExportService(new AuditLogService(pool));
const scope = accessScope(pool);

// Get all assignments.
//
// The filters below were documented in the OpenAPI spec long before the
// handler read them: it called getAllAssignments() with no arguments, so a
// request for one user's assignments returned everyone's. They are now parsed
// from a schema, and the listing is bounded — see AssignmentService for why an
// oversized unpaginated request is refused rather than truncated.
router.get('/', authenticate, requirePermission('assignment.manage'), validateQuery(assignmentListQuery), async (req: Request, res: Response) => {
  // page/pageSize belong to the pagination envelope, not to the SQL filters.
  const { page: _page, pageSize: _pageSize, ...query } = res.locals.query;
  const filters = { ...query, orgUnitIds: scopeFilter(req.user!, 'assignment.manage') };
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
});

// Before `/:id`, so "export" is not read as an assignment id.
router.get('/export', authenticate, requirePermission('assignment.manage'), validateQuery(assignmentListQuery), async (req: Request, res: Response) => {
  const { page: _page, pageSize: _pageSize, format, ...query } = res.locals.query;
  const filters = { ...query, orgUnitIds: scopeFilter(req.user!, 'assignment.manage') };
  // The unpaginated listing refuses an oversized result rather than truncating
  // it (see AssignmentService); the export inherits that, which is the right
  // failure — a silently truncated file is a wrong answer that looks complete.
  const assignments = await assignmentService.getAllAssignments(filters);
  await exporter.send(res, {
    actorId: req.user?.id ?? null,
    dataset: 'assignments',
    rows: assignments,
    columns: assignmentColumns,
    filters,
    format,
  });
});

// Allowed when: the assignment belongs to the caller, or they hold
// assignment.manage over its unit.
router.get('/:id', authenticate, validateParams(idParam), scope.ownerOr('assignment.manage', 'assignment', 'params.id'), async (_req: Request, res: Response) => {
  const assignment = await assignmentService.getAssignmentById(res.locals.params.id);
  if (!assignment) throw new NotFoundError('Assignment not found');
  res.json({ success: true, data: assignment });
});

router.post('/', authenticate, requirePermission('assignment.manage'), validateBody(createAssignmentBody), scope.reach('assignment.manage', 'shift', 'body.shiftId'), scope.reach('assignment.manage', 'user', 'body.userId'), async (req: Request, res: Response) => {
  const assignment = await assignmentService.createAssignment({
    ...res.locals.body,
    actorId: req.user?.id,
  });

  res.status(201).json({
    success: true,
    data: assignment,
    message: 'Assignment created successfully'
  });
});

router.put('/:id', authenticate, requirePermission('assignment.manage'), validateParams(idParam), validateBody(updateAssignmentBody), scope.reach('assignment.manage', 'assignment', 'params.id'), async (req: Request, res: Response) => {
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
});

router.delete('/:id', authenticate, requirePermission('assignment.manage'), validateParams(idParam), validateBody(auditReasonBody), scope.reach('assignment.manage', 'assignment', 'params.id'), async (req: Request, res: Response) => {
  const { id } = res.locals.params;
  const reason = res.locals.body.reason;

  await assignmentService.deleteAssignment(id, req.user?.id, reason);
  res.json({
    success: true,
    message: 'Assignment deleted successfully'
  });
});

// Allowed when: the caller is requesting their own assignments, or holds
// assignment.manage over a unit the person belongs to.
router.get('/user/:userId', authenticate, validateParams(userIdParam), scope.ownerOr('assignment.manage', 'user', 'params.userId'), async (_req: Request, res: Response) => {
  const assignments = await assignmentService.getAssignmentsByUser(res.locals.params.userId);
  res.json({ success: true, data: assignments });
});

// Which of other people's shifts this one could be swapped for.
//
// Deliberately NOT gated on `assignment.manage`. Proposing a swap is something
// an ordinary employee does, and every other endpoint that lists someone
// else's assignments requires that permission — which left the swap feature
// reachable only by someone who already knew a colleague's numeric assignment
// id. The service enforces the two things that make this safe: the caller must
// own the assignment, and the answer is bounded by the org units they belong
// to, resolved here rather than accepted from the request.
router.get('/:id/swap-candidates', authenticate, validateParams(idParam), async (req: Request, res: Response) => {
  const { id } = res.locals.params;
  const actor = req.user as User;

  // A manager is bounded by their scope for `assignment.manage`; anyone else by
  // the units they belong to, narrowed further by a scoped role where there is
  // one. The same reasoning as the timeline, and for the same reason: this is a
  // question about seeing people.
  let orgUnitIds: number[] | null;
  if (userHasPermission(actor, 'assignment.manage')) {
    orgUnitIds = scopeFilter(actor, 'assignment.manage') ?? null;
  } else {
    const scoped = actor.allowedOrgUnitIds ?? null;
    const own = await new RbacService(pool).getUserOrgUnitSubtreeIds(actor.id);
    orgUnitIds = scoped === null ? own : own.filter((unit) => scoped.includes(unit));
  }

  const result = await new SwapCandidateService(pool).forAssignment(id, actor.id, orgUnitIds);
  res.json({ success: true, data: result });
});

router.get('/shift/:shiftId', authenticate, requirePermission('assignment.manage'), validateParams(shiftIdParam), scope.reach('assignment.manage', 'shift', 'params.shiftId'), async (_req: Request, res: Response) => {
  const { shiftId } = res.locals.params;

  const assignments = await assignmentService.getAssignmentsByShift(shiftId);
  res.json({ success: true, data: assignments });
});

router.get('/department/:departmentId', authenticate, requirePermission('assignment.manage'), validateParams(departmentIdParam), validateQuery(assignmentsByDepartmentQuery), scope.reach('assignment.manage', 'department', 'params.departmentId'), async (_req: Request, res: Response) => {
  const { departmentId } = res.locals.params;
  // The allowed statuses used to be a literal array checked inline here; the
  // schema now owns them, so the enum cannot drift from the documented one.
  const assignments = await assignmentService.getAssignmentsByDepartment(
    departmentId,
    res.locals.query.status
  );
  res.json({ success: true, data: assignments });
});

// Every row's shift and person are checked before anything is created: this
// endpoint's callers accept partial creation, but not into another unit.
router.post('/bulk', authenticate, requirePermission('assignment.manage'), validateBody(bulkCreateAssignmentsBody), scope.reach('assignment.manage', 'shift', 'body.assignments[].shiftId'), scope.reach('assignment.manage', 'user', 'body.assignments[].userId'), async (_req: Request, res: Response) => {
  const { assignments } = res.locals.body;

  const createdAssignments = await assignmentService.bulkCreateAssignments(assignments);

  res.status(201).json({
    success: true,
    data: { assignments: createdAssignments, count: createdAssignments.length },
    message: `${createdAssignments.length} assignments created successfully`
  });
});

// Distinct from `/bulk` above on purpose (#316): `/bulk` predates this and
// exists for internal callers that create what they can and discard the rest
// (see `AssignmentService.bulkCreateAssignments`'s header). A high-volume
// integration needs the opposite — one outcome per input row, so it can tell
// exactly which of 200 rows failed and retry only those. The scope check runs
// per row for the same reason: one out-of-scope row is that row's failure.
router.post('/batch', authenticate, requirePermission('assignment.manage'), validateBody(batchCreateAssignmentsBody), async (req: Request, res: Response) => {
  const { assignments } = res.locals.body as z.infer<typeof batchCreateAssignmentsBody>;
  const actor = req.user!;
  const result = await runBatch(assignments, async (assignmentData) => {
    await scope.policy.assertReach(actor, 'assignment.manage', 'shift', assignmentData.shiftId);
    await scope.policy.assertReach(actor, 'assignment.manage', 'user', assignmentData.userId);
    return assignmentService.createAssignment({ ...assignmentData, actorId: actor.id });
  });

  res.status(207).json({
    success: true,
    data: result,
    message: `${result.succeeded} of ${result.succeeded + result.failed} assignments created successfully`
  });
});

// Only the assigned user or a manager (assignment.manage over its unit) may confirm.
router.patch('/:id/confirm', authenticate, validateParams(idParam), scope.ownerOr('assignment.manage', 'assignment', 'params.id'), async (req: Request, res: Response) => {
  const assignment = await assignmentService.confirmAssignment(res.locals.params.id, req.user!.id);
  res.json({
    success: true,
    data: assignment,
    message: 'Assignment confirmed successfully'
  });
});

// Only the assigned user or a manager (assignment.manage over its unit) may decline.
router.patch('/:id/decline', authenticate, validateParams(idParam), scope.ownerOr('assignment.manage', 'assignment', 'params.id'), async (req: Request, res: Response) => {
  const assignment = await assignmentService.declineAssignment(res.locals.params.id, req.user!.id);

  res.json({
    success: true,
    data: assignment,
    message: 'Assignment declined successfully'
  });
});

// Only a manager (assignment.manage) may mark an assignment complete.
router.patch('/:id/complete', authenticate, requirePermission('assignment.manage'), validateParams(idParam), scope.reach('assignment.manage', 'assignment', 'params.id'), async (req: Request, res: Response) => {
  const { id } = res.locals.params;

  const assignment = await assignmentService.completeAssignment(id, req.user?.id);
  res.json({
    success: true,
    data: assignment,
    message: 'Assignment completed successfully'
  });
});

router.get('/shift/:shiftId/available-employees', authenticate, requirePermission('assignment.manage'), validateParams(shiftIdParam), scope.reach('assignment.manage', 'shift', 'params.shiftId'), async (_req: Request, res: Response) => {
  const { shiftId } = res.locals.params;

  const employees = await assignmentService.getAvailableEmployeesForShift(shiftId);
  res.json({ success: true, data: employees });
});

  return router;
};
