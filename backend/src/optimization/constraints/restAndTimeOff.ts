/**
 * Rest and time-off soft goals: weekly rest blocks, shifts adjacent to
 * approved absences, and total days-off rate.
 *
 * Split out of the former single `constraintValidator.ts` — see that
 * file's header for why a validator exists at all. Each function here is a
 * SOFT goal (reported, not a violation): made hard, an understaffed period
 * would become unsolvable, the same reasoning documented on each function
 * below.
 *
 * @author Luca Ostinelli
 */

import type { OptimizationProblem } from '../types';
import { DAY_MS, dateToMs } from '../shiftTime';
import type { ValidatedAssignment } from './hardConstraints';

/** A 7-day window in which an employee never got a long enough rest block. */
export interface RestShortfall {
  employeeId: string;
  /** First day of the window, "YYYY-MM-DD". */
  windowStart: string;
  /** Consecutive days off the contract asks for. */
  required: number;
  /** Longest run of consecutive days off actually available in the window. */
  longestRest: number;
}

/**
 * Windows where an employee never gets `min_consecutive_days_off` in a row.
 *
 * WHY THIS IS SEPARATE FROM THE CONSECUTIVE-DAYS CAP. `max_consecutive_days`
 * bounds how long someone works without a break; it says nothing about the
 * break. A schedule of five-on, one-off, five-on, one-off satisfies it
 * completely while the person never gets two days together — which is the
 * difference between "not overworked" and "rested", and only the first was
 * modelled. Two separate single days is not a weekend.
 *
 * WHY A ROLLING 7-DAY WINDOW, AND WHY "AT LEAST ONE BLOCK". Two weaker
 * quantifiers were considered. Requiring EVERY rest run to reach the length
 * forbids a single day off outright, which is often fine and sometimes
 * requested. Requiring one block per schedule PERIOD is meaningless over a
 * month. One block per rolling week is the formulation working-time
 * regulations use, and it is the one that matches what people mean by a
 * weekend.
 *
 * WHY REPORTED RATHER THAN A VIOLATION. This is a SOFT goal. Made hard, an
 * understaffed period becomes unsolvable — and #448 settled that refusing to
 * answer is the wrong response to insufficient staff. Both engines are
 * measured by this; neither is required to reach zero.
 *
 * Days outside the schedule's own span are not counted as rest: a window
 * running past the end of the period would otherwise show a free block that
 * is really just absence of data.
 */
export function restShortfalls(
  problem: OptimizationProblem,
  assignments: ValidatedAssignment[]
): RestShortfall[] {
  const shortfalls: RestShortfall[] = [];
  const shiftsById = new Map(problem.shifts.map((s) => [s.id, s]));

  const allDays = [...new Set(problem.shifts.map((s) => s.date))].sort();
  if (allDays.length === 0) return shortfalls;
  const firstDay = dateToMs(allDays[0]) / DAY_MS;
  const lastDay = dateToMs(allDays[allDays.length - 1]) / DAY_MS;

  for (const emp of problem.employees) {
    const required = emp.min_consecutive_days_off;
    if (!required) continue;

    const workedDays = new Set<number>();
    for (const a of assignments) {
      if (a.employeeId !== emp.id) continue;
      const shift = shiftsById.get(a.shiftId);
      if (shift) workedDays.add(dateToMs(shift.date) / DAY_MS);
    }
    // Work on other schedules occupies the day just as much.
    for (const ext of emp.existing_assignments ?? []) {
      workedDays.add(dateToMs(ext.date) / DAY_MS);
    }

    // Only windows that fit entirely inside the period are judged.
    for (let start = firstDay; start + 6 <= lastDay; start += 1) {
      let longest = 0;
      let run = 0;
      for (let d = start; d <= start + 6; d += 1) {
        run = workedDays.has(d) ? 0 : run + 1;
        if (run > longest) longest = run;
      }
      if (longest < required) {
        shortfalls.push({
          employeeId: emp.id,
          windowStart: new Date(start * DAY_MS).toISOString().slice(0, 10),
          required,
          longestRest: longest,
        });
      }
    }
  }

  return shortfalls;
}

/** A shift scheduled on the day immediately before or after the employee's own approved time off. */
export interface TimeOffAdjacency {
  employeeId: string;
  shiftId: string;
  /** Date of the shift that abuts the absence. */
  shiftDate: string;
  /** Date of the approved absence it sits next to. */
  timeOffDate: string;
  /** Whether the absence falls the day before or the day after the shift. */
  timeOffSide: 'before' | 'after';
}

/**
 * Shifts worked the day immediately before or after an employee's own
 * approved time off.
 *
 * WHY THIS IS SEPARATE FROM `unavailability`. That rule rejects a shift ON a
 * day the employee is unavailable — it says nothing about the days framing
 * one. An approved absence is meant to be uninterrupted time away, and
 * scheduling the eve or the return day back-to-back with it erodes that even
 * though neither shift falls on the covered date itself.
 *
 * WHY SOFT. Forbidding it outright can make an already-tight period
 * infeasible — the same reasoning that keeps coverage and rest blocks soft.
 * Both engines are measured by this; neither is required to reach zero.
 *
 * Only the employee's OWN unavailable dates are considered — the same field
 * `unavailability` already reads for the hard check, not a second source.
 */
