/**
 * The last check a generated schedule passes before it is persisted (#963).
 *
 * WHAT IT GUARDS AGAINST. The validator proves an engine obeyed the PROBLEM it
 * was handed; nothing proved the problem described the work ComplianceEngine
 * judges. The HTTP workforce simulation found exactly that gap: or-tools
 * schedules, valid against their own problems, that ComplianceEngine flagged
 * on the same data because the problem builder had left out work people
 * already held. This check closes the class rather than the instance: every
 * assignment a run would add is judged the way `evaluateAssignmentCompliance`
 * judges a manual one, from data this module reads ITSELF —
 *
 *   - the person's work: every live (pending/confirmed) assignment on any
 *     schedule within 14 days of the candidate, read by its own query, never
 *     the rows the problem was built from. A check over the loader's rows
 *     would agree with the loader by construction, and a loader omission —
 *     which is what #963 was — would pass straight through it;
 *   - the limits: WorkingTimeLimitsService resolved on the candidate's own
 *     date, exactly as ComplianceEngine resolves them, not the period-wide
 *     figures the builder wrote into the problem;
 *   - the rules: ComplianceEngine's own pure `checkCompliance`, not a copy.
 *
 * ONE DELIBERATE DIFFERENCE from ComplianceEngine's work query: assignments
 * on a same-department schedule that never happened are excluded — a draft
 * other than this one and its chosen predecessor, or an archived schedule
 * that was never published. Drafts of one department are alternative
 * versions of a period, at most one of which will happen; counting them all
 * would refuse this run because of work no one will do. ComplianceEngine
 * counts them (a separate question for a manual assignment), so this is the
 * one place the two can disagree, and it errs only toward accepting work a
 * competing draft also plans. On a PUBLISHED schedule this schedule's own
 * rows are excluded too: its run proposes a whole replacement set.
 *
 * It does NOT guard against an engine inventing work: an assignment to a
 * shift or person the run was never given is an engine fault, and fails the
 * run instead (see `assertKnown`).
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
 * the withheld assignments named, and counts them by rule.
 *
 * WHY ONE PASS IN A FIXED ORDER. Each assignment is checked against the work
 * read plus the assignments accepted before it. Every rule is decided by a
 * window or a pair that contains the later of the assignments involved, so
 * when that later one is checked the earlier ones are present: the accepted
 * set is compliant as a whole, not just pairwise with what preceded it.
 * Ordering by time and id makes which one of a conflicting pair is withheld
 * reproducible.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket } from 'mysql2/promise';
import { DateUtils } from '../utils';
import { inClause } from '../utils/sql';
import { logger } from '../config/logger';
import { OptimizationFailedError } from '../errors';
import { DAY_MS, dateToMs } from '../optimization/shiftTime';
import type { ScheduleAssignment } from '../optimization/types';
import { checkCompliance, type CandidateShift, type ExistingAssignment } from './ComplianceEngine';
import { WorkingTimeLimitsService, type WorkingTimeLimits } from './WorkingTimeLimitsService';
import type { ScheduleInputs } from './autoScheduleProblem';

/** An assignment a run produced and was not allowed to keep, and why. */
export interface WithheldAssignment {
  userId: number;
  shiftId: number;
  /** The ComplianceEngine codes broken, for the metric. */
  rules: string[];
  /** `CODE: message` per broken rule, in ComplianceEngine's own words. */
  violations: string[];
}

/** ComplianceEngine's lookback/lookahead around a candidate, in days. */
const WINDOW_DAYS = 14;

/** How many withheld assignments the one-line reason names before summarising. */
const REASON_DETAIL_LIMIT = 5;

type Dated = CandidateShift & { dayMs: number };

const dated = (date: string, startTime: string, endTime: string): Dated => ({
  date,
  startTime,
  endTime,
  dayMs: dateToMs(date),
});

/**
 * An assignment to a shift or person the run was never given is not a
 * compliance question: no engine may produce one, so it is a fault in the
 * engine, and nothing the run produced can be trusted to be what was asked.
 */
const assertKnown = (inputs: ScheduleInputs, assignments: ScheduleAssignment[]): void => {
  const shifts = new Set(inputs.shifts.map((s) => String(s.id)));
  const people = new Set(inputs.employees.map((e) => String(e.id)));
  const foreign = assignments.filter((a) => !shifts.has(a.shiftId) || !people.has(a.employeeId));
  if (foreign.length === 0) return;
  logger.error(
    `Optimization for schedule=${inputs.schedule.id} returned ${foreign.length} assignment(s) ` +
      `to shifts or people it was never given: ` +
      foreign
        .slice(0, REASON_DETAIL_LIMIT)
        .map((a) => `user ${a.employeeId} shift ${a.shiftId}`)
        .join(', ')
  );
  throw new OptimizationFailedError();
};

