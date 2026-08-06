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
import { EmploymentContractService } from './EmploymentContractService';
import { PolicyService } from './PolicyService';

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

interface ComplianceInput {
  /** The shift the user is being asked to take. */
  candidate: CandidateShift;
  /** Active assignments the user already has. */
  existing: ExistingAssignment[];
  /** Resolved policy thresholds (per-user preferences merged with global defaults). */
  policy: CompliancePolicy;
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

const addIsoDays = (date: string, days: number): string => {
  const d = new Date(Date.parse(`${date}T00:00:00Z`) + days * 24 * 60 * 60 * 1000);
  return isoDay(d);
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

  const all = [
    { date: candidate.date, hours: shiftDurationHours(candidate) },
    ...existing.map((s) => ({ date: s.date, hours: shiftDurationHours(s) })),
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
 * Policy resolution order (first match wins per field):
 *   1. The user's employment contract in force on the candidate's date
 *      (`EmploymentContractService.resolveLimitsForPeriod`) — the same,
 *      single resolution the optimizer already uses. Checked FIRST: a
 *      contract is a deliberate, effective-dated limit a manager set, and a
 *      stale `user_preferences` value must not override it.
 *   2. `user_preferences` row for the user (legacy; still the answer for
 *      anyone with no contract assigned)
 *   3. An active GLOBAL `policies` row for the matching key
 *      (`min_rest_hours`/`max_hours_week`/`max_consecutive_days`) — an
 *      organization's own configured regulatory rule set, which an admin can
 *      populate by hand through `POST /api/policies` or in bulk by applying a
 *      jurisdiction preset (`CompliancePresetService`). This is the layer
 *      #312 exists to wire in: the `policies` table and its CRUD already
 *      existed, and `PolicyValidator` already documented that "the heavy
 *      lifting... is performed by the existing ComplianceEngine" — but
 *      nothing here had ever actually read a `policies` row. A configured
 *      rule now genuinely participates in enforcement rather than sitting in
 *      the table as an unenforced record of intent.
 *   4. `system_settings` keys (`scheduling.max_shifts_per_week` is the
 *      legacy proxy for `max_hours_per_week / 8`; we ignore it and read
 *      the explicit keys when present) — the older, non-configurable-per-
 *      scope fallback that `policies` is meant to supersede over time.
 *   5. `DEFAULT_COMPLIANCE_POLICY`
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

  const globalPolicies = await new PolicyService(pool).getGlobalValues([
    'min_rest_hours',
    'max_hours_week',
    'max_consecutive_days',
  ]);
  // `policy_value` is `{ hours: number }` / `{ days: number }` per
  // PolicyValidator's documented shape for these keys; a malformed or
  // missing field reads as absent rather than throwing, consistent with
  // every other layer in this chain treating "not set" as fall-through.
  const asNumber = (value: unknown, field: string): number | undefined => {
    const n = (value as Record<string, unknown> | undefined)?.[field];
    return typeof n === 'number' && n > 0 ? n : undefined;
  };
  const globalMinRestHours = asNumber(globalPolicies.min_rest_hours, 'hours');
  const globalMaxHoursPerWeek = asNumber(globalPolicies.max_hours_week, 'hours');
  const globalMaxConsecutiveDays = asNumber(globalPolicies.max_consecutive_days, 'days');

  const pref = prefRows[0] as { max_hours_per_week?: number; max_consecutive_days?: number } | undefined;
  const contracts = await new EmploymentContractService(pool).resolveLimitsForPeriod(
    [userId],
    candidate.date,
    candidate.date
  );
  const contract = contracts.get(userId);

  const policy: CompliancePolicy = {
    maxConsecutiveDays:
      contract?.maxConsecutiveDays ??
      pref?.max_consecutive_days ??
      globalMaxConsecutiveDays ??
      (Number(settings.max_consecutive_days) ||
        DEFAULT_COMPLIANCE_POLICY.maxConsecutiveDays),
    minRestHoursBetweenShifts:
      contract?.minHoursBetweenShifts ??
      globalMinRestHours ??
      (Number(settings.min_hours_between_shifts) ||
        DEFAULT_COMPLIANCE_POLICY.minRestHoursBetweenShifts),
    maxHoursPerWeek:
      contract?.maxHoursPerWeek ??
      pref?.max_hours_per_week ??
      globalMaxHoursPerWeek ??
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
