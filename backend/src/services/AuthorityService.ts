/**
 * Who has authority over one person, answered by asking the deciders themselves.
 *
 * THE QUESTION THIS ANSWERS. "Who is my manager, who can change my role, and who
 * decides my requests?" — three questions that were each answerable only by
 * reading code. The authority existed and was correctly enforced; it was simply
 * invisible, so the way to find out who would approve your time off was to file
 * it and see. That is a poor way to learn that nobody would.
 *
 * WHY THIS RESOLVES NOTHING ITSELF. Every name here comes from the component
 * that would actually make the decision: the manager chain from
 * `OrgUnitService`, the approvers from `ApprovalEngineService`'s own
 * `resolveAllApproversForStep`, the responsible parties from
 * `ResponsibilityRuleService`. A panel that re-implemented any of that would be
 * a second, unreviewed copy of the authority model — and the failure mode is
 * the worst kind: a screen that confidently names the wrong approver. When the
 * rules change, this follows, because it is not a description of them.
 *
 * WHY IT REPORTS GAPS RATHER THAN HIDING THEM. A step whose approver resolves to
 * nobody is reported as unresolved, with the scope that failed to resolve. That
 * is the single most useful thing this can surface: an org unit with no manager,
 * or a responsibility rule pointing at an empty unit, means requests of that type
 * silently have no one to decide them. Omitting the row would make a broken
 * configuration look like a complete one.
 *
 * WHY THE SUBJECT CONTEXT IS SHARED WITH THE APPROVAL PATH. Resolving an
 * approver needs the subject's org unit, departments and roles. Building that
 * here independently is how the panel would come to disagree with reality, so it
 * uses the same `resolveSubjectContext` the change-request path uses — which is
 * also how the two came to disagree with EACH OTHER before this change: one read
 * `is_primary`, the other took the lowest `org_unit_id`, so a person with two
 * memberships had their change requests routed against a different unit than
 * their time off. See that function for what it now does.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket } from 'mysql2/promise';
import { ApprovalEngineService } from './ApprovalEngineService';
import { OrgUnitService } from './OrgUnitService';
import { ResponsibilityRuleService } from './ResponsibilityRuleService';
import { resolveSubjectContext } from './subjectContext';
import type { ManagerChainLink } from './OrgUnitService';

/** A person, named enough to be recognised without another request. */
export interface AuthorityPerson {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
}

/** One decision step, and who would take it for this subject. */
export interface AuthorityApprovalStep {
  stepOrder: number;
  /** How the approver is chosen — `unit_manager`, `responsibility_rule`, … */
  approverScope: string;
  /** The permission a `responsibility_rule` step resolves through, if any. */
  permissionCode: string | null;
  approvers: AuthorityPerson[];
  /**
   * True when the scope resolved to nobody. Reported rather than dropped: a
   * request of this type currently has no one who can decide it.
   */
  unresolved: boolean;
}

export interface AuthorityWorkflow {
  changeType: string;
  description: string | null;
  steps: AuthorityApprovalStep[];
}

export interface AuthorityProfile {
  subject: AuthorityPerson;
  /** Superiors, nearest first, from the subject's own unit upward. */
  managerChain: ManagerChainLink[];
  /** Who may grant or revoke this person's roles, and on what basis. */
  roleAdministrators: Array<AuthorityPerson & { via: 'responsibility_rule' | 'permission' }>;
  /** What would happen to each kind of request this person can file. */
  approvals: AuthorityWorkflow[];
}

/** The permission that gates granting and revoking roles — see routes/rbac. */
const ROLE_ADMIN_PERMISSION = 'role.manage';

export class AuthorityService {
  private readonly units: OrgUnitService;
  private readonly approvals: ApprovalEngineService;
  private readonly responsibility: ResponsibilityRuleService;

  constructor(private readonly pool: Pool) {
    this.units = new OrgUnitService(pool);
    this.responsibility = new ResponsibilityRuleService(pool);
    this.approvals = new ApprovalEngineService(pool);
  }

