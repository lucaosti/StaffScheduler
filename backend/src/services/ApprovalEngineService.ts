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
  PendingApproval,
  DecisionChain,
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

/** Exactly one of these must be set — identifies which entity a pending_approvals row decides on. */
export interface PendingApprovalEntityRef {
  changeRequestId?: number;
  timeOffRequestId?: number;
  employeeLoanId?: number;
  shiftSwapRequestId?: number;
}

export interface DecidePendingApprovalResult {
  pendingApproval: PendingApproval;
  decision: 'approved' | 'rejected';
  /** True when this was the last step (rejected, or approved with no further step). */
  isFinalStep: boolean;
}

const MAX_ORG_DEPTH = 20;

const mapPendingApprovalRow = (r: any): PendingApproval => ({
  id: r.id,
  changeRequestId: r.change_request_id ?? null,
  timeOffRequestId: r.time_off_request_id ?? null,
  employeeLoanId: r.employee_loan_id ?? null,
  shiftSwapRequestId: r.shift_swap_request_id ?? null,
  workflowId: r.workflow_id,
  stepId: r.step_id,
  stepOrder: r.step_order,
  assignedToUserId: r.assigned_to_user_id ?? null,
  assignedToOrgUnitId: r.assigned_to_org_unit_id ?? null,
  openToStructure: Boolean(r.open_to_structure),
  decidedByUserId: r.decided_by_user_id ?? null,
  status: r.status,
  decidedAt: r.decided_at ?? null,
  decisionNote: r.decision_note ?? null,
  escalatedAt: r.escalated_at ?? null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

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

  // --------------------------------------------------------------------------
  // Generic pending_approval lifecycle — shared by change requests, time-off,
  // loans, and shift swaps (the four entity types a pending_approvals row can
  // decide on; see PendingApprovalEntityRef).
  // --------------------------------------------------------------------------

  async getPendingApprovalById(id: number): Promise<PendingApproval | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT * FROM pending_approvals WHERE id = ? LIMIT 1',
      [id]
    );
    return rows.length === 0 ? null : mapPendingApprovalRow(rows[0]);
  }

  /**
   * True when `createPendingApprovalForStep` for this step/context would
   * attach an approver. Callers use it BEFORE inserting their entity row so
   * a request whose configured workflow cannot be satisfied (e.g. the
   * requester has no primary org unit for a unit-scoped step) is rejected
   * loudly at creation time instead of being inserted and then silently
   * stranded forever with no approval gate anyone could ever decide.
   */
  async canCreatePendingApprovalForStep(step: ApprovalStep, ctx: ResolveContext): Promise<boolean> {
    if (step.approverScope === 'unit_structure') {
      return ctx.orgUnitId !== undefined && ctx.orgUnitId !== null;
    }
    return (await this.resolveStepApprover(step, ctx)) !== null;
  }

  /**
   * Creates the pending_approvals row for one step of a workflow, for
   * whichever entity type `entityRef` identifies. When the step's scope is
   * `unit_structure`, assigns the decision to the org unit as a whole
   * (defaulting `assigned_to_user_id` to that unit's head so it's
   * immediately actionable without requiring an explicit "keep" action).
   * Otherwise resolves a single person exactly as `resolveStepApprover` does.
   * Returns null when a person-scoped step resolves to nobody (caller should
   * skip creating an approval gate in that case, matching existing behavior).
   */
  async createPendingApprovalForStep(
    workflowId: number,
    step: ApprovalStep,
    entityRef: PendingApprovalEntityRef,
    ctx: ResolveContext
  ): Promise<PendingApproval | null> {
    let assignedToUserId: number | null;
    let assignedToOrgUnitId: number | null = null;

    if (step.approverScope === 'unit_structure') {
      if (!ctx.orgUnitId) throw new Error("A 'unit_structure' step requires an org unit context");
      assignedToOrgUnitId = ctx.orgUnitId;
      assignedToUserId = await this.findUnitManager(ctx.orgUnitId);
    } else {
      assignedToUserId = await this.resolveStepApprover(step, ctx);
      if (assignedToUserId === null) return null;
    }

    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO pending_approvals
         (change_request_id, time_off_request_id, employee_loan_id, shift_swap_request_id,
          workflow_id, step_id, step_order, assigned_to_user_id, assigned_to_org_unit_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        entityRef.changeRequestId ?? null,
        entityRef.timeOffRequestId ?? null,
        entityRef.employeeLoanId ?? null,
        entityRef.shiftSwapRequestId ?? null,
        workflowId,
        step.id,
        step.stepOrder,
        assignedToUserId,
        assignedToOrgUnitId,
      ]
    );
    return this.getPendingApprovalById(result.insertId);
  }

  /** Primary org-unit membership for a user — used to resolve context for time-off/shift-swap decisions. */
  async resolvePrimaryOrgUnitForUser(userId: number): Promise<number | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT org_unit_id FROM user_org_units WHERE user_id = ? AND is_primary = 1 LIMIT 1`,
      [userId]
    );
    return rows.length === 0 ? null : ((rows[0] as any).org_unit_id as number);
  }

  private async isAuthorizedToDecide(pa: PendingApproval, userId: number): Promise<boolean> {
    if (pa.assignedToUserId === userId) return true;
    if (pa.openToStructure && pa.assignedToOrgUnitId !== null) {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT 1 FROM user_org_units WHERE user_id = ? AND org_unit_id = ? LIMIT 1`,
        [userId, pa.assignedToOrgUnitId]
      );
      return rows.length > 0;
    }
    return false;
  }

  /** The user who originally filed the entity this pending approval decides. */
  private async getProposerUserId(pa: PendingApproval): Promise<number | null> {
    const [table, column, id]: [string, string, number | null] =
      pa.timeOffRequestId !== null
        ? ['time_off_requests', 'user_id', pa.timeOffRequestId]
        : pa.employeeLoanId !== null
          ? ['employee_loans', 'user_id', pa.employeeLoanId]
          : pa.shiftSwapRequestId !== null
            ? ['shift_swap_requests', 'requester_user_id', pa.shiftSwapRequestId]
            : ['change_requests', 'proposer_user_id', pa.changeRequestId];
    if (id === null) return null;
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT ${column} AS proposer_user_id FROM ${table} WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows.length > 0 ? ((rows[0] as any).proposer_user_id as number) : null;
  }

  /**
   * Who may see a decision's chain of command: broader than who may decide
   * it — the proposer, the current assignee, whoever already decided it, and
   * (unlike isAuthorizedToDecide) every member of the assigned structure
   * regardless of whether it has been opened to the whole team yet, since
   * "who is this decision with" is exactly what an affected team member
   * needs to see.
   */
  private async isAuthorizedToViewChain(pa: PendingApproval, userId: number): Promise<boolean> {
    if (pa.assignedToUserId === userId || pa.decidedByUserId === userId) return true;
    if (pa.assignedToOrgUnitId !== null) {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT 1 FROM user_org_units WHERE user_id = ? AND org_unit_id = ? LIMIT 1`,
        [userId, pa.assignedToOrgUnitId]
      );
      if (rows.length > 0) return true;
    }
    return (await this.getProposerUserId(pa)) === userId;
  }

  private entityRefFromPendingApproval(pa: PendingApproval): PendingApprovalEntityRef {
    if (pa.changeRequestId !== null) return { changeRequestId: pa.changeRequestId };
    if (pa.timeOffRequestId !== null) return { timeOffRequestId: pa.timeOffRequestId };
    if (pa.employeeLoanId !== null) return { employeeLoanId: pa.employeeLoanId };
    if (pa.shiftSwapRequestId !== null) return { shiftSwapRequestId: pa.shiftSwapRequestId };
    throw new Error('Pending approval has no linked entity');
  }

  /**
   * Read-only check for whether approving this pending approval would be
   * the workflow's last step (no mutation — safe to call before doing any
   * entity-specific validation that must not run if a compliance/business
   * check should block the decision from ever committing).
   */
  async wouldBeFinalStep(pendingApprovalId: number): Promise<boolean> {
    const pa = await this.getPendingApprovalById(pendingApprovalId);
    if (!pa) throw new Error('Pending approval not found');
    const [nextRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id FROM approval_steps WHERE workflow_id = ? AND step_order > ? ORDER BY step_order ASC LIMIT 1`,
      [pa.workflowId, pa.stepOrder]
    );
    return nextRows.length === 0;
  }

  /**
   * Decides a pending_approvals row: authorizes the caller (either the
   * current assignee, or any member of the structure when opened), guards
   * the status transition against a race the same way
   * AssignmentOrchestrator/ChangeRequestService already do (WHERE
   * status='pending' on the UPDATE itself), and — on approval — advances to
   * the workflow's next step if one exists. Callers (TimeOffService,
   * EmployeeLoanService, ShiftSwapService, ChangeRequestService) apply their
   * own entity-specific side effects only when `isFinalStep` is true.
   *
   * `resolveNextStepCtx` supplies the ResolveContext for the next step, if
   * any — entity-specific (e.g. re-deriving the proposer's org unit).
   */
  async decidePendingApproval(
    pendingApprovalId: number,
    userId: number,
    decision: 'approved' | 'rejected',
    note: string | null,
    resolveNextStepCtx: (pa: PendingApproval) => Promise<ResolveContext>
  ): Promise<DecidePendingApprovalResult> {
    const pa = await this.getPendingApprovalById(pendingApprovalId);
    if (!pa) throw new Error('Pending approval not found');

    const authorized = await this.isAuthorizedToDecide(pa, userId);
    if (!authorized) throw new Error('Not authorized to act on this pending approval');

    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE pending_approvals
          SET status = ?, decided_at = CURRENT_TIMESTAMP, decision_note = ?,
              decided_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'pending'`,
      [decision, note, userId, pendingApprovalId]
    );
    if (result.affectedRows === 0) {
      const current = await this.getPendingApprovalById(pendingApprovalId);
      throw new Error(`Pending approval is already ${current?.status ?? pa.status}`);
    }

    if (decision === 'rejected') {
      const updated = await this.getPendingApprovalById(pendingApprovalId);
      return { pendingApproval: updated!, decision: 'rejected', isFinalStep: true };
    }

    const [nextRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id, workflow_id, step_order, approver_scope, approver_role_id,
              approver_user_id, approver_permission_code, auto_approve_for_owner, escalate_after_hours
         FROM approval_steps WHERE workflow_id = ? AND step_order > ? ORDER BY step_order ASC LIMIT 1`,
      [pa.workflowId, pa.stepOrder]
    );
    if (nextRows.length === 0) {
      const updated = await this.getPendingApprovalById(pendingApprovalId);
      return { pendingApproval: updated!, decision: 'approved', isFinalStep: true };
    }

    const r = nextRows[0] as any;
    const nextStep: ApprovalStep = {
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
    const nextCtx = await resolveNextStepCtx(pa);
    await this.createPendingApprovalForStep(pa.workflowId, nextStep, this.entityRefFromPendingApproval(pa), nextCtx);
    const updated = await this.getPendingApprovalById(pendingApprovalId);
    return { pendingApproval: updated!, decision: 'approved', isFinalStep: false };
  }

  /** Verifies `headUserId` really is the head of the structure this decision is assigned to. */
  private async requireStructureHead(pa: PendingApproval, headUserId: number): Promise<void> {
    if (pa.assignedToOrgUnitId === null) throw new Error('This decision is not assigned to a structure');
    if (pa.status !== 'pending') throw new Error(`Cannot reassign a decision in '${pa.status}' status`);
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT manager_user_id FROM org_units WHERE id = ? LIMIT 1`,
      [pa.assignedToOrgUnitId]
    );
    const headId = rows.length > 0 ? ((rows[0] as any).manager_user_id as number | null) : null;
    if (headId === null || headId !== headUserId) throw new Error('Forbidden');
  }

  /** The structure head explicitly decides to keep the decision themselves. Idempotent. */
  async keepForSelf(pendingApprovalId: number, headUserId: number): Promise<PendingApproval> {
    const pa = await this.getPendingApprovalById(pendingApprovalId);
    if (!pa) throw new Error('Pending approval not found');
    await this.requireStructureHead(pa, headUserId);

    const [existing] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id FROM decision_reassignments WHERE pending_approval_id = ? LIMIT 1`,
      [pendingApprovalId]
    );
    if (existing.length === 0) {
      const [result] = await this.pool.execute<ResultSetHeader>(
        `UPDATE pending_approvals SET assigned_to_user_id = ?, open_to_structure = FALSE WHERE id = ? AND status = 'pending'`,
        [headUserId, pendingApprovalId]
      );
      if (result.affectedRows === 0) throw new Error('Cannot reassign a decision that was decided concurrently');
      await this.pool.execute(
        `INSERT INTO decision_reassignments (pending_approval_id, action, actor_user_id) VALUES (?, 'kept', ?)`,
        [pendingApprovalId, headUserId]
      );
    }
    return (await this.getPendingApprovalById(pendingApprovalId))!;
  }

  /** The structure head delegates the decision to one specific member of their team. */
  async delegateToPerson(pendingApprovalId: number, headUserId: number, targetUserId: number): Promise<PendingApproval> {
    const pa = await this.getPendingApprovalById(pendingApprovalId);
    if (!pa) throw new Error('Pending approval not found');
    await this.requireStructureHead(pa, headUserId);

    const [memberRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT 1 FROM user_org_units WHERE user_id = ? AND org_unit_id = ? LIMIT 1`,
      [targetUserId, pa.assignedToOrgUnitId]
    );
    if (memberRows.length === 0) throw new Error('targetUserId must be a member of the structure');

    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE pending_approvals SET assigned_to_user_id = ?, open_to_structure = FALSE WHERE id = ? AND status = 'pending'`,
      [targetUserId, pendingApprovalId]
    );
    if (result.affectedRows === 0) throw new Error('Cannot reassign a decision that was decided concurrently');
    await this.pool.execute(
      `INSERT INTO decision_reassignments (pending_approval_id, action, actor_user_id, target_user_id)
       VALUES (?, 'delegated_to_person', ?, ?)`,
      [pendingApprovalId, headUserId, targetUserId]
    );
    return (await this.getPendingApprovalById(pendingApprovalId))!;
  }

  /** The structure head opens the decision to anyone in their team. */
  async openToStructure(pendingApprovalId: number, headUserId: number): Promise<PendingApproval> {
    const pa = await this.getPendingApprovalById(pendingApprovalId);
    if (!pa) throw new Error('Pending approval not found');
    await this.requireStructureHead(pa, headUserId);

    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE pending_approvals SET assigned_to_user_id = NULL, open_to_structure = TRUE WHERE id = ? AND status = 'pending'`,
      [pendingApprovalId]
    );
    if (result.affectedRows === 0) throw new Error('Cannot reassign a decision that was decided concurrently');
    await this.pool.execute(
      `INSERT INTO decision_reassignments (pending_approval_id, action, actor_user_id) VALUES (?, 'opened_to_structure', ?)`,
      [pendingApprovalId, headUserId]
    );
    return (await this.getPendingApprovalById(pendingApprovalId))!;
  }

  /** The full chain of command for a decision: structure → head's choice(s) → who decided. */
  async getDecisionChain(pendingApprovalId: number, userId: number): Promise<DecisionChain> {
    const pa = await this.getPendingApprovalById(pendingApprovalId);
    if (!pa) throw new Error('Pending approval not found');
    if (!(await this.isAuthorizedToViewChain(pa, userId))) {
      throw new Error('Forbidden: not authorized to view this decision chain');
    }

    let assignedToOrgUnit: DecisionChain['assignedToOrgUnit'] = null;
    if (pa.assignedToOrgUnitId !== null) {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT ou.id, ou.name, ou.manager_user_id,
                CONCAT(u.first_name, ' ', u.last_name) AS head_name
           FROM org_units ou
           LEFT JOIN users u ON u.id = ou.manager_user_id
          WHERE ou.id = ? LIMIT 1`,
        [pa.assignedToOrgUnitId]
      );
      if (rows.length > 0) {
        const r = rows[0] as any;
        assignedToOrgUnit = {
          id: r.id,
          name: r.name,
          headUserId: r.manager_user_id ?? null,
          headName: r.head_name ?? null,
        };
      }
    }

    const [reassignRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT dr.id, dr.pending_approval_id, dr.action, dr.actor_user_id, dr.target_user_id, dr.created_at,
              CONCAT(au.first_name, ' ', au.last_name) AS actor_name,
              CONCAT(tu.first_name, ' ', tu.last_name) AS target_name
         FROM decision_reassignments dr
         JOIN users au ON au.id = dr.actor_user_id
         LEFT JOIN users tu ON tu.id = dr.target_user_id
        WHERE dr.pending_approval_id = ?
        ORDER BY dr.created_at ASC`,
      [pendingApprovalId]
    );
    const reassignments = (reassignRows as any[]).map((r) => ({
      id: r.id,
      pendingApprovalId: r.pending_approval_id,
      action: r.action,
      actorUserId: r.actor_user_id,
      targetUserId: r.target_user_id ?? null,
      createdAt: r.created_at,
      actorName: r.actor_name,
      targetName: r.target_name ?? null,
    }));

    let decidedByName: string | null = null;
    if (pa.decidedByUserId !== null) {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT CONCAT(first_name, ' ', last_name) AS name FROM users WHERE id = ? LIMIT 1`,
        [pa.decidedByUserId]
      );
      decidedByName = rows.length > 0 ? ((rows[0] as any).name as string) : null;
    }

    return {
      pendingApprovalId,
      status: pa.status,
      assignedToOrgUnit,
      reassignments,
      currentAssigneeUserId: pa.assignedToUserId,
      openToStructure: pa.openToStructure,
      decidedByUserId: pa.decidedByUserId,
      decidedByName,
    };
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
    items: Array<{ pendingApprovalId: number; entityRef: PendingApprovalEntityRef; escalatedToUserId: number | null }>;
  }> {
    // Find all pending approvals whose escalate_after_hours window has expired.
    // Selects all four entity FKs (not just change_request_id) since
    // pending_approvals covers time-off/loan/shift-swap too, not only
    // change requests.
    const [overdueRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT pa.id, pa.change_request_id, pa.time_off_request_id, pa.employee_loan_id,
              pa.shift_swap_request_id, pa.workflow_id, pa.step_id, pa.step_order,
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

    const entityRefOf = (row: any): PendingApprovalEntityRef => {
      if (row.change_request_id !== null) return { changeRequestId: row.change_request_id };
      if (row.time_off_request_id !== null) return { timeOffRequestId: row.time_off_request_id };
      if (row.employee_loan_id !== null) return { employeeLoanId: row.employee_loan_id };
      return { shiftSwapRequestId: row.shift_swap_request_id };
    };

    const items: Array<{ pendingApprovalId: number; entityRef: PendingApprovalEntityRef; escalatedToUserId: number | null }> =
      rows.map((row) => ({
        pendingApprovalId: row.id as number,
        entityRef: entityRefOf(row),
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

    // Batch INSERT — one row per item that has an identified manager. All
    // four entity FK columns are always included (three NULL, one set) so
    // every row shares the same column list regardless of entity type.
    const escalatable = rows.filter((r) => (r.manager_id as number | null) !== null);
    if (escalatable.length > 0) {
      const insertPlaceholders = escalatable.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, \'pending\')').join(', ');
      const insertValues = escalatable.flatMap((r) => {
        const ref = entityRefOf(r);
        return [
          ref.changeRequestId ?? null,
          ref.timeOffRequestId ?? null,
          ref.employeeLoanId ?? null,
          ref.shiftSwapRequestId ?? null,
          r.workflow_id,
          r.step_id,
          r.step_order,
          r.manager_id,
        ];
      });
      await this.pool.execute(
        `INSERT INTO pending_approvals
           (change_request_id, time_off_request_id, employee_loan_id, shift_swap_request_id,
            workflow_id, step_id, step_order, assigned_to_user_id, status)
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