/** Every live assignment of `userIds` within reach of this run's checks, read independently. */
const loadWork = async (
  pool: Pool,
  inputs: ScheduleInputs,
  userIds: number[]
): Promise<Map<string, Dated[]>> => {
  const { schedule } = inputs;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT sa.user_id, s.date, s.start_time, s.end_time
       -- post-solve compliance check: every live assignment of the people assigned
       FROM shift_assignments sa
       JOIN shifts s ON s.id = sa.shift_id
       JOIN schedules sc ON sc.id = s.schedule_id
      WHERE sa.user_id IN (${inClause(userIds)})
        AND sa.status IN ('pending', 'confirmed')
        AND s.date BETWEEN DATE_SUB(?, INTERVAL ${WINDOW_DAYS} DAY) AND DATE_ADD(?, INTERVAL ${WINDOW_DAYS} DAY)
        AND s.schedule_id <> ?
        AND NOT (sc.department_id = ? AND sc.id NOT IN (?, ?)
                 AND (sc.status = 'draft' OR (sc.status = 'archived' AND sc.published_at IS NULL)))`,
    [
      schedule.start_date,
      schedule.end_date,
      // A published schedule's rows are what its proposal replaces; a draft's
      // stay, so they count. 0 matches no schedule.
      schedule.status === 'published' ? schedule.id : 0,
      schedule.department_id,
      schedule.id,
      schedule.previous_schedule_id ?? 0,
    ]
  );
  const work = new Map<string, Dated[]>();
  for (const row of rows) {
    const id = String(row.user_id);
    work.set(id, [
      ...(work.get(id) ?? []),
      dated(DateUtils.toDateString(row.date as string | Date), row.start_time as string, row.end_time as string),
    ]);
  }
  return work;
};

/** Limits per user on each candidate date, resolved as ComplianceEngine resolves them. */
const loadLimits = async (
  pool: Pool,
  byDate: Map<string, Set<number>>
): Promise<Map<string, Map<number, WorkingTimeLimits>>> => {
  const resolver = new WorkingTimeLimitsService(pool);
  const out = new Map<string, Map<number, WorkingTimeLimits>>();
  for (const [date, users] of byDate) {
    out.set(date, (await resolver.resolve([...users], date, date)).limits);
  }
  return out;
};

/**
 * Splits a run's assignments into those ComplianceEngine accepts and those it
 * would refuse. Throws OptimizationFailedError when the run assigned a shift
 * or person it was never given.
 */
export const withholdNonCompliant = async (
  pool: Pool,
  inputs: ScheduleInputs,
  assignments: ScheduleAssignment[]
): Promise<{ kept: ScheduleAssignment[]; withheld: WithheldAssignment[] }> => {
  if (assignments.length === 0) return { kept: [], withheld: [] };
  assertKnown(inputs, assignments);

  const shifts = new Map(
    inputs.shifts.map((s) => [
      String(s.id),
      dated(DateUtils.toDateString(s.date), s.start_time, s.end_time),
    ])
  );
  const candidateOf = (a: ScheduleAssignment): Dated => shifts.get(a.shiftId)!;

  const byDate = new Map<string, Set<number>>();
  for (const a of assignments) {
    const date = candidateOf(a).date;
    byDate.set(date, (byDate.get(date) ?? new Set()).add(Number(a.employeeId)));
  }
  const userIds = [...new Set(assignments.map((a) => Number(a.employeeId)))];
  const [work, limits] = await Promise.all([
    loadWork(pool, inputs, userIds),
    loadLimits(pool, byDate),
  ]);

  const ordered = [...assignments].sort((a, b) => {
    const sa = candidateOf(a);
    const sb = candidateOf(b);
    return (
      sa.date.localeCompare(sb.date) ||
      sa.startTime.localeCompare(sb.startTime) ||
      Number(a.shiftId) - Number(b.shiftId) ||
      Number(a.employeeId) - Number(b.employeeId)
    );
  });

  const kept: ScheduleAssignment[] = [];
  const withheld: WithheldAssignment[] = [];
  for (const a of ordered) {
    const candidate = candidateOf(a);
    const policy = limits.get(candidate.date)!.get(Number(a.employeeId))!;
    // ComplianceEngine's own window around the candidate; ids exist only for
    // its self-exclusion on an update, so negative ones cannot collide.
    const existing: ExistingAssignment[] = (work.get(a.employeeId) ?? [])
      .filter((w) => Math.abs(w.dayMs - candidate.dayMs) <= WINDOW_DAYS * DAY_MS)
      .map((w, i) => ({ id: -(i + 1), date: w.date, startTime: w.startTime, endTime: w.endTime }));
    const result = checkCompliance({ candidate, existing, policy });
    if (result.ok) {
      kept.push(a);
      work.set(a.employeeId, [...(work.get(a.employeeId) ?? []), candidate]);
    } else {
      withheld.push({
        userId: Number(a.employeeId),
        shiftId: Number(a.shiftId),
        rules: result.violations.map((v) => v.code),
        violations: result.violations.map((v) => `${v.code}: ${v.message}`),
      });
    }
  }
  return { kept, withheld };
};

/** The first `limit` withheld assignments, named, and how many more there were. */
export const listWithheld = (withheld: WithheldAssignment[], limit = REASON_DETAIL_LIMIT): string => {
  const named = withheld
    .slice(0, limit)
    .map((w) => `user ${w.userId} on shift ${w.shiftId} (${w.violations.join('; ')})`);
  const more = withheld.length > limit ? `; and ${withheld.length - limit} more` : '';
  return `${named.join('; ')}${more}`;
};

/** The degraded reason a run with withheld assignments reports. */
export const describeWithheld = (withheld: WithheldAssignment[]): string =>
  `Withheld ${withheld.length} generated assignment(s) that would break the working-time ` +
  `limits ComplianceEngine enforces: ${listWithheld(withheld)}`;
