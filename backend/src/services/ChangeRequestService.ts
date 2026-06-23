/**
 * Change Request Service
 *
 * Enables subordinates to propose changes that, once approved and applied,
 * are attributed to the authority holder (approver) in the audit log.
 * The proposer's identity is recorded in on_behalf_of_user_id so the full
 * chain of custody is always auditable.
 *
 * Lifecycle:  pending → approved → applied
 *                      → rejected
 *             pending → cancelled
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import {
  ChangeRequest,
  ChangeRequestStatus,
  CreateChangeRequestInput,
  ChangeRequestFilters,
  PendingApproval,
} from '../types';
import { logger } from '../config/logger';
import { AuditLogService } from './AuditLogService';
import { ApprovalEngineService } from './ApprovalEngineService';

const mapRow = (row: RowDataPacket): ChangeRequest => ({
  id: row.id as number,
  changeType: row.change_type as string,
  proposerUserId: row.proposer_user_id as number,
  targetEntityType: row.target_entity_type as string,
  targetEntityId: (row.target_entity_id as number | null) ?? null,
  proposedPayload: (() => {
    try { return typeof row.proposed_payload === 'string' ? JSON.parse(row.proposed_payload) : row.proposed_payload; } catch { return {}; }
  })(),
  justification: (row.justification as string | null) ?? null,
  status: row.status as ChangeRequestStatus,
  approverUserId: (row.approver_user_id as number | null) ?? null,
  approvedAt: (row.approved_at as string | null) ?? null,
  rejectedAt: (row.rejected_at as string | null) ?? null,
  rejectionReason: (row.rejection_reason as string | null) ?? null,
  appliedAt: (row.applied_at as string | null) ?? null,
  onBehalfOfUserId: (row.on_behalf_of_user_id as number | null) ?? null,
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
});

export class ChangeRequestService {
  private audit: AuditLogService;
  private engine: ApprovalEngineService;

  constructor(private pool: Pool) {
    this.audit = new AuditLogService(pool);
    this.engine = new ApprovalEngineService(pool);
  }

  // --------------------------------------------------------------------------
  // Read
  // --------------------------------------------------------------------------

  async list(filters: ChangeRequestFilters = {}): Promise<{ total: number; items: ChangeRequest[] }> {
    const conditions: string[] = [];
    const params: Array<string | number> = [];

    if (filters.proposerUserId !== undefined) {
      conditions.push('proposer_user_id = ?');
      params.push(filters.proposerUserId);
    }
    if (filters.approverUserId !== undefined) {
      conditions.push('approver_user_id = ?');
      params.push(filters.approverUserId);
    }
    if (filters.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    }
    if (filters.changeType) {
      conditions.push('change_type = ?');
      params.push(filters.changeType);
    }
    if (filters.targetEntityType) {
      conditions.push('target_entity_type = ?');
      params.push(filters.targetEntityType);
    }

    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';

    const [countRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM change_requests${where}`,
      params
    );
    const total = (countRows[0] as { c: number }).c;

    const limit = Math.max(1, Math.min(500, filters.limit ?? 100));
    const offset = Math.max(0, filters.offset ?? 0);

    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM change_requests${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return { total, items: rows.map(mapRow) };
  }

  async getById(id: number): Promise<ChangeRequest | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT * FROM change_requests WHERE id = ? LIMIT 1',
      [id]
    );
    return rows.length === 0 ? null : mapRow(rows[0]);
  }

  // --------------------------------------------------------------------------
  // Lifecycle mutations
  // --------------------------------------------------------------------------

  async create(input: CreateChangeRequestInput, proposerUserId: number): Promise<ChangeRequest> {
    const [res] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO change_requests
         (change_type, proposer_user_id, target_entity_type, target_entity_id,
          proposed_payload, justification, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [
        input.changeType,
        proposerUserId,
        input.targetEntityType,
        input.targetEntityId ?? null,
        JSON.stringify(input.proposedPayload),
        input.justification ?? null,
      ]
    );

    const created = await this.getById(res.insertId);
    if (!created) throw new Error('Failed to retrieve created change request');

    await this.audit.write({
      actorId: proposerUserId,
      action: 'change_request.create',
      entityType: 'change_request',
      entityId: created.id,
      description: `Change request proposed: ${created.changeType} on ${created.targetEntityType}`,
      justification: input.justification ?? undefined,
      after: created as unknown as Record<string, unknown>,
    });

    // Resolve proposer context for responsibility-rule-based approver lookup.
    const proposerCtx = await this.resolveProposerContext(proposerUserId);

    // Create first pending_approval if an approval workflow is configured for this change type.
    const workflow = await this.engine.getWorkflowByChangeType(input.changeType);
    if (workflow && workflow.steps.length > 0) {
      const firstStep = workflow.steps[0];
      const approverUserId = await this.engine.resolveApproverForStep(firstStep.id, {
        actorUserId: proposerUserId,
        orgUnitId: proposerCtx.orgUnitId ?? undefined,
        subjectDepartmentIds: proposerCtx.subjectDepartmentIds,
        subjectRoleIds: proposerCtx.subjectRoleIds,
      });
      if (approverUserId !== null) {
        await this.pool.execute(
          `INSERT INTO pending_approvals
             (change_request_id, workflow_id, step_id, step_order, assigned_to_user_id, status)
           VALUES (?, ?, ?, ?, ?, 'pending')`,
          [created.id, workflow.id, firstStep.id, firstStep.stepOrder, approverUserId]
        );
        logger.info(`Pending approval created: cr=${created.id} step=${firstStep.stepOrder} assignee=${approverUserId}`);
      }
    }

    logger.info(`Change request created: id=${created.id} type=${created.changeType} proposer=${proposerUserId}`);
    return created;
  }

  /**
   * Loads the org unit, department IDs, and role IDs for a user so the
   * approval engine can correctly resolve responsibility-rule-based approvers.
   */
  private async resolveProposerContext(userId: number): Promise<{
    orgUnitId: number | null;
    subjectDepartmentIds: number[];
    subjectRoleIds: number[];
  }> {
    const [orgRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT org_unit_id FROM user_org_units WHERE user_id = ? ORDER BY org_unit_id ASC LIMIT 1`,
      [userId]
    );
    const orgUnitId = orgRows.length > 0 ? ((orgRows[0] as any).org_unit_id as number) : null;

    const [deptRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT department_id FROM user_departments WHERE user_id = ?`,
      [userId]
    );
    const subjectDepartmentIds = (deptRows as any[]).map((r) => r.department_id as number);

    const [roleRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT role_id FROM user_roles
        WHERE user_id = ? AND (expires_at IS NULL OR expires_at > NOW())`,
      [userId]
    );
    const subjectRoleIds = (roleRows as any[]).map((r) => r.role_id as number);

    return { orgUnitId, subjectDepartmentIds, subjectRoleIds };
  }

  async approve(id: number, approverUserId: number, justification?: string | null): Promise<ChangeRequest> {
    const existing = await this.getById(id);
    if (!existing) throw new Error('Change request not found');
    if (existing.status !== 'pending') {
      throw new Error(`Cannot approve a change request in '${existing.status}' status`);
    }

    await this.pool.execute(
      `UPDATE change_requests
          SET status = 'approved', approver_user_id = ?, approved_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [approverUserId, id]
    );

    const updated = await this.getById(id);
    if (!updated) throw new Error('Failed to retrieve updated change request');

    await this.audit.write({
      actorId: approverUserId,
      action: 'change_request.approve',
      entityType: 'change_request',
      entityId: id,
      description: `Change request approved: ${existing.changeType} on ${existing.targetEntityType}`,
      justification: justification ?? undefined,
      before: existing as unknown as Record<string, unknown>,
      after: updated as unknown as Record<string, unknown>,
    });

    return updated;
  }

  async reject(id: number, approverUserId: number, rejectionReason: string): Promise<ChangeRequest> {
    const existing = await this.getById(id);
    if (!existing) throw new Error('Change request not found');
    if (existing.status !== 'pending') {
      throw new Error(`Cannot reject a change request in '${existing.status}' status`);
    }

    await this.pool.execute(
      `UPDATE change_requests
          SET status = 'rejected', approver_user_id = ?, rejected_at = CURRENT_TIMESTAMP,
              rejection_reason = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [approverUserId, rejectionReason, id]
    );

    const updated = await this.getById(id);
    if (!updated) throw new Error('Failed to retrieve updated change request');

    await this.audit.write({
      actorId: approverUserId,
      action: 'change_request.reject',
      entityType: 'change_request',
      entityId: id,
      description: `Change request rejected: ${existing.changeType} — ${rejectionReason}`,
      before: existing as unknown as Record<string, unknown>,
      after: updated as unknown as Record<string, unknown>,
    });

    return updated;
  }

  /**
   * Marks the request as applied and writes a proxy audit log entry.
   *
   * The audit log records:
   *   user_id           = approverUserId (the authority holder who takes responsibility)
   *   on_behalf_of_user_id = proposer (who originally requested the change)
   *
   * This means externally the action appears as if directly decided by the
   * approver; the proposer's identity is preserved for full traceability.
   */
  async apply(id: number, actorUserId: number, justification?: string | null): Promise<ChangeRequest> {
    const existing = await this.getById(id);
    if (!existing) throw new Error('Change request not found');
    if (existing.status !== 'approved') {
      throw new Error(`Cannot apply a change request in '${existing.status}' status — must be approved first`);
    }

    const authorityHolder = existing.approverUserId ?? actorUserId;

    await this.pool.execute(
      `UPDATE change_requests
          SET status = 'applied', applied_at = CURRENT_TIMESTAMP,
              on_behalf_of_user_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [existing.proposerUserId, id]
    );

    const updated = await this.getById(id);
    if (!updated) throw new Error('Failed to retrieve updated change request');

    // Attribution: the authority holder (approver) is the actor; the proposer appears as on_behalf_of.
    await this.audit.write({
      actorId: authorityHolder,
      onBehalfOfUserId: existing.proposerUserId,
      action: 'change_request.apply',
      entityType: existing.targetEntityType,
      entityId: existing.targetEntityId ?? undefined,
      description: `Change applied via request #${id}: ${existing.changeType}`,
      justification: justification ?? undefined,
      before: existing as unknown as Record<string, unknown>,
      after: updated as unknown as Record<string, unknown>,
    });

    logger.info(`Change request applied: id=${id} authority=${authorityHolder} proposer=${existing.proposerUserId}`);
    return updated;
  }

  async cancel(id: number, requestorUserId: number): Promise<ChangeRequest> {
    const existing = await this.getById(id);
    if (!existing) throw new Error('Change request not found');
    if (existing.status !== 'pending') {
      throw new Error(`Cannot cancel a change request in '${existing.status}' status`);
    }

    await this.pool.execute(
      `UPDATE change_requests
          SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [id]
    );

    const updated = await this.getById(id);
    if (!updated) throw new Error('Failed to retrieve updated change request');

    await this.audit.write({
      actorId: requestorUserId,
      action: 'change_request.cancel',
      entityType: 'change_request',
      entityId: id,
      description: `Change request cancelled: ${existing.changeType} on ${existing.targetEntityType}`,
      before: existing as unknown as Record<string, unknown>,
      after: updated as unknown as Record<string, unknown>,
    });

    return updated;
  }

  /**
   * Advances a pending_approval step: mark it approved or rejected, then
   * either open the next step or (when the final step is approved) transition
   * the change_request to 'approved'.  When rejected the change_request is
   * immediately set to 'rejected'.
   *
   * Only the user who is assigned to the step may act on it.
   */
  async advancePendingApproval(
    pendingApprovalId: number,
    userId: number,
    decision: 'approved' | 'rejected',
    note?: string | null
  ): Promise<{ pendingApproval: PendingApproval; changeRequest: ChangeRequest }> {
    const pa = await this.getPendingApprovalById(pendingApprovalId);
    if (!pa) throw new Error('Pending approval not found');
    if (pa.status !== 'pending') throw new Error(`Pending approval is already ${pa.status}`);
    if (pa.assignedToUserId !== userId) throw new Error('Not authorized to act on this pending approval');

    await this.pool.execute(
      `UPDATE pending_approvals
          SET status = ?, decided_at = CURRENT_TIMESTAMP, decision_note = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [decision, note ?? null, pendingApprovalId]
    );

    const cr = await this.getById(pa.changeRequestId);
    if (!cr) throw new Error('Change request not found');

    if (decision === 'rejected') {
      await this.pool.execute(
        `UPDATE change_requests
            SET status = 'rejected', approver_user_id = ?, rejected_at = CURRENT_TIMESTAMP,
                rejection_reason = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [userId, note ?? null, pa.changeRequestId]
      );
      await this.audit.write({
        actorId: userId,
        action: 'change_request.reject',
        entityType: 'change_request',
        entityId: pa.changeRequestId,
        description: `Change request rejected via workflow step ${pa.stepOrder}: ${cr.changeType}`,
        before: cr as unknown as Record<string, unknown>,
      });
    } else {
      // Approved — look for next step in the same workflow.
      const [nextRows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT id, step_order
           FROM approval_steps
          WHERE workflow_id = ? AND step_order > ?
          ORDER BY step_order ASC LIMIT 1`,
        [pa.workflowId, pa.stepOrder]
      );

      if (nextRows.length > 0) {
        const nextStepId = (nextRows[0] as any).id as number;
        const nextStepOrder = (nextRows[0] as any).step_order as number;
        // Resolve proposer context for responsibility-rule-based lookup.
        const proposerCtx = await this.resolveProposerContext(cr.proposerUserId);
        const nextApproverUserId = await this.engine.resolveApproverForStep(nextStepId, {
          actorUserId: userId,
          orgUnitId: proposerCtx.orgUnitId ?? undefined,
          subjectDepartmentIds: proposerCtx.subjectDepartmentIds,
          subjectRoleIds: proposerCtx.subjectRoleIds,
        });
        if (nextApproverUserId !== null) {
          await this.pool.execute(
            `INSERT INTO pending_approvals
               (change_request_id, workflow_id, step_id, step_order, assigned_to_user_id, status)
             VALUES (?, ?, ?, ?, ?, 'pending')`,
            [pa.changeRequestId, pa.workflowId, nextStepId, nextStepOrder, nextApproverUserId]
          );
        }
      } else {
        // No more steps — all approved; transition change_request.
        await this.pool.execute(
          `UPDATE change_requests
              SET status = 'approved', approver_user_id = ?, approved_at = CURRENT_TIMESTAMP,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
          [userId, pa.changeRequestId]
        );
        await this.audit.write({
          actorId: userId,
          action: 'change_request.approve',
          entityType: 'change_request',
          entityId: pa.changeRequestId,
          description: `Change request approved after all workflow steps: ${cr.changeType}`,
          before: cr as unknown as Record<string, unknown>,
        });
      }
    }

    const updatedPa = await this.getPendingApprovalById(pendingApprovalId);
    const updatedCr = await this.getById(pa.changeRequestId);
    return { pendingApproval: updatedPa!, changeRequest: updatedCr! };
  }

  private async getPendingApprovalById(id: number): Promise<PendingApproval | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT * FROM pending_approvals WHERE id = ? LIMIT 1',
      [id]
    );
    if (rows.length === 0) return null;
    const r = rows[0] as any;
    return {
      id: r.id,
      changeRequestId: r.change_request_id,
      workflowId: r.workflow_id,
      stepId: r.step_id,
      stepOrder: r.step_order,
      assignedToUserId: r.assigned_to_user_id,
      status: r.status,
      decidedAt: r.decided_at ?? null,
      decisionNote: r.decision_note ?? null,
      escalatedAt: r.escalated_at ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
}
