/**
 * Schedule routes — CRUD, the publish/archive lifecycle, and optimization.
 *
 * WHY `/:id/generate` DOES NOT RETURN THE SCHEDULE. Optimization can run for
 * minutes, so when Redis is available the route enqueues a BullMQ job and
 * answers `202 { jobId }`; the client then polls `GET /:id/optimization` or
 * listens on the SSE stream. Holding the request open for the duration was the
 * obvious alternative and was rejected: it ties up a connection, dies on any
 * proxy timeout, and gives the caller no way to cancel. Without Redis the route
 * falls back to running the solve inline and returning `200` with the result,
 * so a local install with no infrastructure still works — the response shape
 * differs, and callers branch on the presence of `jobId`.
 *
 * The job id is deterministic per schedule (`schedule:{id}`), so a second
 * generate while one is in flight joins the existing job rather than starting a
 * competing solve over the same rows.
 *
 * WHY THE RESULT ALWAYS CARRIES `engine` AND `degraded`. The optimum comes from
 * the Python CP-SAT solver; if it is unavailable the run degrades to the greedy
 * TypeScript engine. That fallback must never be silent — a draft schedule that
 * looks like an optimum gets published. Every generation result therefore
 * states which engine produced it and whether the optimum was requested but not
 * achieved, and the UI surfaces it prominently.
 *
 * ROUTE ORDER MATTERS HERE: `/department/:departmentId` and `/user/:userId` are
 * registered after `/:id`, so they are unambiguous only because their prefixes
 * are literal segments. Adding a route whose first segment could be an id
 * requires registering it BEFORE `/:id` — see `shifts.ts`, where `/templates`
 * has to come first for that reason.
 *
 * @author Luca Ostinelli
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'mysql2/promise';
import { NotFoundError } from '../errors';
import { ScheduleService } from '../services/ScheduleService';
import { ReplanProposalService } from '../services/ReplanProposalService';
import {
  enqueueOptimization,
  getOptimizationStatus,
  cancelOptimization,
} from '../services/OptimizationQueue';
import { authenticate, requirePermission } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { parsePagination, sendPaginated } from '../middleware/pagination';
import { validateParams, validateBody, validateQuery } from '../middleware/validation';
import {
  idParam,
  idAndProposalIdParam,
  departmentIdParam,
  userIdParam,
  createScheduleBody,
  duplicateScheduleBody,
  updateScheduleBody,
  scheduleListQuery,
  auditReasonBody,
} from '../schemas';

export const createSchedulesRouter = (pool: Pool) => {
  const router = Router();
  const scheduleService = new ScheduleService(pool);
  const replanProposals = new ReplanProposalService(pool);

// Get all schedules
// departmentId/startDate/endDate were documented but never read: the handler
// applied only the caller's org-unit scope, so a filtered request returned
// every schedule the caller could see.
router.get('/', authenticate, requirePermission('schedule.read'), validateQuery(scheduleListQuery), asyncHandler(async (req: Request, res: Response) => {
  const scope = req.user?.allowedOrgUnitIds;
  const { page: _page, pageSize: _pageSize, ...queryFilters } = res.locals.query;
  const filters = {
    ...queryFilters,
    ...(scope !== null && scope !== undefined ? { orgUnitIds: scope } : {}),
  };
  const pagination = parsePagination(req);
  if (pagination) {
    const [total, schedules] = await Promise.all([
      scheduleService.countSchedules(filters),
      scheduleService.getAllSchedules(filters, { limit: pagination.pageSize, offset: pagination.offset }),
    ]);
    return sendPaginated(res, schedules, total, pagination);
  }
  const schedules = await scheduleService.getAllSchedules(filters);
  res.json({ success: true, data: schedules });
}));

// Get schedule by ID
router.get('/:id', authenticate, requirePermission('schedule.read'), validateParams(idParam), asyncHandler(async (req: Request, res: Response) => {
  const { id } = res.locals.params;

  const schedule = await scheduleService.getScheduleById(id);
  if (!schedule) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Schedule not found' }
    });
  }

  const scope = req.user?.allowedOrgUnitIds;
  if (scope !== null && scope !== undefined) {
    const deptOrgUnitId = schedule.departmentOrgUnitId ?? null;
    if (deptOrgUnitId === null || !scope.includes(deptOrgUnitId)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access to this schedule is outside your scope' },
      });
    }
  }

  res.json({ success: true, data: schedule });
}));

// Get schedule with shifts
router.get('/:id/shifts', authenticate, requirePermission('schedule.read'), validateParams(idParam), asyncHandler(async (req: Request, res: Response) => {
  const { id } = res.locals.params;

  const schedule = await scheduleService.getScheduleWithShifts(id);
  if (!schedule) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Schedule not found' }
    });
  }

  // Enforce org-unit scope — same rule as GET /:id.
  const scope = req.user?.allowedOrgUnitIds;
  if (scope !== null && scope !== undefined) {
    const deptOrgUnitId = schedule.departmentOrgUnitId ?? null;
    if (deptOrgUnitId === null || !scope.includes(deptOrgUnitId)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access to this schedule is outside your scope' },
      });
    }
  }

  res.json({ success: true, data: schedule });
}));

// Create new schedule
router.post('/', authenticate, requirePermission('schedule.manage'), validateBody(createScheduleBody), asyncHandler(async (req: Request, res: Response) => {
  // Guaranteed by authenticate, as on every protected route.
  const user = req.user!;

  const schedule = await scheduleService.createSchedule({ ...res.locals.body, createdBy: user.id });

  res.status(201).json({
    success: true,
    data: schedule,
    message: 'Schedule created successfully'
  });
}));

// Update schedule
router.put('/:id', authenticate, requirePermission('schedule.manage'), validateParams(idParam), validateBody(updateScheduleBody), asyncHandler(async (_req: Request, res: Response) => {
  const { id } = res.locals.params;

  const schedule = await scheduleService.updateSchedule(id, res.locals.body);
  res.json({
    success: true,
    data: schedule,
    message: 'Schedule updated successfully'
  });
}));

// Delete schedule
router.delete('/:id', authenticate, requirePermission('schedule.manage'), validateParams(idParam), asyncHandler(async (_req: Request, res: Response) => {
  const { id } = res.locals.params;

  await scheduleService.deleteSchedule(id);
  res.json({
    success: true,
    message: 'Schedule deleted successfully'
  });
}));

// Get schedules by department
router.get('/department/:departmentId', authenticate, requirePermission('schedule.read'), validateParams(departmentIdParam), asyncHandler(async (_req: Request, res: Response) => {
  const { departmentId } = res.locals.params;

  const schedules = await scheduleService.getSchedulesByDepartment(departmentId);
  res.json({ success: true, data: schedules });
}));

// Get schedules by user
// Allowed when: the caller holds schedule.manage OR is querying their own schedules.
router.get('/user/:userId', authenticate, validateParams(userIdParam), asyncHandler(async (req: Request, res: Response) => {
  const { userId } = res.locals.params;
  const actor = req.user;

  const canManage = actor?.permissions?.includes('schedule.manage') ?? false;
  if (!canManage && actor?.id !== userId) {
    return res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Access denied' }
    });
  }

  const schedules = await scheduleService.getSchedulesByUser(userId);
  res.json({ success: true, data: schedules });
}));

// Publish schedule
router.patch('/:id/publish', authenticate, requirePermission('schedule.publish'), validateParams(idParam), validateBody(auditReasonBody), asyncHandler(async (req: Request, res: Response) => {
  const { id } = res.locals.params;

  const reason = res.locals.body.reason;
  const schedule = await scheduleService.publishSchedule(id, req.user!.id, reason);
  res.json({
    success: true,
    data: schedule,
    message: 'Schedule published successfully'
  });
}));

// Archive schedule
router.patch('/:id/archive', authenticate, requirePermission('schedule.manage'), validateParams(idParam), asyncHandler(async (req: Request, res: Response) => {
  const { id } = res.locals.params;

  const schedule = await scheduleService.archiveSchedule(id, req.user!.id);
  res.json({
    success: true,
    data: schedule,
    message: 'Schedule archived successfully'
  });
}));

// Duplicate schedule
router.post('/:id/duplicate', authenticate, requirePermission('schedule.manage'), validateParams(idParam), validateBody(duplicateScheduleBody), asyncHandler(async (_req: Request, res: Response) => {
  const { id } = res.locals.params;
  const { name, startDate, endDate } = res.locals.body;

  const newSchedule = await scheduleService.duplicateSchedule(id, name, startDate, endDate);

  res.status(201).json({
    success: true,
    data: newSchedule,
    message: 'Schedule duplicated successfully'
  });
}));

// Generate an optimized schedule.
//
// Async by default: when the job queue is available (Redis configured), the
// long-running solve is enqueued and the endpoint returns 202 with a job id
// immediately, so the client polls status / receives SSE progress and can
// cancel — instead of holding the request open for minutes. Without Redis it
// falls back to running synchronously and returns 200 with the result, so a
// zero-Redis deployment still works (at the cost of a long request).
router.post('/:id/generate', authenticate, requirePermission('schedule.optimize'), validateParams(idParam), asyncHandler(async (req: Request, res: Response) => {
  const { id } = res.locals.params;
  const user = req.user!;

  const schedule = await scheduleService.getScheduleById(id);
  if (!schedule) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Schedule not found' }
    });
  }

  const jobId = await enqueueOptimization({ scheduleId: id, createdBy: user.id });
  if (jobId) {
    return res.status(202).json({
      success: true,
      data: { jobId, scheduleId: id, state: 'queued' },
      message: 'Optimization queued',
    });
  }

  // Synchronous fallback (no queue): run inline and return the result.
  const result = await scheduleService.generateOptimizedSchedule(id, user.id);
  res.json({
    success: true,
    data: result,
    message: 'Schedule generated successfully'
  });
}));

// Replanning proposals.
//
// A re-solve of a PUBLISHED schedule records a plan instead of applying it —
// applying first and reporting afterwards means the change to people's
// commitments has already happened before anyone could judge it. These are the
// endpoints that decide such a plan.
//
// Reading is gated on `schedule.optimize`: whoever may run the optimizer may
// see what it proposed. DECIDING is gated on `schedule.publish`, deliberately
// the stronger permission — applying a plan changes commitments people have
// already been told about, which is the same authority publishing represents.
// Gating it on `schedule.optimize` would let anyone who can press "generate"
// rearrange a live schedule, which is exactly the hole this whole mechanism
// exists to close.
router.get('/:id/replan-proposals', authenticate, requirePermission('schedule.optimize'), validateParams(idParam), asyncHandler(async (_req: Request, res: Response) => {
  res.json({ success: true, data: await replanProposals.listForSchedule(res.locals.params.id) });
}));

// The proposal must belong to the schedule in the path. Without this check the
// schedule segment would be decoration, and a proposal for another schedule
// could be applied through a path suggesting it was for this one.
const proposalOfSchedule = async (scheduleId: number, proposalId: number) => {
  const proposal = await replanProposals.getById(proposalId);
  if (proposal.scheduleId !== scheduleId) {
    throw new NotFoundError('Replan proposal not found for this schedule');
  }
  return proposal;
};

router.post('/:id/replan-proposals/:proposalId/apply', authenticate, requirePermission('schedule.publish'), validateParams(idAndProposalIdParam), validateBody(auditReasonBody), asyncHandler(async (req: Request, res: Response) => {
  const { id, proposalId } = res.locals.params;
  await proposalOfSchedule(id, proposalId);
  const applied = await replanProposals.apply(proposalId, req.user!.id, res.locals.body.reason ?? null);
  res.json({
    success: true,
    data: applied,
    message: `Plan applied: ${applied.inserted} assignment(s) added, ${applied.removed} removed`,
  });
}));

router.post('/:id/replan-proposals/:proposalId/reject', authenticate, requirePermission('schedule.publish'), validateParams(idAndProposalIdParam), validateBody(auditReasonBody), asyncHandler(async (req: Request, res: Response) => {
  const { id, proposalId } = res.locals.params;
  await proposalOfSchedule(id, proposalId);
  const rejected = await replanProposals.reject(proposalId, req.user!.id, res.locals.body.reason ?? null);
  res.json({ success: true, data: rejected, message: 'Plan rejected; the schedule is unchanged' });
}));

// Poll the status/progress/result of a schedule's optimization job.
router.get('/:id/optimization', authenticate, requirePermission('schedule.optimize'), validateParams(idParam), asyncHandler(async (_req: Request, res: Response) => {
  const { id } = res.locals.params;
  const status = await getOptimizationStatus(id);
  if (!status) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'No optimization job for this schedule' },
    });
  }
  res.json({ success: true, data: status });
}));

// Cancel a schedule's in-flight (or retained) optimization job.
router.delete('/:id/optimization', authenticate, requirePermission('schedule.optimize'), validateParams(idParam), asyncHandler(async (_req: Request, res: Response) => {
  const { id } = res.locals.params;
  const cancelled = await cancelOptimization(id);
  if (!cancelled) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'No optimization job to cancel' },
    });
  }
  res.json({ success: true, message: 'Optimization cancelled' });
}));

  return router;
};
