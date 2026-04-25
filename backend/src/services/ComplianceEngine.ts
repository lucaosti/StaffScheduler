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

export interface CompliancePolicy {
  /** Hard upper bound on consecutive working days. */
  maxConsecutiveDays: number;
  /** Hard lower bound on rest between two shifts, in hours. */
  minRestHoursBetweenShifts: number;
  /** Hard upper bound on hours worked in a rolling 7-day window. */
  maxHoursPerWeek: number;
}

export interface ComplianceInput {
  /** The shift the user is being asked to take. */
  candidate: CandidateShift;
  /** Active assignments the user already has. */
  existing: ExistingAssignment[];
  /** Resolved policy thresholds (per-user preferences merged with global defaults). */
  policy: CompliancePolicy;
}

export type ComplianceCode =
  | 'MAX_CONSECUTIVE_DAYS'
  | 'MIN_REST_HOURS'
  | 'MAX_WEEKLY_HOURS';

export interface ComplianceViolation {
  code: ComplianceCode;
  message: string;
  /** Numbers used to render the violation in the UI. */
  details: Record<string, number | string>;
}

export type ComplianceResult =
  | { ok: true; violations: [] }
  | { ok: false; violations: ComplianceViolation[] };

/**
 * Default policy used when the user has no `user_preferences` row and the
 * `system_settings` keys are missing. Conservative numbers — the assumption
 * is that being too strict is a recoverable UX problem; being too lax is a
 * labour-law problem.
 */
export const DEFAULT_COMPLIANCE_POLICY: CompliancePolicy = {
  maxConsecutiveDays: 5,
  minRestHoursBetweenShifts: 8,
  maxHoursPerWeek: 40,
};

/* ------------------------------------------------------------------ */
/* Date helpers                                                        */
/* ------------------------------------------------------------------ */

/**
 * Parses a `(date, time)` pair into an absolute Date. Times are interpreted
 * as wall-clock UTC; the engine works in elapsed-hours arithmetic so the
 * choice of zone is irrelevant as long as it is consistent.
 */
const toDate = (date: string, time: string): Date => {
  const normalizedTime = time.length === 5 ? `${time}:00` : time;
  return new Date(`${date}T${normalizedTime}Z`);
};

/**
 * Returns the [start, end] timestamps of a shift, accounting for overnight
 * shifts where the end time wraps past midnight.
 */
const shiftBounds = (shift: CandidateShift): [Date, Date] => {
  const start = toDate(shift.date, shift.startTime);
  let end = toDate(shift.date, shift.endTime);
  if (end <= start) {
    // Overnight: roll the end into the next calendar day.
    end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  }
  return [start, end];
};

const hoursBetween = (a: Date, b: Date): number =>
  Math.abs(a.getTime() - b.getTime()) / (1000 * 60 * 60);

const shiftDurationHours = (shift: CandidateShift): number => {
  const [start, end] = shiftBounds(shift);
  return hoursBetween(start, end);
};

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

const dayDiff = (a: string, b: string): number => {
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  return Math.round((da - db) / (24 * 60 * 60 * 1000));
};

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
  const [candStart, candEnd] = shiftBounds(candidate);

  for (const other of existing) {
    const [otherStart, otherEnd] = shiftBounds(other);

    // If candidate ends before `other` starts, rest is otherStart - candEnd.
    // If other ends before candidate starts, rest is candStart - otherEnd.
    let restHours: number;
    if (candEnd <= otherStart) {
      restHours = hoursBetween(candEnd, otherStart);
    } else if (otherEnd <= candStart) {
      restHours = hoursBetween(candStart, otherEnd);
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
  const candidateStart = toDate(candidate.date, candidate.startTime);

  // Rolling 7-day window: anything starting in [start - 6d, start + 6d] counts
  // when assessed against the candidate. We use 6 days on either side because
  // the candidate's own week can stretch in both directions; the policy is
  // expressed as "no more than maxHoursPerWeek in any 7-day window".
  const windowMs = 6 * 24 * 60 * 60 * 1000;
  const windowStart = new Date(candidateStart.getTime() - windowMs);
  const windowEnd = new Date(candidateStart.getTime() + windowMs);

  let totalHours = shiftDurationHours(candidate);
  for (const other of existing) {
    const otherStart = toDate(other.date, other.startTime);
    if (otherStart >= windowStart && otherStart <= windowEnd) {
      totalHours += shiftDurationHours(other);
    }
  }

  if (totalHours > policy.maxHoursPerWeek) {
    return {
      code: 'MAX_WEEKLY_HOURS',
      message: `Assignment would result in ${totalHours.toFixed(1)}h in a rolling 7-day window, exceeding the maximum of ${policy.maxHoursPerWeek}h.`,
      details: {
        totalHours: Number(totalHours.toFixed(2)),
        limit: policy.maxHoursPerWeek,
        anchorDate: isoDay(candidateStart),
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
 * Policy resolution order (first match wins per field):
 *   1. `user_preferences` row for the user
 *   2. `system_settings` keys (`scheduling.max_shifts_per_week` is the
 *      legacy proxy for `max_hours_per_week / 8`; we ignore it and read
 *      the explicit keys when present)
 *   3. `DEFAULT_COMPLIANCE_POLICY`
 */
export const evaluateAssignmentCompliance = async (
  pool: Pool,
  userId: number,
  candidate: CandidateShift,
  options: { excludeAssignmentId?: number } = {}
): Promise<ComplianceResult> => {
  // Resolve policy.
  const [prefRows] = await pool.execute<RowDataPacket[]>(
    `SELECT max_hours_per_week, max_consecutive_days
       FROM user_preferences
       WHERE user_id = ?
       LIMIT 1`,
    [userId]
  );
  const [settingRows] = await pool.execute<RowDataPacket[]>(
    `SELECT \`key\`, value
       FROM system_settings
       WHERE category = 'scheduling'
         AND \`key\` IN ('min_hours_between_shifts', 'max_consecutive_days', 'max_hours_per_week')`
  );
  const settings: Record<string, string> = {};
  for (const row of settingRows) settings[row.key as string] = row.value as string;

  const pref = prefRows[0] as { max_hours_per_week?: number; max_consecutive_days?: number } | undefined;

  const policy: CompliancePolicy = {
    maxConsecutiveDays:
      pref?.max_consecutive_days ??
      (Number(settings.max_consecutive_days) ||
        DEFAULT_COMPLIANCE_POLICY.maxConsecutiveDays),
    minRestHoursBetweenShifts:
      Number(settings.min_hours_between_shifts) ||
      DEFAULT_COMPLIANCE_POLICY.minRestHoursBetweenShifts,
    maxHoursPerWeek:
      pref?.max_hours_per_week ??
      (Number(settings.max_hours_per_week) ||
        DEFAULT_COMPLIANCE_POLICY.maxHoursPerWeek),
  };

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
      date: typeof row.date === 'string' ? row.date : new Date(row.date).toISOString().slice(0, 10),
      startTime: row.start_time,
      endTime: row.end_time,
    }));

  return checkCompliance({ candidate, existing, policy });
};
