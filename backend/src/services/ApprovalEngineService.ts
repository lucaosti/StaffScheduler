/**
 * Approval Engine Service
 *
 * Multi-step approval workflow engine. Each change type (Loan.Request,
 * TimeOff.Request, etc.) maps to an `approval_workflows` row that holds an
 * ordered list of `approval_steps`. The engine resolves the responsible
 * approver for each step and supports automatic step-escalation when
 * `escalate_after_hours` expires.
 *
 * This replaces the single-step `approval_matrix` / `ApprovalMatrixService`
 * for new request types; the legacy table is preserved for backward compat.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import {
  ApprovalWorkflow,
  ApprovalStep,
  ApproverScope,
  CreateApprovalWorkflowRequest,
} from '../types';
import { logger } from '../config/logger';
import { ResponsibilityRuleService } from './ResponsibilityRuleService';

interface ResolveContext {
  orgUnitId?: number;
  policyOwnerId?: number;
  actorUserId: number;
  /** Subject context for responsibility_rule scope. */
  subjectDepartmentIds?: number[];
  subjectRoleIds?: number[];
}

interface ResolvedStep {
  step: ApprovalStep;
  approverUserId: number | null;
  autoApprove: boolean;
}

const MAX_ORG_DEPTH = 20;

export class ApprovalEngineService {
  private responsibilitySvc: ResponsibilityRuleService;

  constructor(private pool: Pool) {
    this.responsibilitySvc = new ResponsibilityRuleService(pool);
  }

  // --------------------------------------------------------------------------
  // Workflow CRUD
  // --------------------------------------------------------------------------