export function timeOffAdjacencies(
  problem: OptimizationProblem,
  assignments: ValidatedAssignment[]
): TimeOffAdjacency[] {
  const findings: TimeOffAdjacency[] = [];
  const shiftsById = new Map(problem.shifts.map((s) => [s.id, s]));

  for (const emp of problem.employees) {
    if (!emp.unavailable_dates?.length) continue;
    const offDays = new Set(emp.unavailable_dates);

    for (const a of assignments) {
      if (a.employeeId !== emp.id) continue;
      const shift = shiftsById.get(a.shiftId);
      if (!shift) continue;

      const shiftDayMs = dateToMs(shift.date);
      const dayBefore = new Date(shiftDayMs - DAY_MS).toISOString().slice(0, 10);
      const dayAfter = new Date(shiftDayMs + DAY_MS).toISOString().slice(0, 10);

      if (offDays.has(dayBefore)) {
        findings.push({
          employeeId: emp.id,
          shiftId: shift.id,
          shiftDate: shift.date,
          timeOffDate: dayBefore,
          timeOffSide: 'before',
        });
      }
      if (offDays.has(dayAfter)) {
        findings.push({
          employeeId: emp.id,
          shiftId: shift.id,
          shiftDate: shift.date,
          timeOffDate: dayAfter,
          timeOffSide: 'after',
        });
      }
    }
  }

  return findings;
}

/** How far an employee's total days off in the period falls short of the contract's rate. */
export interface DaysOffShortfall {
  employeeId: string;
  /** Distinct days spanned by the schedule's own shifts. */
  periodDays: number;
  /** `min_days_off_per_period` prorated to `periodDays`, rounded up. */
  required: number;
  /** Days off actually achieved in the period. */
  actual: number;
}

/**
 * Whether each employee gets enough days off in TOTAL across the period,
 * however they're distributed.
 *
 * WHY THIS IS SEPARATE FROM `restShortfalls`. That rule asks for one
 * consecutive rest BLOCK per rolling 7-day window and says nothing about the
 * total — a contract can guarantee a weekend every week while staying silent
 * on whether four weeks of exactly one rest day each adds up to enough time
 * off overall. This rule asks the opposite question: a plain count, blind to
 * how it's distributed. A schedule can satisfy one without the other.
 *
 * WHY THE CONTRACT STORES A RATE, NOT AN ABSOLUTE COUNT. A contract has no
 * fixed schedule length to be absolute about — the period is decided per run.
 * `min_days_off_per_period` is a rate per 7-day reference period, prorated
 * here against whatever the schedule's own span turns out to be
 * (`ceil(rate * periodDays / 7)`), the same way `min_consecutive_days_off` is
 * evaluated against whatever period the schedule spans rather than a fixed
 * one.
 *
 * WHY SOFT. Made hard, an understaffed period becomes unsolvable — the same
 * reasoning that keeps coverage and rest blocks soft. Both engines are
 * measured by this; neither is required to reach zero.
 */
export function daysOffShortfalls(
  problem: OptimizationProblem,
  assignments: ValidatedAssignment[]
): DaysOffShortfall[] {
  const shortfalls: DaysOffShortfall[] = [];
  const shiftsById = new Map(problem.shifts.map((s) => [s.id, s]));

  const allDays = [...new Set(problem.shifts.map((s) => s.date))].sort();
  if (allDays.length === 0) return shortfalls;
  const firstDay = dateToMs(allDays[0]) / DAY_MS;
  const lastDay = dateToMs(allDays[allDays.length - 1]) / DAY_MS;
  const periodDays = lastDay - firstDay + 1;

  for (const emp of problem.employees) {
    const rate = emp.min_days_off_per_period;
    if (!rate) continue;
    const required = Math.ceil((rate * periodDays) / 7);

    const workedDays = new Set<number>();
    for (const a of assignments) {
      if (a.employeeId !== emp.id) continue;
      const shift = shiftsById.get(a.shiftId);
      if (shift) workedDays.add(dateToMs(shift.date) / DAY_MS);
    }
    // Work on other schedules occupies the day just as much — but only the
    // portion that actually falls inside this period's own span; an external
    // shift outside it says nothing about this period's days off.
    for (const ext of emp.existing_assignments ?? []) {
      const extDay = dateToMs(ext.date) / DAY_MS;
      if (extDay >= firstDay && extDay <= lastDay) workedDays.add(extDay);
    }

    const actual = periodDays - workedDays.size;
    if (actual < required) {
      shortfalls.push({ employeeId: emp.id, periodDays, required, actual });
    }
  }

  return shortfalls;
}
