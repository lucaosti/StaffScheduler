/**
 * Weekend/night category equity: who loses which kind of day, and whether
 * the same person keeps holding a category period after period.
 *
 * Split out of the former single `constraintValidator.ts` — see that
 * file's header for why a validator exists at all. `isWeekendDay`/
 * `isNightWork` are the canonical definitions of "weekend" and "night" —
 * also used outside a `problem` (e.g. `Employee.carried_load`), so they take
 * their inputs directly rather than reading `problem.constraints`.
 *
 * @author Luca Ostinelli
 */

import type { OptimizationProblem } from '../types';
import { timeToMinutes } from '../shiftTime';
import type { ShiftTimes } from '../shiftTime';
import type { ValidatedAssignment } from './hardConstraints';

/** Default weekend, applied when the problem does not say otherwise. */
export const DEFAULT_WEEKEND_DAYS = [0, 6];

/** Default night window, applied when the problem does not say otherwise. */
export const DEFAULT_NIGHT_WINDOW = { start: '22:00', end: '06:00' };

/** How many days of some shift category each employee ends up working. */
export interface CategoryLoad {
  employeeId: string;
  days: number;
}

/**
 * Whether a date falls on a configured weekend day (`0` = Sunday).
 *
 * Exported in this problem-free form because the same question is asked of
 * history that predates the problem — the carried equity load in
 * `Employee.carried_load` classifies shifts from earlier schedules, which are
 * not in `problem.shifts`. Re-deriving "what counts as a weekend" there would
 * be a second authority on it, and this file is the one.
 */
export const isWeekendDay = (date: string, weekendDays?: number[]): boolean => {
  const days = new Set(weekendDays ?? DEFAULT_WEEKEND_DAYS);
  return days.has(new Date(`${date}T00:00:00Z`).getUTCDay());
};

const isWeekendDate = (problem: OptimizationProblem, date: string): boolean =>
  isWeekendDay(date, problem.constraints?.weekend_days);

/**
 * Whether a shift overlaps the configured night window.
 *
 * OVERLAP, NOT START TIME. A start-time threshold is simpler and wrong at the
 * edges: 22:00–06:00 and 02:00–10:00 are both night work, but only the first
 * starts "late". Overlap catches both, and it is the definition someone
 * working the shift would recognise.
 */
export const isNightWork = (
  shift: ShiftTimes,
  nightWindow?: { start: string; end: string }
): boolean => {
  const window = nightWindow ?? DEFAULT_NIGHT_WINDOW;
  const nightStart = timeToMinutes(window.start);
  const nightEnd = timeToMinutes(window.end);
  const start = timeToMinutes(shift.start_time);
  let end = timeToMinutes(shift.end_time);
  if (end <= start) end += 24 * 60;

  // The window usually wraps midnight, so the occurrence that catches an
  // early-morning shift is the one that STARTED THE PREVIOUS DAY — 22:00
  // yesterday through 06:00 today. Testing only forward offsets missed
  // 02:00–10:00 entirely, which is the case the overlap definition exists for.
  for (const offset of [-24 * 60, 0, 24 * 60]) {
    const wStart = nightStart + offset;
    const wEnd = nightEnd + offset + (nightEnd <= nightStart ? 24 * 60 : 0);
    if (start < wEnd && end > wStart) return true;
  }
  return false;
};

/**
 * Whether a shift is night work under the problem's own configured window —
 * exported (not private) because `illegalTurnarounds` needs the same
 * classification and there must be one authority on it, not a second copy.
 */
export const isNightShift = (problem: OptimizationProblem, shift: ShiftTimes): boolean =>
  isNightWork(shift, problem.constraints?.night_window);

/**
 * Days of a given shift category worked per employee.
 *
 * WHY A CATEGORY AND NOT ONE FUNCTION PER KIND. Weekend equity and night
 * equity ask the same question of different shifts: who loses which days. Two
 * such measures would be a coincidence; a third copy would be a pattern, and
 * this mechanism has already been got wrong twice in the objective it feeds.
 *
 * WHY THE HOURS FAIRNESS DOES NOT COVER EITHER. That balances how MANY hours
 * people work; this balances WHICH hours. A schedule can be perfectly even by
 * total load while one person works every weekend, or every night, and another
 * works none — to an hours-only measure a Sunday hour and a Tuesday hour are
 * the same hour. It is also the complaint that actually gets raised, and
 * usually by whoever is most available, because that is exactly who a
 * scheduler with no such term keeps assigning.
 *
 * WHY DAYS AND NOT HOURS. The unit is what the person loses: a four-hour
 * Sunday shift costs the day either way. Two matching shifts on one date cost
 * one day, not two. Work held on other schedules counts, because the day is
 * gone regardless of which schedule took it.
 */
export function categoryLoads(
  problem: OptimizationProblem,
  assignments: ValidatedAssignment[],
  matches: (shift: ShiftTimes) => boolean,
  carried?: 'weekend' | 'night'
): CategoryLoad[] {
  const shiftsById = new Map(problem.shifts.map((s) => [s.id, s]));

  return problem.employees.map((emp) => {
    const days = new Set<string>();
    for (const a of assignments) {
      if (a.employeeId !== emp.id) continue;
      const shift = shiftsById.get(a.shiftId);
      if (shift && matches(shift)) days.add(shift.date);
    }
    for (const ext of emp.existing_assignments ?? []) {
      if (matches(ext)) days.add(ext.date);
    }
    // History from BEFORE this period, so equity is measured across months
    // rather than reset by each one. Added to the load rather than compared
    // separately: the spread already answers "who is losing more days", and
    // the only thing wrong with it was that it started counting today.
    const before = (carried && emp.carried_load?.[carried]) ?? 0;
    return { employeeId: emp.id, days: days.size + before };
  });
}

