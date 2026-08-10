/**
 * Coverage and pre-existing overcommitment checks.
 *
 * Split out of the former single `constraintValidator.ts` — see that
 * file's header for why a validator exists at all. This module covers
 * staffing-adequacy questions: whether a solved shift met its minimum, and
 * whether an employee was already over a cap before this run even started.
 *
 * @author Luca Ostinelli
 */

import type { OptimizationProblem } from '../types';
import { DAY_MS, dateToMs, shiftHours } from '../shiftTime';
import type { ValidatedAssignment } from './hardConstraints';

/**
 * Per-shift coverage shortfall (assigned below min_staff). Reported separately
 * from violations because a shortfall is a quality signal, not an illegal
 * schedule — the greedy may legitimately fall short where CP-SAT would prove
 * the problem infeasible. Parity tests use this to assert that on *feasible*
 * fixtures both engines reach full coverage, without conflating it with the
 * hard-rule check above.
 */
export function coverageShortfalls(
  problem: OptimizationProblem,
  assignments: ValidatedAssignment[]
): Array<{ shiftId: string; assigned: number; required: number }> {
  const countByShift = new Map<string, number>();
  for (const a of assignments) countByShift.set(a.shiftId, (countByShift.get(a.shiftId) ?? 0) + 1);
  const shortfalls: Array<{ shiftId: string; assigned: number; required: number }> = [];
  for (const shift of problem.shifts) {
    const assigned = countByShift.get(shift.id) ?? 0;
    if (assigned < shift.min_staff) {
      shortfalls.push({ shiftId: shift.id, assigned, required: shift.min_staff });
    }
  }
  return shortfalls;
}

/** An employee who cannot legally take more work before this schedule begins. */
export interface OverCommitment {
  employeeId: string;
  rule: 'daily-hours' | 'weekly-hours' | 'consecutive-days';
  detail: string;
}

/**
 * Employees whose FIXED external work already breaches a cap.
 *
 * WHY THIS IS A SEPARATE FUNCTION FROM findConstraintViolations. That one
 * judges a proposed SOLUTION; this judges the PROBLEM, before any solution
 * exists. The distinction matters because the answer is not "this schedule is
 * illegal" but "this person was already over their limit when we started" —
 * something no assignment decision can repair, and something the planner has
 * to be told rather than have silently absorbed.
 *
 * WHY IT IS THE ONLY DIAGNOSIS THE MODEL NEEDS. Once coverage became a
 * minimised shortfall rather than a hard constraint, assigning NOTHING
 * satisfies every remaining hard rule — `max_staff`, double-booking, minimum
 * rest, the hours caps and consecutive days are all upper bounds an empty
 * schedule meets — and skills and availability produce no constraints at all,
 * since ineligible pairings are never given a variable. So the single
 * remaining way a problem can be unsolvable is `existing_assignments`, the
 * shifts an employee already holds on OTHER schedules, exceeding a limit on
 * their own.
 *
 * That is why this is a deterministic pre-check rather than an unsat core.
 * The condition is decidable in one pass over data already in hand, and yields
 * the employee, the rule and the numbers instead of a set of opaque literals —
 * while assumption literals would disable parts of CP-SAT's presolve on every
 * run to explain a case that should be rare.
 */
export function findOverCommitments(problem: OptimizationProblem): OverCommitment[] {
  const findings: OverCommitment[] = [];

  for (const emp of problem.employees) {
    const external = emp.existing_assignments ?? [];
    if (external.length === 0) continue;

    const dailyBudget = emp.max_hours_per_day ?? Math.max(8, emp.max_hours_per_week / 5);
    const hoursByDate = new Map<string, number>();
    for (const ext of external) {
      hoursByDate.set(ext.date, (hoursByDate.get(ext.date) ?? 0) + shiftHours(ext));
    }
    for (const [date, hours] of [...hoursByDate].sort()) {
      if (hours > dailyBudget + 1e-9) {
        findings.push({
          employeeId: emp.id,
          rule: 'daily-hours',
          detail: `already holds ${hours}h on ${date} from other schedules, exceeding the ${dailyBudget}h daily limit`,
        });
      }
    }

    if (emp.max_hours_per_week) {
      const dated = external.map((ext) => ({
        day: dateToMs(ext.date) / DAY_MS,
        hours: shiftHours(ext),
      }));
      for (const { day } of dated) {
        const window = dated
          .filter((d) => d.day >= day && d.day < day + 7)
          .reduce((sum, d) => sum + d.hours, 0);
        if (window > emp.max_hours_per_week + 1e-9) {
          findings.push({
            employeeId: emp.id,
            rule: 'weekly-hours',
            detail: `already holds ${window}h in a 7-day window on other schedules, exceeding the ${emp.max_hours_per_week}h weekly limit`,
          });
          break;
        }
      }
    }

    if (emp.max_consecutive_days) {
      const days = [...new Set(external.map((ext) => dateToMs(ext.date) / DAY_MS))].sort(
        (a, b) => a - b
      );
      let run = 1;
      for (let i = 1; i < days.length; i += 1) {
        run = days[i] === days[i - 1] + 1 ? run + 1 : 1;
        if (run > emp.max_consecutive_days) {
          findings.push({
            employeeId: emp.id,
            rule: 'consecutive-days',
            detail: `already works ${run} consecutive days on other schedules, exceeding the limit of ${emp.max_consecutive_days}`,
          });
          break;
        }
      }
    }
  }

  return findings;
}
