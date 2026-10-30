/**
 * Compliance hours engine (F19).
 *
 * Pure functions that decide whether scheduling a candidate shift for a user
 * violates configurable working-time rules. The engine is intentionally
 * IO-free so it can be exercised unit-by-unit without a database; DB lookup
 * concerns live in `evaluateAssignmentCompliance`, a thin orchestrator that
 * loads the inputs the engine needs.
 *
 * Rules covered today:
 *   - Maximum consecutive working days.
 *   - Minimum rest between shifts (hours).
 *   - Maximum hours in a rolling 7-day window anchored on the candidate shift.
 *
 * Adding a rule means:
 *   1. Implement a new pure function `<rule>(input): ComplianceViolation | null`.
 *   2. Call it from `checkCompliance`.
 *   3. Add a test covering pass / fail / boundary.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket } from 'mysql2/promise';
import { DateUtils } from '../utils';
import {
  DEFAULT_WORKING_TIME_LIMITS,
  WorkingTimeLimitsService,
  type WorkingTimeLimits,
} from './WorkingTimeLimitsService';
import { shiftBoundsMs, shiftHours, dateToMs, DAY_MS, ShiftTimes } from '../optimization/shiftTime';

/** A shift represented in the form the engine needs (no DB-row fields). */
export interface CandidateShift {
  /** ISO date `YYYY-MM-DD`. */
  date: string;
  /** `HH:mm` or `HH:mm:ss`. */
  startTime: string;
  /** `HH:mm` or `HH:mm:ss`. End time may be on the next day for overnight shifts. */
  endTime: string;
}

/** A user's existing assignment as far as the engine cares. */
export interface ExistingAssignment extends CandidateShift {
  /** Unique id, used only to deduplicate when re-evaluating an update. */
  id: number;
}

interface ComplianceInput {
  /** The shift the user is being asked to take. */
  candidate: CandidateShift;
  /** Active assignments the user already has. */
  existing: ExistingAssignment[];
  /** Resolved thresholds (see WorkingTimeLimitsService). */
  policy: WorkingTimeLimits;
}

type ComplianceCode =
  | 'MAX_CONSECUTIVE_DAYS'
  | 'MIN_REST_HOURS'
  | 'MAX_WEEKLY_HOURS';

interface ComplianceViolation {
  code: ComplianceCode;
  message: string;
  /** Numbers used to render the violation in the UI. */
  details: Record<string, number | string>;
}

type ComplianceResult =
  | { ok: true; violations: [] }
  | { ok: false; violations: ComplianceViolation[] };

/* ------------------------------------------------------------------ */
/* Date helpers                                                        */
/* ------------------------------------------------------------------ */

/**
 * Overnight-aware shift-bounds/duration arithmetic is NOT reimplemented here.
 * `optimization/shiftTime.ts` is the canonical module for it — its own header
 * documents two production defects that came from independent copies of
 * exactly this rule, which is why this engine adapts to that module's
 * `ShiftTimes` shape (`start_time`/`end_time`) rather than keeping its own.
 * `CandidateShift`'s public field names (`startTime`/`endTime`) are unchanged
 * — this engine has its own callers — so only this adapter is new.
 */
const toShiftTimes = (s: CandidateShift): ShiftTimes => ({
  date: s.date,
  start_time: s.startTime,
  end_time: s.endTime,
});

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const dayDiff = (a: string, b: string): number => Math.round((dateToMs(a) - dateToMs(b)) / DAY_MS);

const addIsoDays = (date: string, days: number): string => isoDay(dateToMs(date) + days * DAY_MS);

/* ------------------------------------------------------------------ */
/* Individual rules                                                    */
/* ------------------------------------------------------------------ */