  /** Names for a set of ids, in one query, preserving nothing about order. */
  private async hydrate(ids: number[]): Promise<Map<number, AuthorityPerson>> {
    const unique = [...new Set(ids)].filter((id) => Number.isInteger(id) && id > 0);
    if (unique.length === 0) return new Map();
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT id, first_name, last_name, email FROM users WHERE id IN (${unique.map(() => '?').join(',')})`,
      unique
    );
    return new Map(
      rows.map((r) => [
        r.id as number,
        {
          id: r.id as number,
          firstName: r.first_name as string,
          lastName: r.last_name as string,
          email: r.email as string,
        },
      ])
    );
  }

  /**
   * Who can change this person's roles.
   *
   * Two sources, kept distinguishable rather than merged. A responsibility rule
   * is a scoped, deliberate assignment — "this unit administers that one" — and
   * is the answer someone is usually looking for. A plain `role.manage` holder
   * can do it because they can do it everywhere, which is a true but different
   * statement, and flattening the two would hide which of them is the intended
   * route. Both are labelled with `via`.
   */
  private async roleAdministrators(
    userId: number,
    ctx: { orgUnitId: number | null; subjectDepartmentIds: number[]; subjectRoleIds: number[] }
  ): Promise<AuthorityProfile['roleAdministrators']> {
    const responsible = await this.responsibility.resolveResponsibleUsers({
      permissionCode: ROLE_ADMIN_PERMISSION,
      orgUnitId: ctx.orgUnitId,
      departmentIds: ctx.subjectDepartmentIds,
      roleIds: ctx.subjectRoleIds,
    });

    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT DISTINCT ur.user_id
         FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id
         JOIN users u ON u.id = ur.user_id AND u.is_active = TRUE
        WHERE p.code = ?
          AND (ur.expires_at IS NULL OR ur.expires_at > NOW())`,
      [ROLE_ADMIN_PERMISSION]
    );
    const holders = rows.map((r) => r.user_id as number);

    const people = await this.hydrate([...responsible, ...holders]);
    const seen = new Set<number>();
    const out: AuthorityProfile['roleAdministrators'] = [];

    // Responsibility rules first, and a person named by both appears once, as
    // the more specific of the two.
    for (const [ids, via] of [
      [responsible, 'responsibility_rule'] as const,
      [holders, 'permission'] as const,
    ]) {
      for (const id of ids) {
        // Someone administering their own roles is not an answer to "who can
        // change my role" — it is the question restated.
        if (id === userId || seen.has(id)) continue;
        const person = people.get(id);
        if (!person) continue;
        seen.add(id);
        out.push({ ...person, via });
      }
    }
    return out;
  }

  /** What would happen to each kind of request this person can file. */
  private async approvalRoutes(
    userId: number,
    ctx: { orgUnitId: number | null; subjectDepartmentIds: number[]; subjectRoleIds: number[] }
  ): Promise<AuthorityWorkflow[]> {
    const workflows = await this.approvals.listWorkflows();
    const resolveCtx = {
      actorUserId: userId,
      ...(ctx.orgUnitId !== null ? { orgUnitId: ctx.orgUnitId } : {}),
      subjectDepartmentIds: ctx.subjectDepartmentIds,
      subjectRoleIds: ctx.subjectRoleIds,
    };

    const out: AuthorityWorkflow[] = [];
    for (const workflow of workflows) {
      const steps: AuthorityApprovalStep[] = [];
      for (const step of workflow.steps) {
        // The engine's own resolution, not a copy of it. `resolveAllApprovers`
        // rather than the single-approver form because a responsibility rule can
        // name several and "either of these two" is the honest answer.
        const ids = await this.approvals.resolveAllApproversForStep(step, resolveCtx);
        const people = await this.hydrate(ids);
        steps.push({
          stepOrder: step.stepOrder,
          approverScope: step.approverScope,
          permissionCode: step.approverPermissionCode ?? null,
          approvers: ids.map((id) => people.get(id)).filter((p): p is AuthorityPerson => Boolean(p)),
          unresolved: ids.length === 0,
        });
      }
      out.push({
        changeType: workflow.changeType,
        description: workflow.description ?? null,
        steps: steps.sort((a, b) => a.stepOrder - b.stepOrder),
      });
    }
    return out;
  }

  async getAuthorityProfile(userId: number): Promise<AuthorityProfile | null> {
    const people = await this.hydrate([userId]);
    const subject = people.get(userId);
    if (!subject) return null;

    const ctx = await resolveSubjectContext(this.pool, userId);
    const [managerChain, roleAdministrators, approvals] = await Promise.all([
      this.units.getManagerChain(userId),
      this.roleAdministrators(userId, ctx),
      this.approvalRoutes(userId, ctx),
    ]);

    return { subject, managerChain, roleAdministrators, approvals };
  }
}
