/**
 * Assembly of the `OptimizationProblem` both scheduling engines consume.
 *
 * WHY THIS IS A SEPARATE MODULE AND A PURE FUNCTION. Problem construction is
 * the densest logic in the auto-schedule path — skill-level parsing,
 * contract-over-preference precedence, carried-load deviations, unavailability
 * expansion — and it used to live in the middle of `AutoScheduleService.generate`,
 * downstream of eleven database reads. The only way to exercise "does a contract
 * limit win over the preference default" was to stand up a fake pool and answer
 * every one of those reads first. Taking plain rows in and returning a problem
 * out makes each of those questions a direct call with no I/O in the way.
 *
 * It also restores the type. The problem was built as an untyped object literal
 * and forced into the optimizer with `as never`, so `OptimizationProblem` — a
 * fully specified type — checked nothing at this boundary: a field renamed in
 * `optimization/types.ts` would have compiled here and failed at runtime, in the
 * Python solver, as a missing key. Returning the declared type is what makes the
 * cast unnecessary rather than merely hidden.
 *
 * @author Luca Ostinelli
 */

import { DateUtils } from '../utils';
import { isWeekendDay, isNightWork } from '../optimization/constraintValidator';
import type { OptimizationProblem } from '../optimization/types';
import type { ContractLimits } from './EmploymentContractService';
import type { WorkingTimeLimits } from './WorkingTimeLimitsService';

/**
 * A shift row as the loader's `GROUP_CONCAT` query returns it.
 *
 * The concatenated columns are optional because a shift with no
 * `shift_skills` rows has no such columns to concatenate, and the parsers
 * below already treat absent as unconstrained.
 */
export interface ShiftInputRow {
  id: number;
  date: string | Date;
  start_time: string;
  end_time: string;
  min_staff: number;
  max_staff: number;
  skill_names?: string | null;
  skill_levels?: string | null;
  qualified_staff?: string | null;
}

/**
 * An employee row as the candidate-pool query returns it.
 *
 * Weekly hours, consecutive days and rest are NOT here: they are resolved per
 * person by WorkingTimeLimitsService (`ScheduleInputs.workingTimeLimits`).
 * This row used to carry them as `COALESCE(preference, 40)` and
 * `COALESCE(preference, 5)`, which skipped the organization's policies and
 * settings that ComplianceEngine applied to the same person (#883).
 */
export interface EmployeeInputRow {
  id: number;
  skill_names?: string | null;
  skill_levels?: string | null;
  min_hours_per_week: number;
  /** DECIMAL, so mysql2 hands it over as a string. */
  hourly_rate?: string | number | null;
}

/** A category count carried per employee — days for equity, periods for rotation. */
export interface CategoryLoad {
  weekend: number;
  night: number;
}

/**
 * The schedule being generated, as the row carries it.
 *
 * Dates stay `string | Date` because most of them are handed straight back to
 * MySQL as bind parameters; only the two lookups that need a `YYYY-MM-DD`
 * string convert, once each.
 */
export interface ScheduleRow {
  id: number;
  department_id: number;
  start_date: string | Date;
  end_date: string | Date;
  status?: string;
  previous_schedule_id?: number | null;
}

/**
 * Everything the builder needs, and nothing about where it came from.
 *
 * Deliberately not the raw query results: the maps are keyed by user id
 * because that is how the builder consumes them, and doing the grouping in the
 * loader keeps the per-employee assembly below a single lookup each.
 */
