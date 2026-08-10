/**
 * Approver Resolution Service
 *
 * Resolves WHO must approve a given step, for every `ApproverScope` the
 * schema defines (policy_owner, unit_manager, unit_manager_chain,
 * company_role, company_user, responsibility_rule, unit_structure). Split
 * out of the former `ApprovalEngineService` — this is the piece with no
 * knowledge of workflow storage or pending-approval rows, only "given this
 * step and this context, who is the approver".
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket } from 'mysql2/promise';
import { ConflictError } from '../errors';
import { ApprovalWorkflow, ApprovalStep, ApproverScope } from '../types';
import { ResponsibilityRuleService } from './ResponsibilityRuleService';
import { ApprovalWorkflowService } from './ApprovalWorkflowService';

export interface ResolveContext {
  orgUnitId?: number;
  policyOwnerId?: number;
  actorUserId: number;
  /** Subject context for responsibility_rule scope. */
  subjectDepartmentIds?: number[];
  subjectRoleIds?: number[];
}

export interface ResolvedStep {
  step: ApprovalStep;
  approverUserId: number | null;
  autoApprove: boolean;
}

const MAX_ORG_DEPTH = 20;

export class ApproverResolutionService {
  private responsibilitySvc: ResponsibilityRuleService;
  private workflows: ApprovalWorkflowService;

  constructor(private pool: Pool) {
    this.responsibilitySvc = new ResponsibilityRuleService(pool);
    this.workflows = new ApprovalWorkflowService(pool);
  }

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
    const workflow = await this.workflows.getWorkflowByChangeType(changeType);
    if (!workflow) {
      throw new ConflictError(`No approval workflow configured for change type '${changeType}'`);
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
   * Resolves whether `changeType`'s FIRST step would auto-approve for this
   * actor, and who the resolved approver is either way — the same question
   * `ApprovalMatrixService.resolve()` answers, sourced from the workflow the
   * request is about to be attached to instead of a second, parallel
   * configuration table. Unlike `resolveApprover` (which walks past
   * every auto-approving step and returns `null` once everything auto-approves,
   * discarding who each step resolved to along the way), this is specifically
   * for a caller that is about to INSERT its entity and needs to know, for
   * the one step it will actually attach, both facts at once: does this
   * auto-approve, and who is `approver_user_id`/`reviewer_user_id` either way.
   * Returns the workflow too, so a caller that needs it next (to attach the
   * pending-approval step when this does NOT auto-approve) does not re-fetch it.
   */
  async resolveFirstStepAutoApprove(
    changeType: string,
    ctx: ResolveContext
  ): Promise<{ workflow: ApprovalWorkflow; approverUserId: number | null; autoApprove: boolean }> {
    const workflow = await this.workflows.getWorkflowByChangeType(changeType);
    if (!workflow || workflow.steps.length === 0) {
      throw new ConflictError(`No approval workflow configured for change type '${changeType}'`);
    }
    const step = workflow.steps[0];
    const approverUserId = await this.resolveStepApprover(step, ctx);
    const autoApprove =
      step.autoApproveForOwner && approverUserId !== null && approverUserId === ctx.actorUserId;
    return { workflow, approverUserId, autoApprove };
  }

  /**
   * True when creating a pending_approval for this step/context would
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

  /** Primary org-unit membership for a user — used to resolve context for time-off/shift-swap decisions. */
  async resolvePrimaryOrgUnitForUser(userId: number): Promise<number | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT org_unit_id FROM user_org_units WHERE user_id = ? AND is_primary = 1 LIMIT 1`,
      [userId]
    );
    return rows.length === 0 ? null : ((rows[0] as any).org_unit_id as number);
  }

  /**
   * The manager of one org unit — exposed (not private) because
   * `ApprovalDecisionService.createPendingApprovalForStep` needs it directly
   * for the `unit_structure` scope, which assigns to the org unit as a
   * whole and defaults `assigned_to_user_id` to its head.
   */
  async findUnitManager(orgUnitId: number): Promise<number | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT manager_user_id FROM org_units WHERE id = ? LIMIT 1',
      [orgUnitId]
    );
    return rows.length === 0 ? null : ((rows[0].manager_user_id as number | null) ?? null);
  }

  /**
   * Resolves the approver for one step given its scope, exposed (not
   * private) for the same reason as `findUnitManager` — used directly by
   * `ApprovalDecisionService.createPendingApprovalForStep`, which already
   * has an `ApprovalStep` in hand and needs the same resolution this class's
   * other public methods perform internally.
   */
  async resolveStepApprover(step: ApprovalStep, ctx: ResolveContext): Promise<number | null> {
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
