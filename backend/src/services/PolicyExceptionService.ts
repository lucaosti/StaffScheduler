/**
 * Policy exception requests (deroghe).
 *
 * A user requests a per-target derogation to a specific policy. The approver
 * is resolved through the approval matrix (default: the policy owner). When
 * the actor is the resolved approver and auto-approve is on, the exception
 * is created already approved.
 *
 * Scheduling code uses `hasApproved()` to know whether a policy violation
 * has been waived for the target.
 *
 * @author Luca Ostinelli
 */

import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { logger } from '../config/logger';
import { ApprovalMatrixService } from './ApprovalMatrixService';
import { NotificationService } from './NotificationService';
import { PolicyService } from './PolicyService';

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
  private approvals: ApprovalMatrixService;
  private notifications: NotificationService;
  private policies: PolicyService;

  constructor(private pool: Pool) {
    this.approvals = new ApprovalMatrixService(pool);
    this.notifications = new NotificationService(pool);
    this.policies = new PolicyService(pool);
  }

  async create(input: CreateExceptionInput): Promise<PolicyExceptionRequest> {
    const policy = await this.policies.getById(input.policyId);
    if (!policy) throw new Error('Policy not found');

    const resolved = await this.approvals.resolve('Policy.Exception', {
      policyOwnerId: policy.imposedByUserId,
      actorUserId: input.requestedByUserId,
    });
    const status: ExceptionStatus = resolved.autoApprove ? 'approved' : 'pending';
    const reviewerId = resolved.autoApprove ? input.requestedByUserId : null;

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
    if (status === 'pending' && resolved.approverUserId) {
      try {
        await this.notifications.notify({
          userId: resolved.approverUserId,
          type: 'policy.exception.requested',
          title: 'Policy exception request',
          body: `Exception requested for policy ${policy.policyKey} on ${input.targetType}#${input.targetId}.`,
        });
      } catch (err) {
        logger.warn(`Failed to notify approver: ${(err as Error).message}`);
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
      `SELECT * FROM policy_exception_requests${where} ORDER BY created_at DESC`,
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

  async approve(id: number, reviewerId: number, notes: string | null = null): Promise<PolicyExceptionRequest> {
    const existing = await this.getById(id);
    if (!existing) throw new Error('Exception request not found');
    const policy = await this.policies.getById(existing.policyId);
    if (!policy) throw new Error('Policy not found');
    const resolved = await this.approvals.resolve('Policy.Exception', {
      policyOwnerId: policy.imposedByUserId,
      actorUserId: reviewerId,
    });
    if (resolved.approverUserId !== reviewerId) {
      throw new Error('Forbidden');
    }
    const [res] = await this.pool.execute<ResultSetHeader>(
      `UPDATE policy_exception_requests
          SET status = 'approved', reviewer_user_id = ?, reviewed_at = CURRENT_TIMESTAMP, review_notes = ?
        WHERE id = ? AND status = 'pending'`,
      [reviewerId, notes, id]
    );
    if (res.affectedRows === 0) {
      throw new Error(`Cannot approve exception in status '${existing.status}'`);
    }
    const refreshed = await this.getById(id);
    if (!refreshed) throw new Error('Failed to refresh exception');
    await this.notifications.notify({
      userId: refreshed.requestedByUserId,
      type: 'policy.exception.approved',
      title: 'Exception approved',
      body: notes ?? 'Your policy exception was approved.',
    });
    return refreshed;
  }

  async reject(id: number, reviewerId: number, notes: string | null = null): Promise<PolicyExceptionRequest> {
    const existing = await this.getById(id);
    if (!existing) throw new Error('Exception request not found');
    const policy = await this.policies.getById(existing.policyId);
    if (!policy) throw new Error('Policy not found');
    const resolved = await this.approvals.resolve('Policy.Exception', {
      policyOwnerId: policy.imposedByUserId,
      actorUserId: reviewerId,
    });
    if (resolved.approverUserId !== reviewerId) {
      throw new Error('Forbidden');
    }
    const [res] = await this.pool.execute<ResultSetHeader>(
      `UPDATE policy_exception_requests
          SET status = 'rejected', reviewer_user_id = ?, reviewed_at = CURRENT_TIMESTAMP, review_notes = ?
        WHERE id = ? AND status = 'pending'`,
      [reviewerId, notes, id]
    );
    if (res.affectedRows === 0) {
      throw new Error(`Cannot reject exception in status '${existing.status}'`);
    }
    const refreshed = await this.getById(id);
    if (!refreshed) throw new Error('Failed to refresh exception');
    await this.notifications.notify({
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
      if (!existing) throw new Error('Exception request not found');
      if (existing.requestedByUserId !== requesterId) throw new Error('Forbidden');
      throw new Error(`Cannot cancel exception in status '${existing.status}'`);
    }
    const refreshed = await this.getById(id);
    if (!refreshed) throw new Error('Failed to refresh exception');
    return refreshed;
  }
}