export interface ScheduleInputs {
  /**
   * Carried alongside the rows the builder consumes because the orchestrator
   * needs the schedule's status to choose between proposing and applying, and
   * a second read to re-answer what the loader already knows would be the only
   * alternative.
   */
  schedule: ScheduleRow;
  shifts: ShiftInputRow[];
  employees: EmployeeInputRow[];
  /** The held assignments that are published commitments (`is_pinned`). */
  pinned: Array<{ employee_id: string; shift_id: string }>;
  /**
   * Every live assignment already on this schedule, pinned or not. On a
   * draft they are kept as they are and the run plans around them — see
   * `fixedOnThisSchedule`.
   */
  held: Array<{ employee_id: string; shift_id: string }>;
  pairings: Array<{ employee_id: string; other_id: string; kind: 'apart' | 'requires' }>;
  contractLimits: Map<number, ContractLimits>;
  /**
   * Weekly hours, consecutive days and minimum rest per employee, resolved
   * through the chain ComplianceEngine uses. Required for every employee in
   * `employees`: the loader resolves the whole candidate pool, and a missing
   * entry is a fault rather than a reason to invent a limit.
   */
  workingTimeLimits: Map<number, WorkingTimeLimits>;
  unavailableByUser: Map<number, string[]>;
  externalAssignmentsByUser: Map<
    number,
    Array<{ date: string; start_time: string; end_time: string }>
  >;
  carried: Map<number, CategoryLoad>;
  rotationHistory: Map<number, CategoryLoad>;
}

/**
 * Parses a `name:level` list into a lookup.
 *
 * Rows whose level is NULL arrive as "name:" or are absent entirely, and are
 * skipped: an absent entry means "unconstrained" for a shift and "level
 * unknown" for an employee, which is what every row meant before proficiency
 * reached the scheduler.
 */
export const parseSkillLevels = (raw: string | null | undefined): Record<string, number> => {
  const levels: Record<string, number> = {};
  for (const pair of (raw ?? '').split(',')) {
    const [name, value] = pair.split(':');
    // `value` must be tested for emptiness BEFORE conversion: GROUP_CONCAT
    // emits "name:" when the column is NULL, and `Number('')` is 0 — a finite
    // number, so a naive check accepts it and an absent level becomes level 0,
    // which is below every requirement. That would silently disqualify
    // everyone whose proficiency was never recorded, the exact failure the
    // "absent means unknown" default exists to prevent.
    if (!name || value === undefined || value === '') continue;
    const level = Number(value);
    if (Number.isFinite(level)) levels[name] = level;
  }
  return levels;
};

/**
 * Parses `name:level:count` triples into the qualified-staff requirement.
 *
 * Rows where either column is NULL arrive with an empty segment and are
 * skipped: a shift that does not state the rule is not subject to it, matching
 * how every other absent limit behaves.
 */
export const parseQualifiedStaff = (
  raw: string | null | undefined
): Record<string, { level: number; count: number }> => {
  const out: Record<string, { level: number; count: number }> = {};
  for (const triple of (raw ?? '').split(',')) {
    const [name, level, count] = triple.split(':');
    // Same trap as above, twice over: "name::" would parse as level 0 count 0.
    if (!name || !level || !count) continue;
    if (Number.isFinite(Number(level)) && Number.isFinite(Number(count))) {
      out[name] = { level: Number(level), count: Number(count) };
    }
  }
  return out;
};

/** A comma-separated `GROUP_CONCAT` column as a list, empty when absent. */
const namesOf = (raw: string | null | undefined): string[] =>
  (raw ?? '').split(',').filter(Boolean);

/**
 * Category days worked before this period, as a normalised deviation from the
 * average of the people being scheduled.
 *
 * WHY THE AVERAGE IS OVER THE CANDIDATES and not the whole organization: the
 * comparison that means anything is with the people the solver is choosing
 * between. Averaging across departments would compare a ward with an office.
 *
 * WHY NORMALISED TO NON-NEGATIVE. The objective minimises `max - min`, which
 * does not change if every load moves by the same amount, so shifting the set
 * up until the lowest sits at zero costs nothing and spares both engines a
 * negative lower bound on every load variable.
 *
 * Rounded to whole days: a fractional day is not something anyone experiences,
 * and both engines' load variables are integral.
 */
