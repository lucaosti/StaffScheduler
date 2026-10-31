/**
 * The last check a generated schedule passes before it is persisted (#963).
 *
 * WHY A CHECK AFTER THE ENGINES, when both are already held to one validator.
 * The validator proves an engine obeyed the PROBLEM it was handed; nothing
 * proved the problem described the world ComplianceEngine judges. The HTTP
 * workforce simulation found exactly that gap: or-tools schedules, valid
 * against their own problems, that ComplianceEngine flagged on the same data
 * because the builder had left out work people already held. The builder is
 * fixed, but the class of defect — two descriptions of "what this person
 * already works" drifting apart — is one the parity suite cannot see, so the
 * rules a manual assignment is judged by are applied here too, to every
 * assignment a run would add, before anything is written or proposed.
 *
 * It is ComplianceEngine's own pure `checkCompliance`, not a copy of its
 * rules, and its limits are the resolver's output (`workingTimeLimits`), not
 * the numbers the builder put in the problem — a check that read the problem
 * would inherit any mistake the builder made.
 *
 * WHY A VIOLATING ASSIGNMENT IS WITHHELD, not the whole schedule refused.
 * Refusing to persist anything turns one bad pairing into an empty result for
 * the planner, and the alternative of persisting it is the defect itself.
 * Dropping only the assignments that would break a limit always leaves a
 * legal schedule — every rule involved is an upper bound or a minimum gap, so
 * removing work never creates a violation — at the cost of coverage, which is
 * already the accepted failure mode of a best-effort engine (see
 * constraintValidator: under-coverage is a quality metric, not an illegal
 * schedule). It is never silent: the caller reports the run as degraded with
 * every withheld assignment named.
 *
 * WHY ONE PASS IN A FIXED ORDER. Each assignment is checked against the work
 * already held plus the assignments accepted before it. Every rule is decided
 * by a window or a pair that contains the later of the assignments involved,
 * so when that later one is checked the earlier ones are present: the
 * accepted set is compliant as a whole, not just pairwise with what preceded
 * it. Ordering by time and id makes which one of a conflicting pair is
 * withheld reproducible.
 *
 * @author Luca Ostinelli
 */

import { DateUtils } from '../utils';
import type { ScheduleAssignment } from '../optimization/types';
import { checkCompliance, type CandidateShift, type ExistingAssignment } from './ComplianceEngine';
import { fixedOnThisSchedule, type ScheduleInputs } from './autoScheduleProblem';

/** An assignment a run produced and was not allowed to keep, and why. */
export interface WithheldAssignment {
  userId: number;
  shiftId: number;
  /** `CODE: message` per broken rule, in ComplianceEngine's own words. */
  violations: string[];
}

/** How many withheld assignments the one-line reason names before summarising. */
const REASON_DETAIL_LIMIT = 5;

/**
 * Splits a run's assignments into those ComplianceEngine accepts and those it
 * would refuse, given the work each person already holds: their assignments
 * on other schedules and, on a draft, those already on this one.
 */
export const withholdNonCompliant = (
  inputs: ScheduleInputs,
  assignments: ScheduleAssignment[]
): { kept: ScheduleAssignment[]; withheld: WithheldAssignment[] } => {
  const shifts = new Map<string, CandidateShift>(
    inputs.shifts.map((s) => [
      String(s.id),
      { date: DateUtils.toDateString(s.date), startTime: s.start_time, endTime: s.end_time },
    ])
  );

  const work = new Map<string, CandidateShift[]>();
  const add = (employeeId: string, shift: CandidateShift): void => {
    work.set(employeeId, [...(work.get(employeeId) ?? []), shift]);
  };
  for (const [userId, list] of inputs.externalAssignmentsByUser) {
    for (const e of list) add(String(userId), { date: e.date, startTime: e.start_time, endTime: e.end_time });
  }
  for (const h of fixedOnThisSchedule(inputs)) {
    const shift = shifts.get(h.shift_id);
    if (shift) add(h.employee_id, shift);
  }

  const ordered = [...assignments].sort((a, b) => {
    const sa = shifts.get(a.shiftId);
    const sb = shifts.get(b.shiftId);
    return (
      (sa?.date ?? '').localeCompare(sb?.date ?? '') ||
      (sa?.startTime ?? '').localeCompare(sb?.startTime ?? '') ||
      Number(a.shiftId) - Number(b.shiftId) ||
      Number(a.employeeId) - Number(b.employeeId)
    );
  });

  const kept: ScheduleAssignment[] = [];
  const withheld: WithheldAssignment[] = [];
  for (const a of ordered) {
    const candidate = shifts.get(a.shiftId);
    const policy = inputs.workingTimeLimits.get(Number(a.employeeId));
    if (!candidate || !policy) {
      withheld.push({
        userId: Number(a.employeeId),
        shiftId: Number(a.shiftId),
        violations: [`UNKNOWN: not a shift and candidate of this schedule`],
      });
      continue;
    }
    // Ids exist only for ComplianceEngine's self-exclusion on an update,
    // which does not arise here; negative so none can collide with a row.
    const existing: ExistingAssignment[] = (work.get(a.employeeId) ?? []).map((s, i) => ({
      id: -(i + 1),
      ...s,
    }));
    const result = checkCompliance({ candidate, existing, policy });
    if (result.ok) {
      kept.push(a);
      add(a.employeeId, candidate);
    } else {
      withheld.push({
        userId: Number(a.employeeId),
        shiftId: Number(a.shiftId),
        violations: result.violations.map((v) => `${v.code}: ${v.message}`),
      });
    }
  }
  return { kept, withheld };
};

/** The degraded reason a run with withheld assignments reports. */
export const describeWithheld = (withheld: WithheldAssignment[]): string => {
  const named = withheld
    .slice(0, REASON_DETAIL_LIMIT)
    .map((w) => `user ${w.userId} on shift ${w.shiftId} (${w.violations.join('; ')})`);
  const more = withheld.length > REASON_DETAIL_LIMIT ? `; and ${withheld.length - REASON_DETAIL_LIMIT} more` : '';
  return (
    `Withheld ${withheld.length} generated assignment(s) that would break the working-time ` +
    `limits ComplianceEngine enforces: ${named.join('; ')}${more}`
  );
};
