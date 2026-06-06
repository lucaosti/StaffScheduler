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

interface ResolveContext {
  orgUnitId?: number;
  policyOwnerId?: number;
  actorUserId: number;
}

interface ResolvedStep {
  step: ApprovalStep;
  approverUserId: number | null;
  autoApprove: boolean;
}

export class ApprovalEngineService {
  constructor(private pool: Pool) {}

  // --------------------------------------------------------------------------
  // Workflow CRUD
  // --------------------------------------------------------------------------

  async listWorkflows(): Promise<ApprovalWorkflow[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT
         w.id, w.change_type, w.require_all, w.description, w.created_at, w.updated_at,
         s.id AS step_id, s.workflow_id AS step_workflow_id, s.step_order,
         s.approver_scope, s.approver_role_id, s.approver_user_id,
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
              auto_approve_for_owner, escalate_after_hours)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            workflowId,
            s.stepOrder,
            s.approverScope,
            s.approverRoleId ?? null,
            s.approverUserId ?? null,
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
                auto_approve_for_owner, escalate_after_hours)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, s.stepOrder, s.approverScope, s.approverRoleId ?? null, s.approverUserId ?? null,
             s.autoApproveForOwner ?? true, s.escalateAfterHours ?? null]
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
   * Finds approval steps whose escalation deadline has passed and logs them.
   * In production this would be called by a scheduler (e.g. a cron job calling
   * POST /api/approval-workflows/process-escalations). Returns the count of
   * escalated items.
   *
   * NOTE: This method identifies overdue workflows but does not itself mutate
   * any `pending_approval` records — the pending-approvals table is outside
   * the current schema scope. It returns which workflows have overdue steps so
   * callers can act accordingly.
   */
  async processEscalations(nowIso?: string): Promise<{ workflowId: number; stepId: number; changeType: string }[]> {
    const now = nowIso ?? new Date().toISOString();
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT aw.id AS workflow_id, ast.id AS step_id, aw.change_type
         FROM approval_workflows aw
         JOIN approval_steps ast ON ast.workflow_id = aw.id
        WHERE ast.escalate_after_hours IS NOT NULL
          AND DATE_ADD(aw.created_at, INTERVAL ast.escalate_after_hours HOUR) < ?
        ORDER BY aw.id ASC, ast.step_order ASC`,
      [now]
    );

    const overdue = rows.map((r: any) => ({
      workflowId: r.workflow_id as number,
      stepId: r.step_id as number,
      changeType: r.change_type as string,
    }));

    if (overdue.length > 0) {
      logger.info(`Escalation check: ${overdue.length} overdue workflow step(s) detected`);
    }

    return overdue;
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
              approver_user_id, auto_approve_for_owner, escalate_after_hours
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
    let current: number | null = orgUnitId;
    const visited = new Set<number>();
    while (current !== null && !visited.has(current)) {
      const cur: number = current;
      visited.add(cur);
      const [chainRows] = await this.pool.execute<RowDataPacket[]>(
        'SELECT manager_user_id, parent_id FROM org_units WHERE id = ? LIMIT 1',
        [cur]
      );
      if (chainRows.length === 0) return null;
      const managerId = chainRows[0].manager_user_id as number | null;
      if (managerId !== null && managerId !== undefined) return managerId;
      current = (chainRows[0].parent_id as number | null) ?? null;
    }
    return null;
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