export const carriedLoads = (
  rows: Array<{ userId: number; date: string; startTime: string; endTime: string }>,
  employeeIds: number[]
): Map<number, CategoryLoad> => {
  const weekendDays = new Map<number, Set<string>>();
  const nightDays = new Map<number, Set<string>>();
  for (const id of employeeIds) {
    weekendDays.set(id, new Set());
    nightDays.set(id, new Set());
  }

  for (const row of rows) {
    // Days, not shifts: two matching shifts on one date cost one day, the same
    // unit the in-period measure uses.
    if (isWeekendDay(row.date)) weekendDays.get(row.userId)?.add(row.date);
    if (isNightWork({ date: row.date, start_time: row.startTime, end_time: row.endTime })) {
      nightDays.get(row.userId)?.add(row.date);
    }
  }

  const deviations = (counts: Map<number, Set<string>>): Map<number, number> => {
    const totals = employeeIds.map((id) => counts.get(id)?.size ?? 0);
    const mean = totals.reduce((a, b) => a + b, 0) / (totals.length || 1);
    const raw = new Map(employeeIds.map((id, i) => [id, Math.round(totals[i] - mean)]));
    const lowest = Math.min(0, ...raw.values());
    return new Map([...raw].map(([id, d]) => [id, d - lowest]));
  };

  const weekend = deviations(weekendDays);
  const night = deviations(nightDays);
  return new Map(
    employeeIds.map((id) => [id, { weekend: weekend.get(id) ?? 0, night: night.get(id) ?? 0 }])
  );
};

/**
 * Builds the problem handed to whichever engine runs.
 *
 * WHY THE LIMITS ARE PER EMPLOYEE AND RESOLVED ELSEWHERE. Weekly hours,
 * consecutive days and rest used to come from a problem-wide constant (8 h of
 * rest for everyone, `GLOBAL_CONSTRAINTS`) and from the preference row with
 * hard-coded fallbacks, while ComplianceEngine resolved the same limits
 * through the contract, the preference, the organization's policies and the
 * system settings. An 11 h-rest contract, or an organization on the EU preset,
 * got 8 h from every generated schedule and then saw ComplianceEngine flag it
 * (#838, #883). They now come from WorkingTimeLimitsService, the resolver
 * ComplianceEngine itself uses, so the problem carries the same number for
 * each person that a manual assignment is judged against — and states no
 * problem-wide limit at all.
 *
 * The contract's OTHER limits (minimum weekly hours, daily cap, days off) have
 * no policy or setting layer, so they still come from the contract directly,
 * with the preference row for minimum hours.
 *
 * WHAT IS ALREADY ON A DRAFT IS FIXED WORK (#963). A held assignment enters
 * the problem twice, through features both engines already enforce rather
 * than a new rule: as an `existing_assignment` of its holder, so it counts
 * toward their rest, daily, weekly and consecutive-day limits (and, overlapping
 * itself, keeps them off the same shift), and as a seat taken on its shift, by
 * lowering the shift's min/max staff. The run then fills only what is still
 * open, which is what the draft path's INSERT IGNORE always did — it was the
 * solve that did not know.
 */
