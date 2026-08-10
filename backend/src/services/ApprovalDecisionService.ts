/**
 * Approval Decision Service
 *
 * Owns the `pending_approvals` lifecycle: creating a step's approval gate,
 * deciding it (approve/reject, advancing to the next step), the structure
 * head's reassignment actions (keep/delegate/open), reading the decision
 * chain, and escalating overdue decisions. Split out of the former
 * `ApprovalEngineService` — this is the piece that mutates decisions, as
 * opposed to `ApprovalWorkflowService` (configuration) and
 * `ApproverResolutionService` (read-only "who approves this" resolution),
 * which it composes for the parts of pending-approval creation that need
 * scope resolution.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { nextState, actionForDecision } from './ApprovalStateMachine';
import { ApprovalStep, ApproverScope, PendingApproval, DecisionChain } from '../types';
import { logger } from '../config/logger';
import { ApproverResolutionService, ResolveContext } from './ApproverResolutionService';
import { WebhookService } from './WebhookService';

/** Exactly one of these must be set — identifies which entity a pending_approvals row decides on. */
export interface PendingApprovalEntityRef {
  changeRequestId?: number;
  timeOffRequestId?: number;
  employeeLoanId?: number;
  shiftSwapRequestId?: number;
  policyExceptionId?: number;
}

export interface DecidePendingApprovalResult {
  pendingApproval: PendingApproval;
  decision: 'approved' | 'rejected';
  /** True when this was the last step (rejected, or approved with no further step). */
  isFinalStep: boolean;
}