/** Gap between the most and least loaded employee for a category. */
const spreadOf = (loads: CategoryLoad[]): number =>
  loads.length === 0 ? 0 : Math.max(...loads.map((l) => l.days)) - Math.min(...loads.map((l) => l.days));

/** Weekend days worked per employee. */
export const weekendLoads = (
  problem: OptimizationProblem,
  assignments: ValidatedAssignment[]
): CategoryLoad[] =>
  categoryLoads(problem, assignments, (s) => isWeekendDate(problem, s.date), 'weekend');

/** Night days worked per employee. */
export const nightLoads = (
  problem: OptimizationProblem,
  assignments: ValidatedAssignment[]
): CategoryLoad[] => categoryLoads(problem, assignments, (s) => isNightShift(problem, s), 'night');

/**
 * Gap between the most and least weekend-loaded employee.
 *
 * Reported rather than judged: like coverage and rest blocks, this is a
 * quality signal and not a legality question, and neither engine is required
 * to drive it to zero — the greedy cannot, having no global view.
 */
export const weekendSpread = (
  problem: OptimizationProblem,
  assignments: ValidatedAssignment[]
): number => spreadOf(weekendLoads(problem, assignments));

/** Gap between the most and least night-loaded employee. */
export const nightSpread = (
  problem: OptimizationProblem,
  assignments: ValidatedAssignment[]
): number => spreadOf(nightLoads(problem, assignments));

/** An employee kept on the same shift category for too many periods running. */
export interface ShiftRotationViolation {
  employeeId: string;
  category: 'weekend' | 'night';
  /** Consecutive PUBLISHED predecessor periods this employee already held the category, before this one. */
  consecutivePeriods: number;
  /** `max_consecutive_category_periods` in effect when this was flagged. */
  threshold: number;
}

/** How many consecutive periods on a category trip the rotation goal, applied when the problem does not say otherwise. */
export const DEFAULT_MAX_CONSECUTIVE_CATEGORY_PERIODS = 2;

/**
 * An employee assigned to a category (weekend/night) this period whose
 * `consecutive_category_periods[category]` already meets or exceeds the
 * configured threshold — the same person holding the category again,
 * without a break, one period too many.
 *
 * WHY THIS IS A DIFFERENT PROPERTY FROM `weekendSpread`/`nightSpread`.
 * Those minimise the TOTAL spread of category days across employees over
 * the history horizon — they can be perfectly balanced in total while one
 * person still works nights for three straight periods and another has the
 * inverse pattern, because a spread measure has no notion of adjacency
 * between periods. This checks CONSECUTIVE-PERIOD CONCENTRATION on the same
 * person, independent of the running total: equity asks "is it even
 * overall", this asks "is the same person on it again, right now".
 *
 * WHY SOFT. Made hard, an organization with too few night- or weekend-
 * qualified staff to always rotate becomes unsolvable — the same reasoning
 * that keeps coverage, rest blocks and the rest of this family soft. The
 * existing equity constraint already provides real pressure toward
 * fairness; this adds temporal-adjacency pressure on top of it without
 * making an otherwise-legal schedule illegal.
 *
 * WHY "AT LEAST ONE DAY THIS PERIOD" AND NOT A COUNT. `consecutive_category_periods`
 * is itself a period-level count (see its doc comment in types.ts) — whether
 * a period "counts" toward the streak is a yes/no question per period, not a
 * days-worked question, so continuing the streak this period only needs one
 * qualifying day, the same test `AutoScheduleService`'s history walk applies
 * to each predecessor period.
 */
export function shiftRotationViolations(
  problem: OptimizationProblem,
  assignments: ValidatedAssignment[]
): ShiftRotationViolation[] {
  const threshold =
    typeof problem.constraints?.max_consecutive_category_periods === 'number'
      ? problem.constraints.max_consecutive_category_periods
      : DEFAULT_MAX_CONSECUTIVE_CATEGORY_PERIODS;

  const findings: ShiftRotationViolation[] = [];
  const categories: Array<{
    category: 'weekend' | 'night';
    matches: (shift: ShiftTimes) => boolean;
  }> = [
    { category: 'weekend', matches: (s) => isWeekendDate(problem, s.date) },
    { category: 'night', matches: (s) => isNightShift(problem, s) },
  ];

  for (const { category, matches } of categories) {
    // Current period only — carried history already lives in
    // `consecutive_category_periods`, not in this count.
    const loads = categoryLoads(problem, assignments, matches);
    for (const load of loads) {
      if (load.days === 0) continue;
      const emp = problem.employees.find((e) => e.id === load.employeeId);
      const consecutivePeriods = emp?.consecutive_category_periods?.[category] ?? 0;
      if (consecutivePeriods >= threshold) {
        findings.push({ employeeId: load.employeeId, category, consecutivePeriods, threshold });
      }
    }
  }

  return findings;
}