export const buildOptimizationProblem = (inputs: ScheduleInputs): OptimizationProblem => {
  const fixed = fixedOnThisSchedule(inputs);
  const seatsTaken = new Map<string, number>();
  for (const h of fixed) seatsTaken.set(h.shift_id, (seatsTaken.get(h.shift_id) ?? 0) + 1);

  const shifts = inputs.shifts.map((s) => {
    const taken = seatsTaken.get(String(s.id)) ?? 0;
    return {
      id: String(s.id),
      date: DateUtils.toDateString(s.date),
      start_time: s.start_time,
      end_time: s.end_time,
      min_staff: Math.max(0, s.min_staff - taken),
      max_staff: Math.max(0, s.max_staff - taken),
      required_skills: namesOf(s.skill_names),
      required_skill_levels: parseSkillLevels(s.skill_levels),
      qualified_staff: parseQualifiedStaff(s.qualified_staff),
    };
  });

  const shiftsById = new Map(shifts.map((s) => [s.id, s]));
  const fixedWork = new Map<string, Array<{ date: string; start_time: string; end_time: string }>>();
  for (const h of fixed) {
    const s = shiftsById.get(h.shift_id);
    if (!s) continue;
    fixedWork.set(h.employee_id, [
      ...(fixedWork.get(h.employee_id) ?? []),
      { date: s.date, start_time: s.start_time, end_time: s.end_time },
    ]);
  }

  return {
    shifts,
    employees: inputs.employees.map((e) => {
      const limits = inputs.contractLimits.get(e.id);
      const working = inputs.workingTimeLimits.get(e.id);
      if (!working) throw new Error(`No working-time limits were resolved for employee ${e.id}`);
      return {
        id: String(e.id),
        max_hours_per_week: working.maxHoursPerWeek,
        min_hours_per_week: limits?.minHoursPerWeek ?? e.min_hours_per_week,
        max_consecutive_days: working.maxConsecutiveDays,
        min_hours_between_shifts: working.minRestHoursBetweenShifts,
        // Absent when no contract sets one; the engines then fall back to the
        // historical derived formula rather than leaving the day uncapped.
        max_hours_per_day: limits?.maxHoursPerDay ?? undefined,
        min_consecutive_days_off: limits?.minConsecutiveDaysOff ?? undefined,
        min_days_off_per_period: limits?.minDaysOffPerPeriod ?? undefined,
        // Steers the solver's search only — see the field's own doc comment
        // in optimization/types.ts for why this must never reach a log line
        // or an API response.
        hourly_rate: e.hourly_rate != null ? Number(e.hourly_rate) : undefined,
        skills: namesOf(e.skill_names),
        skill_levels: parseSkillLevels(e.skill_levels),
        unavailable_dates: inputs.unavailableByUser.get(e.id) ?? [],
        existing_assignments: [
          ...(inputs.externalAssignmentsByUser.get(e.id) ?? []),
          ...(fixedWork.get(String(e.id)) ?? []),
        ],
        carried_load: inputs.carried.get(e.id),
        consecutive_category_periods: inputs.rotationHistory.get(e.id),
      };
    }),
    // A pin weighs keeping a commitment the solver may still move; on a draft
    // every held row is already fixed work above, so a pin would only reward a
    // pairing the fixed copy makes impossible.
    pinned_assignments: inputs.schedule.status === 'published' ? inputs.pinned : [],
    pairings: inputs.pairings,
    // An empty map rather than an empty array: `preferences` is keyed by employee
    // id on both sides of the wire, and the array literal that used to sit here
    // is half of why the whole problem had to be cast through `as never`. The
    // Python solver defaults the key to `{}` and tests membership, so an empty
    // map and an empty array behaved identically — the type was simply wrong.
    preferences: {},
    constraints: {},
  };
};

/**
 * The assignments already on this schedule that a run must keep and plan
 * around: every held row of a draft, none of a published schedule.
 *
 * The asymmetry follows the persistence paths. A draft's run inserts beside
 * what is there and removes nothing, so whatever is held stays and the solve
 * has to treat it as fact. A published schedule's run proposes a WHOLE new
 * set that replaces the current one on approval, so its rows are not fixed:
 * they are the pinned commitments the solver is asked to keep.
 *
 * Replacing a draft's unpinned rows on every run was the alternative, and was
 * rejected: nothing distinguishes an earlier run's row from one a manager made
 * by hand, and silently deleting manual work is a worse failure than planning
 * around it. A planner who wants a clean re-run clears the draft first.
 */
export const fixedOnThisSchedule = (
  inputs: Pick<ScheduleInputs, 'schedule' | 'held'>
): ScheduleInputs['held'] => (inputs.schedule.status === 'published' ? [] : inputs.held);