const mapPendingApprovalRow = (r: any): PendingApproval => ({
  id: r.id,
  changeRequestId: r.change_request_id ?? null,
  timeOffRequestId: r.time_off_request_id ?? null,
  employeeLoanId: r.employee_loan_id ?? null,
  shiftSwapRequestId: r.shift_swap_request_id ?? null,
  policyExceptionId: r.policy_exception_id ?? null,
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

export class ApprovalDecisionService {
  private resolution: ApproverResolutionService;
  private webhooks: WebhookService;

  constructor(private pool: Pool) {
    this.resolution = new ApproverResolutionService(pool);
    this.webhooks = new WebhookService(pool);
  }

  async getPendingApprovalById(id: number): Promise<PendingApproval | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT * FROM pending_approvals WHERE id = ? LIMIT 1',
      [id]
    );
    return rows.length === 0 ? null : mapPendingApprovalRow(rows[0]);
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
      if (!ctx.orgUnitId) throw new ConflictError("A 'unit_structure' step requires an org unit context");
      assignedToOrgUnitId = ctx.orgUnitId;
      assignedToUserId = await this.resolution.findUnitManager(ctx.orgUnitId);
    } else {
      assignedToUserId = await this.resolution.resolveStepApprover(step, ctx);
      if (assignedToUserId === null) return null;
    }

    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO pending_approvals
         (change_request_id, time_off_request_id, employee_loan_id, shift_swap_request_id, policy_exception_id,
          workflow_id, step_id, step_order, assigned_to_user_id, assigned_to_org_unit_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        entityRef.changeRequestId ?? null,
        entityRef.timeOffRequestId ?? null,
        entityRef.employeeLoanId ?? null,
        entityRef.shiftSwapRequestId ?? null,
        entityRef.policyExceptionId ?? null,
        workflowId,
        step.id,
        step.stepOrder,
        assignedToUserId,
        assignedToOrgUnitId,
      ]
    );
    return this.getPendingApprovalById(result.insertId);
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
            : pa.policyExceptionId !== null
              ? ['policy_exception_requests', 'requested_by_user_id', pa.policyExceptionId]
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
    if (pa.policyExceptionId !== null) return { policyExceptionId: pa.policyExceptionId };
    throw new ConflictError('Pending approval has no linked entity');
  }

  /**
   * Read-only check for whether approving this pending approval would be
   * the workflow's last step (no mutation — safe to call before doing any
   * entity-specific validation that must not run if a compliance/business
   * check should block the decision from ever committing).
   */
  async wouldBeFinalStep(pendingApprovalId: number): Promise<boolean> {
    const pa = await this.getPendingApprovalById(pendingApprovalId);
    if (!pa) throw new NotFoundError('Pending approval not found');
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
   *
   * `organizationName` is OPTIONAL and deliberately not resolved here via a
   * lookup by `userId` — this method is the one seam all four entity
   * services share, and an unconditional extra query here would land in
   * EVERY test across all four that exercises a decision, whether or not it
   * has anything to do with webhooks (#315). Callers that have the acting
   * user's organization already in hand (every route does, via
   * `req.user.organizationName`) pass it through; omitting it just means no
   * webhook.decided event fires for that decision, not an error.
   */
  async decidePendingApproval(
    pendingApprovalId: number,
    userId: number,
    decision: 'approved' | 'rejected',
    note: string | null,
    resolveNextStepCtx: (pa: PendingApproval) => Promise<ResolveContext>,
    organizationName?: string | null
  ): Promise<DecidePendingApprovalResult> {
    const pa = await this.getPendingApprovalById(pendingApprovalId);
    if (!pa) throw new NotFoundError('Pending approval not found');

    const authorized = await this.isAuthorizedToDecide(pa, userId);
    if (!authorized) throw new ForbiddenError('Not authorized to act on this pending approval');

    // Derive the target status through the state machine — the single authority
    // on legal approval transitions — rather than writing the literal here. A
    // row not in 'pending' cannot be decided (nextState throws), and the
    // WHERE-status guard below is the concurrency backstop for the same rule.
    const targetStatus = nextState('pending', actionForDecision(decision));
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE pending_approvals
          SET status = ?, decided_at = CURRENT_TIMESTAMP, decision_note = ?,
              decided_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'pending'`,
      [targetStatus, note, userId, pendingApprovalId]
    );
    if (result.affectedRows === 0) {
      const current = await this.getPendingApprovalById(pendingApprovalId);
      throw new ConflictError(`Pending approval is already ${current?.status ?? pa.status}`);
    }

    // One event per decision, regardless of entity type (time off, employee
    // loan, shift swap, change request all route through this one method) or
    // whether it's the final step of a multi-step workflow — a webhook
    // subscriber cares that a decision was made, not how many more steps
    // remain. Best-effort, same as ScheduleService/AssignmentService.
    // `organizationName` is caller-supplied (see this method's header) —
    // omitted, dispatch is silently skipped rather than looked up here.
    if (organizationName) {
      this.webhooks
        .dispatch(organizationName, 'approval.decided', {
          pendingApprovalId,
          decision,
          decidedBy: userId,
        })
        .catch((err) => logger.warn('Webhook dispatch failed for approval.decided', { error: err }));
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
    if (pa.assignedToOrgUnitId === null) throw new ValidationError('This decision is not assigned to a structure');
    if (pa.status !== 'pending') throw new ConflictError(`Cannot reassign a decision in '${pa.status}' status`);
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT manager_user_id FROM org_units WHERE id = ? LIMIT 1`,
      [pa.assignedToOrgUnitId]
    );
    const headId = rows.length > 0 ? ((rows[0] as any).manager_user_id as number | null) : null;
    if (headId === null || headId !== headUserId) throw new ForbiddenError('Forbidden');
  }

  /** The structure head explicitly decides to keep the decision themselves. Idempotent. */
  async keepForSelf(pendingApprovalId: number, headUserId: number): Promise<PendingApproval> {
    const pa = await this.getPendingApprovalById(pendingApprovalId);
    if (!pa) throw new NotFoundError('Pending approval not found');
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
      if (result.affectedRows === 0) throw new ConflictError('Cannot reassign a decision that was decided concurrently');
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
    if (!pa) throw new NotFoundError('Pending approval not found');
    await this.requireStructureHead(pa, headUserId);

    const [memberRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT 1 FROM user_org_units WHERE user_id = ? AND org_unit_id = ? LIMIT 1`,
      [targetUserId, pa.assignedToOrgUnitId]
    );
    if (memberRows.length === 0) throw new ValidationError('targetUserId must be a member of the structure');

    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE pending_approvals SET assigned_to_user_id = ?, open_to_structure = FALSE WHERE id = ? AND status = 'pending'`,
      [targetUserId, pendingApprovalId]
    );
    if (result.affectedRows === 0) throw new ConflictError('Cannot reassign a decision that was decided concurrently');
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
    if (!pa) throw new NotFoundError('Pending approval not found');
    await this.requireStructureHead(pa, headUserId);

    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE pending_approvals SET assigned_to_user_id = NULL, open_to_structure = TRUE WHERE id = ? AND status = 'pending'`,
      [pendingApprovalId]
    );
    if (result.affectedRows === 0) throw new ConflictError('Cannot reassign a decision that was decided concurrently');
    await this.pool.execute(
      `INSERT INTO decision_reassignments (pending_approval_id, action, actor_user_id) VALUES (?, 'opened_to_structure', ?)`,
      [pendingApprovalId, headUserId]
    );
    return (await this.getPendingApprovalById(pendingApprovalId))!;
  }

  /** The full chain of command for a decision: structure → head's choice(s) → who decided. */
  async getDecisionChain(pendingApprovalId: number, userId: number): Promise<DecisionChain> {
    const pa = await this.getPendingApprovalById(pendingApprovalId);
    if (!pa) throw new NotFoundError('Pending approval not found');
    if (!(await this.isAuthorizedToViewChain(pa, userId))) {
      throw new ForbiddenError('Forbidden: not authorized to view this decision chain');
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
              pa.shift_swap_request_id, pa.policy_exception_id, pa.workflow_id, pa.step_id, pa.step_order,
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
      if (row.shift_swap_request_id !== null) return { shiftSwapRequestId: row.shift_swap_request_id };
      return { policyExceptionId: row.policy_exception_id };
    };

    const items: Array<{ pendingApprovalId: number; entityRef: PendingApprovalEntityRef; escalatedToUserId: number | null }> =
      rows.map((row) => ({
        pendingApprovalId: row.id as number,
        entityRef: entityRefOf(row),
        escalatedToUserId: (row.manager_id as number | null) ?? null,
      }));

    // Batch UPDATE — mark all overdue items escalated in one statement. The
    // target status comes from the state machine (the single authority on legal
    // transitions) rather than a literal; the WHERE-status guard keeps the same
    // rule under concurrency.
    const escalatedStatus = nextState('pending', 'escalate');
    const paIds = items.map((i) => i.pendingApprovalId);
    const placeholders = paIds.map(() => '?').join(', ');
    await this.pool.execute(
      `UPDATE pending_approvals
          SET status = ?, escalated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id IN (${placeholders}) AND status = 'pending'`,
      [escalatedStatus, ...paIds]
    );

    // Batch INSERT — one row per item that has an identified manager. All
    // four entity FK columns are always included (three NULL, one set) so
    // every row shares the same column list regardless of entity type.
    const escalatable = rows.filter((r) => (r.manager_id as number | null) !== null);
    if (escalatable.length > 0) {
      const insertPlaceholders = escalatable.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, \'pending\')').join(', ');
      const insertValues = escalatable.flatMap((r) => {
        const ref = entityRefOf(r);
        return [
          ref.changeRequestId ?? null,
          ref.timeOffRequestId ?? null,
          ref.employeeLoanId ?? null,
          ref.shiftSwapRequestId ?? null,
          ref.policyExceptionId ?? null,
          r.workflow_id,
          r.step_id,
          r.step_order,
          r.manager_id,
        ];
      });
      await this.pool.execute(
        `INSERT INTO pending_approvals
           (change_request_id, time_off_request_id, employee_loan_id, shift_swap_request_id, policy_exception_id,
            workflow_id, step_id, step_order, assigned_to_user_id, status)
         VALUES ${insertPlaceholders}`,
        insertValues
      );
    }

    logger.info(`Escalation run: ${items.length} pending approval(s) escalated`);
    return { escalated: items.length, items };
  }
}
