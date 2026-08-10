/**
 * Policy exception requests (deroghe).
 *
 * A user requests a per-target derogation to a specific policy. Creation
 * decides auto-approval (actor is already the resolved policy owner) via
 * `ApproverResolutionService.resolveFirstStepAutoApprove` — resolved from the
 * same `Policy.Exception` workflow the request is about to be attached to,
 * not a second, parallel `approval_matrix` lookup, the same fast path
 * `EmployeeLoanService` uses. Otherwise the request is routed through the
 * modern `approval_workflows`/`pending_approvals` engine, exactly like
 * time-off, loans, and shift-swap decisions, with the same ordered
 * multi-step routing, structure delegation, and responsibility rules those
 * request types get.
 *
 * Scheduling code uses `hasApproved()` to know whether a policy violation
 * has been waived for the target.
 *
 * @author Luca Ostinelli
 */

import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors';
import { logger } from '../config/logger';
import { ApproverResolutionService } from './ApproverResolutionService';
import { ApprovalDecisionService } from './ApprovalDecisionService';
import { NotificationService } from './NotificationService';
import { PolicyService } from './PolicyService';
import { AuditLogService } from './AuditLogService';

type ExceptionStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

interface PolicyExceptionRequest {
  id: number;
  policyId: number;
  targetType: string;
  targetId: number;
  reason: string | null;
  status: ExceptionStatus;
  requestedByUserId: number;
  reviewerUserId: number | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CreateExceptionInput {
  policyId: number;
  targetType: string;
  targetId: number;
  reason?: string | null;
  requestedByUserId: number;
}

interface ListExceptionFilters {
  policyId?: number;
  targetType?: string;
  targetId?: number;
  status?: ExceptionStatus;
  requestedByUserId?: number;
}

const mapRow = (row: RowDataPacket): PolicyExceptionRequest => ({
  id: row.id as number,
  policyId: row.policy_id as number,
  targetType: row.target_type as string,
  targetId: row.target_id as number,
  reason: (row.reason as string | null) ?? null,
  status: row.status as ExceptionStatus,
  requestedByUserId: row.requested_by_user_id as number,
  reviewerUserId: (row.reviewer_user_id as number | null) ?? null,
  reviewedAt: (row.reviewed_at as string | null) ?? null,
  reviewNotes: (row.review_notes as string | null) ?? null,
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
});

export class PolicyExceptionService {
  private resolution: ApproverResolutionService;
  private decisions: ApprovalDecisionService;
  private notifications: NotificationService;
  private policies: PolicyService;
  private audit: AuditLogService;

  constructor(private pool: Pool) {
    this.resolution = new ApproverResolutionService(pool);
    this.decisions = new ApprovalDecisionService(pool);
    this.notifications = new NotificationService(pool);
    this.policies = new PolicyService(pool);
    this.audit = new AuditLogService(pool);
  }

  /**
   * Creates an exception request. If the actor is the resolved policy owner
   * and the workflow's first step allows auto-approval, the request is
   * created already approved. Otherwise it is attached to that first step.
   */
  async create(input: CreateExceptionInput): Promise<PolicyExceptionRequest> {
    const policy = await this.policies.getById(input.policyId);
    if (!policy) throw new NotFoundError('Policy not found');

    const workflowCtx = { actorUserId: input.requestedByUserId, policyOwnerId: policy.imposedByUserId };
    const resolved = await this.resolution.resolveFirstStepAutoApprove('Policy.Exception', workflowCtx);
    const status: ExceptionStatus = resolved.autoApprove ? 'approved' : 'pending';
    const reviewerId = resolved.autoApprove ? resolved.approverUserId : null;

    // Resolve the approval gate BEFORE inserting the request — same
    // reasoning as EmployeeLoanService.create: a pending request whose
    // configured workflow cannot attach an approver (e.g. the policy has no
    // owner who can decide it) would otherwise be inserted with no
    // pending_approvals row, permanently undecidable by anyone.
    // `resolved.workflow` is reused rather than re-fetched.
    const workflow = resolved.autoApprove ? null : resolved.workflow;
    if (workflow && workflow.steps.length > 0) {
      if (!(await this.resolution.canCreatePendingApprovalForStep(workflow.steps[0], workflowCtx))) {
        throw new ConflictError(
          'No approver could be resolved for this exception request — the policy has no owner who can decide it. Ask an administrator to fix the assignment.'
        );
      }
    }

    const [res] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO policy_exception_requests
         (policy_id, target_type, target_id, reason, status,
          requested_by_user_id, reviewer_user_id, reviewed_at, review_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.policyId,
        input.targetType,
        input.targetId,
        input.reason ?? null,
        status,
        input.requestedByUserId,
        reviewerId,
        resolved.autoApprove ? new Date() : null,
        resolved.autoApprove ? 'auto-approved (actor is policy owner)' : null,
      ]
    );
    const created = await this.getById(res.insertId);
    if (!created) throw new Error('Failed to create exception request');
    logger.info(
      `Policy exception created: id=${created.id} policy=${input.policyId} status=${status}`
    );
    await this.audit.write({
      actorId: input.requestedByUserId,
      action: 'policy_exception.create',
      entityType: 'policy_exception_request',
      entityId: created.id,
      description: `Policy exception requested for policy ${input.policyId} on ${input.targetType}#${input.targetId}`,
      justification: input.reason ?? null,
      after: { id: created.id, status, policyId: input.policyId },
    });
    // notifyAsync is fire-and-forget and already logs its own failures (see
    // NotificationService.notifyAsync) — it never throws synchronously, so a
    // try/catch here could never fire. Removed rather than kept as
    // reassuring-looking dead code.
    if (status === 'pending' && resolved.approverUserId) {
      this.notifications.notifyAsync({
        userId: resolved.approverUserId,
        type: 'policy.exception.requested',
        title: 'Policy exception request',
        body: `Exception requested for policy ${policy.policyKey} on ${input.targetType}#${input.targetId}.`,
      });
    }

