/**
 * Policy validator.
 *
 * Evaluates the active policies that apply to a target (assignment, schedule,
 * shift template) and reports blocking violations. The validator does *not*
 * mutate state; it returns a structured report that callers (UI, scheduling
 * engine) can use to either:
 *   - block the operation outright, or
 *   - prompt the user to file a `PolicyExceptionRequest`.
 *
 * Supported `policy_key`s:
 *   - `min_rest_hours`        -> { hours: number }
 *   - `max_hours_week`        -> { hours: number }
 *   - `max_consecutive_days`  -> { days: number }
 *   - `staffing_min`          -> { staff: number }
 *   - `skill_required`        -> { skillIds: number[] }
 *   - `manual_assignment_locked` -> {}
 *
 * Unknown keys are ignored (forward-compatible).
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket } from 'mysql2/promise';
import { PolicyService, Policy } from './PolicyService';
import { PolicyExceptionService } from './PolicyExceptionService';

interface PolicyViolation {
  policyId: number;
  policyKey: string;
  scopeType: Policy['scopeType'];
  scopeId: number | null;
  message: string;
  /** True when an approved exception covers this (target_type, target_id). */
  hasApprovedException: boolean;
  imposedByUserId: number;
}

interface ValidateAssignmentInput {
  userId: number;
  shiftId: number;
}

interface ValidateAssignmentResult {
  ok: boolean;
  violations: PolicyViolation[];
}

export class PolicyValidator {
  private policies: PolicyService;
  private exceptions: PolicyExceptionService;

  constructor(private pool: Pool) {
    this.policies = new PolicyService(pool);
    this.exceptions = new PolicyExceptionService(pool);
  }

  async validateAssignment(input: ValidateAssignmentInput): Promise<ValidateAssignmentResult> {
    const [shiftRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT s.id, s.schedule_id, s.template_id, s.department_id, s.date,
              s.start_time, s.end_time
         FROM shifts s
        WHERE s.id = ? LIMIT 1`,
      [input.shiftId]
    );
    if (shiftRows.length === 0) throw new Error('Shift not found');
    const shift = shiftRows[0];

    // Map department -> primary org_unit (1:1 if seeded that way).
    const [orgRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT uou.org_unit_id
         FROM user_org_units uou
        WHERE uou.user_id = ?`,
      [input.userId]
    );
    const userOrgUnitIds = orgRows.map((r) => r.org_unit_id as number);

    const applicable = await this.policies.listApplicable({
      orgUnitId: userOrgUnitIds[0] ?? null,
      scheduleId: (shift.schedule_id as number | null) ?? null,
      shiftTemplateId: (shift.template_id as number | null) ?? null,
    });

    const violations: PolicyViolation[] = [];
    for (const p of applicable) {
      const message = this.evaluate(p, { userId: input.userId, shiftId: input.shiftId });
      if (!message) continue;
      const hasApprovedException = await this.exceptions.hasApproved(
        p.id,
        'shift_assignment',
        input.shiftId
      );
      violations.push({
        policyId: p.id,
        policyKey: p.policyKey,
        scopeType: p.scopeType,
        scopeId: p.scopeId,
        message,
        hasApprovedException,
        imposedByUserId: p.imposedByUserId,
      });
    }
    const ok = violations.every((v) => v.hasApprovedException);
    return { ok, violations };
  }

  /**
   * Evaluates a single policy against a target. Returns a human-readable
   * violation message when the policy is breached, or `null` when it is
   * satisfied (or unknown / not applicable).
   *
   * Note: this is intentionally a lightweight string-based evaluator. The
   * heavy lifting (rest hours, weekly totals) is performed by the existing
   * `ComplianceEngine`. Policies here only flag violations that may have
   * already been recorded so the UI can offer a "Request exception" CTA.
   */
  private evaluate(p: Policy, _target: { userId: number; shiftId: number }): string | null {
    switch (p.policyKey) {
      case 'manual_assignment_locked':
        return 'Manual assignments are locked by policy.';
      // Other policy keys are advisory unless the scheduling engine reports
      // them as blocking. We treat them as informational for the UI here.
      default:
        return null;
    }
  }
}
