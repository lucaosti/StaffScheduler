/**
 * Per-employee shift-timing patterns: how much an employee's own start
 * times bounce around, and whether a night shift is followed too soon by
 * another one.
 *
 * Split out of the former single `constraintValidator.ts` — see that
 * file's header for why a validator exists at all.
 *
 * @author Luca Ostinelli
 */

import type { OptimizationProblem } from '../types';
import { shiftBoundsMs, timeToMinutes } from '../shiftTime';
import { isNightShift } from './equity';
import type { IdentifiedShift, ValidatedAssignment } from './hardConstraints';

/** How much an individual employee's own shift start times vary across the period. */
export interface StartTimeSpread {
  employeeId: string;
  /** Distinct start times (minutes past midnight) the employee was assigned. */
  distinctStartTimes: number;
  /** Max − min start time actually worked, in minutes. */
  spreadMinutes: number;
}

/**
 * How much an employee's shift start times bounce around within the period.
 *
 * WHY THIS IS NOT THE SAME SHAPE AS WEEKEND/NIGHT EQUITY. Those measure the
 * gap BETWEEN employees for a shared category of shift — who loses more
 * weekends than whom. This measures variation WITHIN one employee's own
 * shifts: someone whose start time bounces between 06:00, 14:00 and 22:00
 * across one period has their daily rhythm reshuffled week to week even
 * though every individual shift is otherwise perfectly legal and nobody else
 * is affected. There is no meaningful "spread across the team" version of
 * this question, so it is reported per employee rather than as one team-wide
 * number.
 *
 * WHY MAX − MIN AND NOT A BUCKETED OR STATISTICAL MEASURE. The same choice
 * `weekendSpread`/`nightSpread` already make elsewhere in this family:
 * exactly expressible with no invented boundaries. A bucket scheme (morning/
 * afternoon/night) would need someone to decide where the boundaries sit,
 * which is arbitrary and sector-specific; a standard deviation is harder to
 * read at a glance than "your earliest and latest starts are 16 hours apart."
 *
 * WHY EVERY EMPLOYEE WITH AT LEAST ONE ASSIGNMENT IS REPORTED, WITH NO PASS/
 * FAIL THRESHOLD. There is no working-time-regulation precedent here the way
 * there was for a weekly rest block, so inventing a cutoff would assert a
 * judgment call as if it were policy. Reporting the raw number and leaving the
 * threshold to whoever reads it keeps this a measurement, not an opinion.
 */
export function startTimeSpreads(
  problem: OptimizationProblem,
  assignments: ValidatedAssignment[]
): StartTimeSpread[] {
  const shiftsById = new Map(problem.shifts.map((s) => [s.id, s]));
  const startTimesByEmployee = new Map<string, Set<number>>();

  for (const a of assignments) {
    const shift = shiftsById.get(a.shiftId);
    if (!shift) continue;
    const minutes = timeToMinutes(shift.start_time);
    const times = startTimesByEmployee.get(a.employeeId) ?? new Set<number>();
    times.add(minutes);
    startTimesByEmployee.set(a.employeeId, times);
  }

  const results: StartTimeSpread[] = [];
  for (const emp of problem.employees) {
    const times = startTimesByEmployee.get(emp.id);
    if (!times || times.size === 0) continue;
    const values = [...times];
    results.push({
      employeeId: emp.id,
      distinctStartTimes: values.length,
      spreadMinutes: Math.max(...values) - Math.min(...values),
    });
  }
  return results;
}

/** How long an employee actually rested between a night shift and the one immediately after it. */
export interface IllegalTurnaround {
  employeeId: string;
  /** The night shift that precedes the turnaround. */
  nightShiftId: string;
  /** The shift worked immediately after it. */
  nextShiftId: string;
  /** Rest actually taken between the two, in hours. */
  restHours: number;
  /** Minimum turnaround required after a night shift, in hours. */
  requiredHours: number;
}

/** Minimum rest after a night shift, applied when the problem does not say otherwise. */
export const DEFAULT_NIGHT_TURNAROUND_HOURS = 11;

/**
 * Illegal shift-pattern sequences: specifically, a night shift immediately
 * followed by a morning shift with too little rest between them.
 *
 * WHY THIS IS NOT ALREADY CAUGHT BY `min-rest`. The general minimum-rest hard
 * constraint is calibrated for an ordinary turnaround, not the specific
 * fatigue a night shift leaves behind — a gap that clears the general figure
 * can still be the canonical unsafe pattern (finish a night shift, come back a
 * few hours later for an early morning one) that a rota is expected to avoid.
 * This checks the SAME pair of adjacent shifts against a SEPARATE, normally
 * higher, threshold that only applies when the earlier one was night work.
 *
 * WHY NOT HARD. Made hard, an already-tight rota with one person able to
 * cover the gap becomes unsolvable — the same reasoning that keeps coverage,
 * rest blocks and every other item in this family soft.
 *
 * WHY ONLY THE IMMEDIATELY NEXT SHIFT. The pattern this exists to catch is
 * about adjacency, not general workload — a night shift followed three days
 * later by a morning one is not the same complaint. Shifts are sorted by
 * actual start time and only consecutive pairs are examined, the same way
 * `findConstraintViolations` walks pairwise rest. Work held on OTHER
 * schedules is included in the sort, since the fatigue and the following
 * shift are real regardless of which schedule either one belongs to.
 *
 * Overlapping or double-booked pairs are skipped here — `findConstraintViolations`
 * already reports those as `double-booking`, and a negative gap is not "not
 * enough rest", it is a different, harder problem.
 */
export function illegalTurnarounds(
  problem: OptimizationProblem,
  assignments: ValidatedAssignment[]
): IllegalTurnaround[] {
  const findings: IllegalTurnaround[] = [];
  const shiftsById = new Map(problem.shifts.map((s) => [s.id, s]));
  const requiredHours =
    typeof problem.constraints?.min_hours_after_night_shift === 'number'
      ? problem.constraints.min_hours_after_night_shift
      : DEFAULT_NIGHT_TURNAROUND_HOURS;

  const decisionShiftsByEmployee = new Map<string, IdentifiedShift[]>();
  for (const a of assignments) {
    const shift = shiftsById.get(a.shiftId);
    if (!shift) continue;
    const list = decisionShiftsByEmployee.get(a.employeeId) ?? [];
    list.push(shift);
    decisionShiftsByEmployee.set(a.employeeId, list);
  }

  for (const emp of problem.employees) {
    const decisionShifts = decisionShiftsByEmployee.get(emp.id) ?? [];
    const externalShifts: IdentifiedShift[] = (emp.existing_assignments ?? []).map((e, i) => ({
      id: `ext:${emp.id}:${i}`,
      date: e.date,
      start_time: e.start_time,
      end_time: e.end_time,
    }));
    const worked = [...decisionShifts, ...externalShifts].sort(
      (a, b) => shiftBoundsMs(a)[0] - shiftBoundsMs(b)[0]
    );

    for (let i = 0; i < worked.length - 1; i++) {
      if (!isNightShift(problem, worked[i])) continue;
      const [, nightEnd] = shiftBoundsMs(worked[i]);
      const [nextStart] = shiftBoundsMs(worked[i + 1]);
      const restHours = (nextStart - nightEnd) / 3_600_000;
      if (restHours < 0) continue; // overlap — a different problem, reported elsewhere
      if (restHours < requiredHours) {
        findings.push({
          employeeId: emp.id,
          nightShiftId: worked[i].id,
          nextShiftId: worked[i + 1].id,
          restHours: Math.round(restHours * 10) / 10,
          requiredHours,
        });
      }
    }
  }

  return findings;
}