const checkMaxConsecutiveDays = (input: ComplianceInput): ComplianceViolation | null => {
  const { candidate, existing, policy } = input;
  const days = new Set<string>([candidate.date, ...existing.map((s) => s.date)]);
  const sorted = Array.from(days).sort();

  // Walk through consecutive day groups; the longest run that contains the
  // candidate date is what matters.
  let longestRunContainingCandidate = 1;
  let currentRunStart = sorted[0];
  let currentRunLength = 1;
  for (let i = 1; i < sorted.length; i++) {
    const diff = dayDiff(sorted[i], sorted[i - 1]);
    if (diff === 1) {
      currentRunLength++;
    } else {
      currentRunStart = sorted[i];
      currentRunLength = 1;
    }
    // Snapshot the run that contains the candidate.
    const runEnd = sorted[i];
    if (
      candidate.date >= currentRunStart &&
      candidate.date <= runEnd &&
      currentRunLength > longestRunContainingCandidate
    ) {
      longestRunContainingCandidate = currentRunLength;
    }
  }

  if (longestRunContainingCandidate > policy.maxConsecutiveDays) {
    return {
      code: 'MAX_CONSECUTIVE_DAYS',
      message: `Assignment would result in ${longestRunContainingCandidate} consecutive working days, exceeding the maximum of ${policy.maxConsecutiveDays}.`,
      details: {
        consecutiveDays: longestRunContainingCandidate,
        limit: policy.maxConsecutiveDays,
      },
    };
  }

  return null;
};

const checkMinRest = (input: ComplianceInput): ComplianceViolation | null => {
  const { candidate, existing, policy } = input;
  const [candStart, candEnd] = shiftBoundsMs(toShiftTimes(candidate));

  for (const other of existing) {
    const [otherStart, otherEnd] = shiftBoundsMs(toShiftTimes(other));

    // If candidate ends before `other` starts, rest is otherStart - candEnd.
    // If other ends before candidate starts, rest is candStart - otherEnd.
    let restHours: number;
    if (candEnd <= otherStart) {
      restHours = (otherStart - candEnd) / 3_600_000;
    } else if (otherEnd <= candStart) {
      restHours = (candStart - otherEnd) / 3_600_000;
    } else {
      // Overlap is a different kind of conflict and is handled by the existing
      // assignment-conflict check upstream; the compliance engine doesn't
      // double-flag it.
      continue;
    }

    if (restHours < policy.minRestHoursBetweenShifts) {
      return {
        code: 'MIN_REST_HOURS',
        message: `Only ${restHours.toFixed(1)}h of rest with another shift on ${other.date}; ${policy.minRestHoursBetweenShifts}h required.`,
        details: {
          restHours: Number(restHours.toFixed(2)),
          limit: policy.minRestHoursBetweenShifts,
          conflictingDate: other.date,
        },
      };
    }
  }

  return null;
};

const checkMaxWeeklyHours = (input: ComplianceInput): ComplianceViolation | null => {
  const { candidate, existing, policy } = input;

  const all = [
    { date: candidate.date, hours: shiftHours(toShiftTimes(candidate)) },
    ...existing.map((s) => ({ date: s.date, hours: shiftHours(toShiftTimes(s)) })),
  ];

  // "No more than maxHoursPerWeek in any 7-day window" means checking every
  // 7-day window that could contain the candidate's *day*, not one fixed
  // span, and windows are calendar-day boundaries, not exact timestamps — an
  // overnight shift starting at 23:00 must still be grouped with same-day
  // morning shifts, not excluded by a few hours of clock time. A single
  // window anchored ±6 days from the candidate covers 13 days, not 7, and
  // over-counts hours from shifts a week or more apart — flagging perfectly
  // normal, spread-out schedules as violations. Instead, slide a true 7-day
  // window (by calendar day) across every offset that still contains the
  // candidate's day and take the worst one.
  let worstTotalHours = 0;
  let worstWindowStart = candidate.date;
  for (let offsetDays = -6; offsetDays <= 0; offsetDays++) {
    const total = all
      .filter((s) => {
        const diff = dayDiff(s.date, candidate.date);
        return diff >= offsetDays && diff <= offsetDays + 6;
      })
      .reduce((sum, s) => sum + s.hours, 0);
    if (total > worstTotalHours) {
      worstTotalHours = total;
      worstWindowStart = addIsoDays(candidate.date, offsetDays);
    }
  }

  if (worstTotalHours > policy.maxHoursPerWeek) {
    return {
      code: 'MAX_WEEKLY_HOURS',
      message: `Assignment would result in ${worstTotalHours.toFixed(1)}h in a rolling 7-day window, exceeding the maximum of ${policy.maxHoursPerWeek}h.`,
      details: {
        totalHours: Number(worstTotalHours.toFixed(2)),
        limit: policy.maxHoursPerWeek,
        anchorDate: worstWindowStart,
      },
    };
  }

  return null;
};