    if (workflow && workflow.steps.length > 0) {
      const pa = await this.decisions.createPendingApprovalForStep(
        workflow.id,
        workflow.steps[0],
        { policyExceptionId: created.id },
        workflowCtx
      );
      if (!pa) {
        // The pre-insert check passed but resolution changed underneath us
        // (e.g. the policy's owner was concurrently changed). Never leave a
        // stranded, undecidable request behind.
        await this.pool.execute(`DELETE FROM policy_exception_requests WHERE id = ?`, [created.id]);
        throw new ConflictError('No approver could be resolved for this exception request — approver resolution changed during creation. Please retry.');
      }
    }

    return created;
  }

  async getById(id: number): Promise<PolicyExceptionRequest | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM policy_exception_requests WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows.length === 0 ? null : mapRow(rows[0]);
  }

  async list(filters: ListExceptionFilters = {}): Promise<PolicyExceptionRequest[]> {
    const conditions: string[] = [];
    const params: Array<string | number> = [];
    if (filters.policyId !== undefined) {
      conditions.push('policy_id = ?');
      params.push(filters.policyId);
    }
    if (filters.targetType) {
      conditions.push('target_type = ?');
      params.push(filters.targetType);
    }
    if (filters.targetId !== undefined) {
      conditions.push('target_id = ?');
      params.push(filters.targetId);
    }
    if (filters.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    }
    if (filters.requestedByUserId !== undefined) {
      conditions.push('requested_by_user_id = ?');
      params.push(filters.requestedByUserId);
    }
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM policy_exception_requests${where} ORDER BY created_at DESC LIMIT 500`,
      params
    );
    return rows.map(mapRow);
  }

  /** True when an approved exception covers the given target. */
  async hasApproved(policyId: number, targetType: string, targetId: number): Promise<boolean> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM policy_exception_requests
        WHERE policy_id = ? AND target_type = ? AND target_id = ? AND status = 'approved'`,
      [policyId, targetType, targetId]
    );
    return ((rows[0] as { c: number }).c) > 0;
  }

  private async findPendingApprovalId(policyExceptionId: number): Promise<number | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id FROM pending_approvals WHERE policy_exception_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`,
      [policyExceptionId]
    );
    return rows.length === 0 ? null : ((rows[0] as any).id as number);
  }

  async approve(
    id: number,
    reviewerId: number,
    notes: string | null = null,
    organizationName: string | null = null
  ): Promise<PolicyExceptionRequest> {
    const existing = await this.getById(id);
    if (!existing) throw new NotFoundError('Exception request not found');
    if (existing.status !== 'pending') {
      throw new ConflictError(`Cannot approve exception in status '${existing.status}'`);
    }
    const policy = await this.policies.getById(existing.policyId);
    if (!policy) throw new NotFoundError('Policy not found');
    const pendingApprovalId = await this.findPendingApprovalId(id);
    if (pendingApprovalId === null) throw new ConflictError('No pending approval found for this exception request');
    const decision = await this.decisions.decidePendingApproval(
      pendingApprovalId,
      reviewerId,
      'approved',
      notes,
      async () => ({ actorUserId: reviewerId, policyOwnerId: policy.imposedByUserId }),
      organizationName
    );
    if (!decision.isFinalStep) {
      const refreshed = await this.getById(id);
      if (!refreshed) throw new Error('Failed to refresh exception');
      return refreshed;
    }
    const [res] = await this.pool.execute<ResultSetHeader>(
      `UPDATE policy_exception_requests
          SET status = 'approved', reviewer_user_id = ?, reviewed_at = CURRENT_TIMESTAMP, review_notes = ?
        WHERE id = ? AND status = 'pending'`,
      [reviewerId, notes, id]
    );
    if (res.affectedRows === 0) {
      throw new ConflictError(`Cannot approve exception in status '${existing.status}'`);
    }
    const refreshed = await this.getById(id);
    if (!refreshed) throw new Error('Failed to refresh exception');
    await this.audit.write({
      actorId: reviewerId,
      action: 'policy_exception.approve',
      entityType: 'policy_exception_request',
      entityId: id,
      description: `Policy exception approved`,
      justification: notes ?? null,
      after: { status: 'approved', reviewerId },
    });
    this.notifications.notifyAsync({
      userId: refreshed.requestedByUserId,
      type: 'policy.exception.approved',
      title: 'Exception approved',
      body: notes ?? 'Your policy exception was approved.',
    });
    return refreshed;
  }

  async reject(
    id: number,
    reviewerId: number,
    notes: string | null = null,
    organizationName: string | null = null
  ): Promise<PolicyExceptionRequest> {
    const existing = await this.getById(id);
    if (!existing) throw new NotFoundError('Exception request not found');
    if (existing.status !== 'pending') {
      throw new ConflictError(`Cannot reject exception in status '${existing.status}'`);
    }
    const policy = await this.policies.getById(existing.policyId);
    if (!policy) throw new NotFoundError('Policy not found');
    const pendingApprovalId = await this.findPendingApprovalId(id);
    if (pendingApprovalId === null) throw new ConflictError('No pending approval found for this exception request');
    await this.decisions.decidePendingApproval(
      pendingApprovalId,
      reviewerId,
      'rejected',
      notes,
      async () => ({ actorUserId: reviewerId, policyOwnerId: policy.imposedByUserId }),
      organizationName
    );
    const [res] = await this.pool.execute<ResultSetHeader>(
      `UPDATE policy_exception_requests
          SET status = 'rejected', reviewer_user_id = ?, reviewed_at = CURRENT_TIMESTAMP, review_notes = ?
        WHERE id = ? AND status = 'pending'`,
      [reviewerId, notes, id]
    );
    if (res.affectedRows === 0) {
      throw new ConflictError(`Cannot reject exception in status '${existing.status}'`);
    }
    const refreshed = await this.getById(id);
    if (!refreshed) throw new Error('Failed to refresh exception');
    await this.audit.write({
      actorId: reviewerId,
      action: 'policy_exception.reject',
      entityType: 'policy_exception_request',
      entityId: id,
      description: `Policy exception rejected`,
      justification: notes ?? null,
      after: { status: 'rejected', reviewerId },
    });
    this.notifications.notifyAsync({
      userId: refreshed.requestedByUserId,
      type: 'policy.exception.rejected',
      title: 'Exception rejected',
      body: notes ?? 'Your policy exception was rejected.',
    });
    return refreshed;
  }

  async cancel(id: number, requesterId: number): Promise<PolicyExceptionRequest> {
    const [res] = await this.pool.execute<ResultSetHeader>(
      `UPDATE policy_exception_requests
          SET status = 'cancelled'
        WHERE id = ? AND requested_by_user_id = ? AND status = 'pending'`,
      [id, requesterId]
    );
    if (res.affectedRows === 0) {
      const existing = await this.getById(id);
      if (!existing) throw new NotFoundError('Exception request not found');
      if (existing.requestedByUserId !== requesterId) throw new ForbiddenError('Forbidden');
      throw new ConflictError(`Cannot cancel exception in status '${existing.status}'`);
    }
    const refreshed = await this.getById(id);
    if (!refreshed) throw new Error('Failed to refresh exception');
    await this.audit.write({
      actorId: requesterId,
      action: 'policy_exception.cancel',
      entityType: 'policy_exception_request',
      entityId: id,
      description: `Policy exception request cancelled`,
      after: { status: 'cancelled' },
    });
    return refreshed;
  }
}