  async listWorkflows(): Promise<ApprovalWorkflow[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT
         w.id, w.change_type, w.require_all, w.description, w.created_at, w.updated_at,
         s.id AS step_id, s.workflow_id AS step_workflow_id, s.step_order,
         s.approver_scope, s.approver_role_id, s.approver_user_id, s.approver_permission_code,
         s.auto_approve_for_owner, s.escalate_after_hours
       FROM approval_workflows w
       LEFT JOIN approval_steps s ON s.workflow_id = w.id
       ORDER BY w.change_type ASC, s.step_order ASC`
    );
    const workflowMap = new Map<number, ApprovalWorkflow>();
    for (const row of rows as any[]) {
      if (!workflowMap.has(row.id)) {
        workflowMap.set(row.id, {
          id: row.id,
          changeType: row.change_type,
          requireAll: Boolean(row.require_all),
          description: row.description ?? null,
          steps: [],
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        });
      }
      if (row.step_id !== null) {
        workflowMap.get(row.id)!.steps.push({
          id: row.step_id,
          workflowId: row.step_workflow_id,
          stepOrder: row.step_order,
          approverScope: row.approver_scope as ApproverScope,
          approverRoleId: row.approver_role_id ?? null,
          approverUserId: row.approver_user_id ?? null,
          approverPermissionCode: row.approver_permission_code ?? null,
          autoApproveForOwner: Boolean(row.auto_approve_for_owner),
          escalateAfterHours: row.escalate_after_hours ?? null,
        });
      }
    }
    return Array.from(workflowMap.values());
  }

  async getWorkflowByChangeType(changeType: string): Promise<ApprovalWorkflow | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id, change_type, require_all, description, created_at, updated_at
         FROM approval_workflows WHERE change_type = ? LIMIT 1`,
      [changeType]
    );
    if (rows.length === 0) return null;
    return this.hydrateWorkflow(rows[0] as any);
  }

  async createWorkflow(input: CreateApprovalWorkflowRequest): Promise<ApprovalWorkflow> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [res] = await connection.execute<ResultSetHeader>(
        `INSERT INTO approval_workflows (change_type, require_all, description) VALUES (?, ?, ?)`,
        [input.changeType, input.requireAll ?? false, input.description ?? null]
      );
      const workflowId = res.insertId;
      for (const s of input.steps) {
        await connection.execute(
          `INSERT INTO approval_steps
             (workflow_id, step_order, approver_scope, approver_role_id, approver_user_id,
              approver_permission_code, auto_approve_for_owner, escalate_after_hours)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            workflowId,
            s.stepOrder,
            s.approverScope,
            s.approverRoleId ?? null,
            s.approverUserId ?? null,
            s.approverPermissionCode ?? null,
            s.autoApproveForOwner ?? true,
            s.escalateAfterHours ?? null,
          ]
        );
      }
      await connection.commit();
      const workflow = await this.getWorkflowById(workflowId);
      if (!workflow) throw new Error('Failed to retrieve created workflow');
      return workflow;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async updateWorkflow(
    id: number,
    patch: { requireAll?: boolean; description?: string; steps?: CreateApprovalWorkflowRequest['steps'] }
  ): Promise<ApprovalWorkflow> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const updates: string[] = [];
      const vals: any[] = [];
      if (patch.requireAll !== undefined) { updates.push('require_all = ?'); vals.push(patch.requireAll); }
      if (patch.description !== undefined) { updates.push('description = ?'); vals.push(patch.description); }
      if (updates.length > 0) {
        vals.push(id);
        await connection.execute(
          `UPDATE approval_workflows SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          vals
        );
      }
      if (patch.steps !== undefined) {
        await connection.execute('DELETE FROM approval_steps WHERE workflow_id = ?', [id]);
        for (const s of patch.steps) {
          await connection.execute(
            `INSERT INTO approval_steps
               (workflow_id, step_order, approver_scope, approver_role_id, approver_user_id,
                approver_permission_code, auto_approve_for_owner, escalate_after_hours)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, s.stepOrder, s.approverScope, s.approverRoleId ?? null, s.approverUserId ?? null,
             s.approverPermissionCode ?? null, s.autoApproveForOwner ?? true, s.escalateAfterHours ?? null]
          );
        }
      }
      await connection.commit();
      const workflow = await this.getWorkflowById(id);
      if (!workflow) throw new Error('Workflow not found');
      return workflow;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async deleteWorkflow(id: number): Promise<void> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT id FROM approval_workflows WHERE id = ? LIMIT 1',
      [id]
    );
    if (rows.length === 0) throw new Error('Workflow not found');
    await this.pool.execute('DELETE FROM approval_workflows WHERE id = ?', [id]);
  }

  // --------------------------------------------------------------------------
  // Step resolution
  // --------------------------------------------------------------------------

  /**
   * For a `responsibility_rule` step, returns all user IDs who hold
   * responsibility (not just the first). Useful for fan-out notifications.
   */
  async resolveAllApproversForStep(step: ApprovalStep, ctx: ResolveContext): Promise<number[]> {
    if (step.approverScope !== 'responsibility_rule') {
      const single = await this.resolveStepApprover(step, ctx);
      return single !== null ? [single] : [];
    }
    if (!step.approverPermissionCode) return [];
    return this.responsibilitySvc.resolveResponsibleUsers({
      permissionCode: step.approverPermissionCode,
      orgUnitId: ctx.orgUnitId ?? null,
      departmentIds: ctx.subjectDepartmentIds ?? [],
      roleIds: ctx.subjectRoleIds ?? [],
    });
  }

  /**
   * Resolves the approver for a single step identified by its DB id.
   * Used by ChangeRequestService to advance multi-step pending_approval chains.
   */
  async resolveApproverForStep(
    stepId: number,
    ctx: {
      actorUserId: number;
      orgUnitId?: number;
      policyOwnerId?: number;
      subjectDepartmentIds?: number[];
      subjectRoleIds?: number[];
    }
  ): Promise<number | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id, workflow_id, step_order, approver_scope, approver_role_id,
              approver_user_id, approver_permission_code, auto_approve_for_owner, escalate_after_hours
         FROM approval_steps WHERE id = ? LIMIT 1`,
      [stepId]
    );
    if (rows.length === 0) return null;
    const r = rows[0] as any;
    const step: ApprovalStep = {
      id: r.id,
      workflowId: r.workflow_id,
      stepOrder: r.step_order,
      approverScope: r.approver_scope as ApproverScope,
      approverRoleId: r.approver_role_id ?? null,
      approverUserId: r.approver_user_id ?? null,
      approverPermissionCode: r.approver_permission_code ?? null,
      autoApproveForOwner: Boolean(r.auto_approve_for_owner),
      escalateAfterHours: r.escalate_after_hours ?? null,
    };
    return this.resolveStepApprover(step, ctx);
  }

  /**
   * Resolves ALL steps for the given change type in order. Returns the first
   * non-auto-approved step as the active approver, or null when every step
   * can auto-approve.
   */
  async resolveApprover(changeType: string, ctx: ResolveContext): Promise<ResolvedStep | null> {
    const workflow = await this.getWorkflowByChangeType(changeType);
    if (!workflow) {
      throw new Error(`No approval workflow configured for change type '${changeType}'`);
    }

    for (const step of workflow.steps) {
      const approverUserId = await this.resolveStepApprover(step, ctx);
      const autoApprove =
        step.autoApproveForOwner &&
        approverUserId !== null &&
        approverUserId === ctx.actorUserId;
      if (!autoApprove) {
        return { step, approverUserId, autoApprove: false };
      }
    }
    return null;
  }

  /**
   * Processes all overdue pending_approvals: marks them as 'escalated' and
   * attempts to find the next approver by walking up the org-unit manager
   * chain from the current assigned-to user. A new pending_approval row is
   * created for the escalated approver when one is found.
   *
   * Returns a summary of each escalated item. Designed to be called from a
   * scheduled job (cron) or a manual POST endpoint.
   */
  async processEscalations(): Promise<{
    escalated: number;
    items: Array<{ pendingApprovalId: number; changeRequestId: number; escalatedToUserId: number | null }>;
  }> {
    // Find all pending approvals whose escalate_after_hours window has expired.
    const [overdueRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT pa.id, pa.change_request_id, pa.workflow_id, pa.step_id, pa.step_order,
              pa.assigned_to_user_id,
              ast.escalate_after_hours,
              u.id AS manager_id
         FROM pending_approvals pa
         JOIN approval_steps ast ON ast.id = pa.step_id
         LEFT JOIN users u ON u.id = (
           SELECT ou.manager_user_id
             FROM user_org_units uou
             JOIN org_units ou ON ou.id = uou.org_unit_id
            WHERE uou.user_id = pa.assigned_to_user_id
              AND ou.manager_user_id IS NOT NULL
              AND ou.manager_user_id != pa.assigned_to_user_id
            ORDER BY ou.id ASC
            LIMIT 1
         )
        WHERE pa.status = 'pending'
          AND ast.escalate_after_hours IS NOT NULL
          AND DATE_ADD(pa.created_at, INTERVAL ast.escalate_after_hours HOUR) < NOW()`,
      []
    );

    const rows = overdueRows as any[];
    if (rows.length === 0) {
      return { escalated: 0, items: [] };
    }

    const items: Array<{ pendingApprovalId: number; changeRequestId: number; escalatedToUserId: number | null }> =
      rows.map((row) => ({
        pendingApprovalId: row.id as number,
        changeRequestId: row.change_request_id as number,
        escalatedToUserId: (row.manager_id as number | null) ?? null,
      }));

    // Batch UPDATE — mark all overdue items escalated in one statement.
    const paIds = items.map((i) => i.pendingApprovalId);
    const placeholders = paIds.map(() => '?').join(', ');
    await this.pool.execute(
      `UPDATE pending_approvals
          SET status = 'escalated', escalated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id IN (${placeholders}) AND status = 'pending'`,
      paIds
    );

    // Batch INSERT — one row per item that has an identified manager.
    const escalatable = rows.filter((r) => (r.manager_id as number | null) !== null);
    if (escalatable.length > 0) {
      const insertPlaceholders = escalatable.map(() => '(?, ?, ?, ?, ?, \'pending\')').join(', ');
      const insertValues = escalatable.flatMap((r) => [
        r.change_request_id,
        r.workflow_id,
        r.step_id,
        r.step_order,
        r.manager_id,
      ]);
      await this.pool.execute(
        `INSERT INTO pending_approvals
           (change_request_id, workflow_id, step_id, step_order, assigned_to_user_id, status)
         VALUES ${insertPlaceholders}`,
        insertValues
      );
    }

    logger.info(`Escalation run: ${items.length} pending approval(s) escalated`);
    return { escalated: items.length, items };
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private async getWorkflowById(id: number): Promise<ApprovalWorkflow | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id, change_type, require_all, description, created_at, updated_at
         FROM approval_workflows WHERE id = ? LIMIT 1`,
      [id]
    );
    if (rows.length === 0) return null;
    return this.hydrateWorkflow(rows[0] as any);
  }

  private async hydrateWorkflow(w: any): Promise<ApprovalWorkflow> {
    const [stepRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id, workflow_id, step_order, approver_scope, approver_role_id,
              approver_user_id, approver_permission_code, auto_approve_for_owner, escalate_after_hours
         FROM approval_steps WHERE workflow_id = ? ORDER BY step_order ASC`,
      [w.id]
    );
    const steps: ApprovalStep[] = (stepRows as any[]).map((s) => ({
      id: s.id,
      workflowId: s.workflow_id,
      stepOrder: s.step_order,
      approverScope: s.approver_scope as ApproverScope,
      approverRoleId: s.approver_role_id ?? null,
      approverUserId: s.approver_user_id ?? null,
      approverPermissionCode: s.approver_permission_code ?? null,
      autoApproveForOwner: Boolean(s.auto_approve_for_owner),
      escalateAfterHours: s.escalate_after_hours ?? null,
    }));
    return {
      id: w.id,
      changeType: w.change_type,
      requireAll: Boolean(w.require_all),
      description: w.description ?? null,
      steps,
      createdAt: w.created_at,
      updatedAt: w.updated_at,
    };
  }

  private async resolveStepApprover(step: ApprovalStep, ctx: ResolveContext): Promise<number | null> {
    switch (step.approverScope as ApproverScope) {
      case 'policy_owner':
        return ctx.policyOwnerId ?? null;
      case 'unit_manager':
        return ctx.orgUnitId ? this.findUnitManager(ctx.orgUnitId) : null;
      case 'unit_manager_chain':
        return ctx.orgUnitId ? this.findUnitManagerChain(ctx.orgUnitId) : null;
      case 'company_role':
        return step.approverRoleId ? this.findFirstActiveByRoleId(step.approverRoleId) : null;
      case 'company_user':
        return step.approverUserId;
      case 'responsibility_rule': {
        if (!step.approverPermissionCode) return null;
        const ids = await this.responsibilitySvc.resolveResponsibleUsers({
          permissionCode: step.approverPermissionCode,
          orgUnitId: ctx.orgUnitId ?? null,
          departmentIds: ctx.subjectDepartmentIds ?? [],
          roleIds: ctx.subjectRoleIds ?? [],
        });
        return ids.length > 0 ? ids[0] : null;
      }
      default:
        return null;
    }
  }

  private async findUnitManager(orgUnitId: number): Promise<number | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT manager_user_id FROM org_units WHERE id = ? LIMIT 1',
      [orgUnitId]
    );
    return rows.length === 0 ? null : ((rows[0].manager_user_id as number | null) ?? null);
  }

  private async findUnitManagerChain(orgUnitId: number): Promise<number | null> {
    // Walk the entire ancestor chain in one recursive CTE query and return the
    // first manager found (closest ancestor with a non-null manager_user_id).
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `WITH RECURSIVE chain AS (
         SELECT id, manager_user_id, parent_id, 0 AS depth
           FROM org_units
          WHERE id = ?
         UNION ALL
         SELECT o.id, o.manager_user_id, o.parent_id, c.depth + 1
           FROM org_units o
           JOIN chain c ON o.id = c.parent_id
          WHERE c.depth < ${MAX_ORG_DEPTH}
       )
       SELECT manager_user_id
         FROM chain
        WHERE manager_user_id IS NOT NULL
        ORDER BY depth ASC
        LIMIT 1`,
      [orgUnitId]
    );
    return rows.length === 0 ? null : (rows[0].manager_user_id as number);
  }

  private async findFirstActiveByRoleId(roleId: number): Promise<number | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT u.id
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
        WHERE ur.role_id = ? AND u.is_active = 1
          AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
        ORDER BY u.id ASC LIMIT 1`,
      [roleId]
    );
    return rows.length === 0 ? null : (rows[0].id as number);
  }
}