/* ------------------------------------------------------------------ */
/* Composite                                                           */
/* ------------------------------------------------------------------ */

/**
 * Evaluates every compliance rule and returns the aggregated result.
 * Pure function — same input always yields the same output.
 */
export const checkCompliance = (input: ComplianceInput): ComplianceResult => {
  const checks: Array<(i: ComplianceInput) => ComplianceViolation | null> = [
    checkMaxConsecutiveDays,
    checkMinRest,
    checkMaxWeeklyHours,
  ];

  const violations: ComplianceViolation[] = [];
  for (const check of checks) {
    const v = check(input);
    if (v) violations.push(v);
  }

  if (violations.length === 0) return { ok: true, violations: [] };
  return { ok: false, violations };
};

/* ------------------------------------------------------------------ */
/* DB-aware orchestrator                                               */
/* ------------------------------------------------------------------ */

/**
 * Loads policy + active assignments for `userId` and runs `checkCompliance`
 * against `candidate`. Used by `AssignmentService.createAssignment`.
 *
 * The limits come from `WorkingTimeLimitsService` — contract, then
 * preference, then the organization's global `policies` (#312), then
 * `system_settings`, then the defaults — on the candidate's date. It is the
 * same resolver the optimizer's problem is built from, so a manual
 * assignment and a generated one are judged against the same limits (#883).
 */
export const evaluateAssignmentCompliance = async (
  pool: Pool,
  userId: number,
  candidate: CandidateShift,
  options: { excludeAssignmentId?: number } = {}
): Promise<ComplianceResult> => {
  const { limits } = await new WorkingTimeLimitsService(pool).resolve(
    [userId],
    candidate.date,
    candidate.date
  );
  const policy = limits.get(userId) ?? DEFAULT_WORKING_TIME_LIMITS;

  // Load existing assignments within ±7 days of the candidate so the
  // consecutive-days walker has enough context.
  const candidateDate = candidate.date;
  const [assignmentRows] = await pool.execute<RowDataPacket[]>(
    `SELECT sa.id, s.date, s.start_time, s.end_time
       FROM shift_assignments sa
       JOIN shifts s ON sa.shift_id = s.id
      WHERE sa.user_id = ?
        AND sa.status IN ('pending', 'confirmed')
        AND s.date BETWEEN DATE_SUB(?, INTERVAL 14 DAY) AND DATE_ADD(?, INTERVAL 14 DAY)`,
    [userId, candidateDate, candidateDate]
  );

  const existing: ExistingAssignment[] = assignmentRows
    .filter((row: any) => options.excludeAssignmentId !== row.id)
    .map((row: any) => ({
      id: row.id,
      date: typeof row.date === 'string' ? row.date : DateUtils.fromMySQLDate(row.date),
      startTime: row.start_time,
      endTime: row.end_time,
    }));

  const result = checkCompliance({ candidate, existing, policy });

  // Recorded here, the single point every caller already routes through,
  // rather than at each of the (currently two) call sites — a third caller
  // gets the history for free instead of having to remember to add it.
  if (!result.ok && result.violations.length > 0) {
    await pool.execute(
      `INSERT INTO compliance_violations (user_id, code, message) VALUES ${result.violations
        .map(() => '(?, ?, ?)')
        .join(', ')}`,
      result.violations.flatMap((v) => [userId, v.code, v.message])
    );
  }

  return result;
};
