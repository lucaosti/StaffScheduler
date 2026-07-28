/**
 * Canonical schedule-constraint validator — the single source of truth for
 * what a "valid" staff schedule is.
 *
 * WHY THIS EXISTS
 * ---------------
 * The scheduling constraints used to live in two independent implementations:
 * the Python CP-SAT model (optimization-scripts/schedule_optimizer.py) and the
 * TypeScript greedy fallback (ScheduleOptimizerORTools.evaluateCandidate). Each
 * decided for itself what "legal" meant, and the two drifted — the greedy
 * enforced minimum rest, a daily-hours cap, a rolling weekly-hours window and a
 * hard consecutive-days limit that the CP-SAT model simply did not have. A
 * schedule the greedy path rejected could be produced by the OR-Tools path and
 * vice-versa, silently, with no test able to see it.
 *
 * The fix is to stop expressing the constraint set as solver logic and express
 * it once, declaratively, as a *checker over a finished solution*. A checker is
 * the right shape here because it is engine-agnostic: it takes a problem and a
 * flat list of assignments and reports every rule the solution breaks, no
 * matter which engine produced them. Both engines are now measured against this
 * one definition (see optimizer.parity.test.ts), so any future divergence
 * becomes a red test instead of a production surprise. Encoding the rules as a
 * validator rather than re-deriving them inside each solver also keeps the
 * definition auditable in a single ~200-line file a reviewer can read top to
 * bottom.
 *
 * WHY A VALIDATOR AND NOT A SHARED SOLVER
 * ---------------------------------------
 * The two engines legitimately differ in *how* they search: CP-SAT is a global
 * optimizer that treats coverage as a hard constraint (and can therefore report
 * a problem INFEASIBLE), while the greedy is a deterministic best-effort pass
 * that fills what it can. Forcing them to share search logic would erase that
 * intended difference. What must NOT differ is the set of hard rules a produced
 * solution obeys. So parity is asserted on *validity of the output*, never on
 * identical assignments or identical coverage.
 *
 * The rules below mirror, one-for-one and in the same order, the hard
 * constraints in ScheduleOptimizerORTools.evaluateCandidate. Any change to the
 * constraint model must be made here first; the engines are then aligned to
 * keep the parity suite green.
 *
 * @author Luca Ostinelli
 */

import type { OptimizationProblem } from './types';
import { DAY_MS, dateToMs, shiftBoundsMs, shiftHours } from './shiftTime';
import type { ShiftTimes } from './shiftTime';

/**
 * A shift the validator can name in a violation.
 *
 * `ShiftTimes` deliberately carries only what the arithmetic needs, because it
 * is also applied to an employee's `existing_assignments`, which have no id.
 * Those get a synthetic one here so a violation can point at them.
 */
interface IdentifiedShift extends ShiftTimes {
  id: string;
}

/** A single rule broken by a proposed solution, with enough context to debug. */
export interface ConstraintViolation {
  /** Stable machine-readable rule identifier (see RULES below). */
  rule:
    | 'staff-cap'
    | 'double-booking'
    | 'min-rest'
    | 'unavailability'
    | 'skill'
    | 'daily-hours'
    | 'weekly-hours'
    | 'consecutive-days';
  employeeId: string;
  /** Shift(s) implicated. One id for single-shift rules, two for pairwise ones. */
  shiftIds: string[];
  /** Human-readable explanation for test output and logs. */
  detail: string;
}

/** One assignment to validate, in the neutral shape both engines can emit. */
export interface ValidatedAssignment {
  employeeId: string;
  shiftId: string;
}

const DEFAULT_MIN_REST_HOURS = 8;

/**
 * Shift time arithmetic comes from ./shiftTime, which both engines share.
 * These used to be private copies here and in ScheduleOptimizerORTools, kept
 * in step by a comment — and a comment is not a mechanism for a rule this
 * file is supposed to be the single source of truth about.
 */

/**
 * Report every hard-constraint violation in a proposed solution.
 *
 * An empty array means the solution is legal under the canonical model. The
 * function is pure and side-effect free so it can validate the output of any
 * engine — real or mocked — without touching a database.
 *
 * Coverage (assigning at least `min_staff` per shift) is deliberately NOT a
 * violation here: the greedy is best-effort and may legitimately leave a shift
 * short when no eligible employee exists, whereas CP-SAT treats it as hard.
 * Under-coverage is a quality metric (see coverageShortfalls), not an illegal
 * schedule; over-coverage past `max_staff` IS illegal and is checked.
 *
 * @param problem     the same problem shape fed to either engine
 * @param assignments the flat solution to check
 */
export function findConstraintViolations(
  problem: OptimizationProblem,
  assignments: ValidatedAssignment[]
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  const shiftsById = new Map(problem.shifts.map((s) => [s.id, s]));
  const employeesById = new Map(problem.employees.map((e) => [e.id, e]));

  const minRestHours =
    typeof problem.constraints?.min_hours_between_shifts === 'number'
      ? problem.constraints.min_hours_between_shifts
      : DEFAULT_MIN_REST_HOURS;

  // Group the decision assignments by employee, resolving each to its shift.
  const shiftsByEmployee = new Map<string, IdentifiedShift[]>();
  for (const emp of problem.employees) shiftsByEmployee.set(emp.id, []);

  for (const a of assignments) {
    const shift = shiftsById.get(a.shiftId);
    const employee = employeesById.get(a.employeeId);
    if (!shift || !employee) {
      // An assignment referencing an unknown shift/employee is itself invalid.
      violations.push({
        rule: 'double-booking',
        employeeId: a.employeeId,
        shiftIds: [a.shiftId],
        detail: `assignment references unknown ${shift ? 'employee' : 'shift'}`,
      });
      continue;
    }
    shiftsByEmployee.get(a.employeeId)!.push(shift);
  }

  // Per-shift staff cap (over-coverage past max_staff).
  const countByShift = new Map<string, number>();
  for (const a of assignments) countByShift.set(a.shiftId, (countByShift.get(a.shiftId) ?? 0) + 1);
  for (const shift of problem.shifts) {
    const count = countByShift.get(shift.id) ?? 0;
    if (shift.max_staff !== undefined && count > shift.max_staff) {
      violations.push({
        rule: 'staff-cap',
        employeeId: '',
        shiftIds: [shift.id],
        detail: `shift ${shift.id} has ${count} assignments, exceeds max_staff ${shift.max_staff}`,
      });
    }
  }

  // Per-employee rules. Each employee's *decision* shifts are combined with any
  // fixed external assignments (shifts held on other schedules) so cross-period
  // load is checked exactly as the engines are expected to check it.
  for (const emp of problem.employees) {
    const decisionShifts = shiftsByEmployee.get(emp.id) ?? [];
    const externalShifts: IdentifiedShift[] = (emp.existing_assignments ?? []).map((e, i) => ({
      id: `ext:${emp.id}:${i}`,
      date: e.date,
      start_time: e.start_time,
      end_time: e.end_time,
    }));
    const worked = [...decisionShifts, ...externalShifts];

    // Unavailability + skills — single-shift rules, decision shifts only
    // (external shifts are immutable facts, not something this run chose).
    for (const shift of decisionShifts) {
      if (emp.unavailable_dates.includes(shift.date)) {
        violations.push({
          rule: 'unavailability',
          employeeId: emp.id,
          shiftIds: [shift.id],
          detail: `employee ${emp.id} assigned on unavailable date ${shift.date}`,
        });
      }
      const empSkills = new Set(emp.skills);
      for (const skill of shiftsById.get(shift.id)?.required_skills ?? []) {
        if (!empSkills.has(skill)) {
          violations.push({
            rule: 'skill',
            employeeId: emp.id,
            shiftIds: [shift.id],
            detail: `employee ${emp.id} lacks required skill "${skill}" for shift ${shift.id}`,
          });
        }
      }
    }

    // Pairwise rules: double-booking (time overlap) and minimum rest.
    for (let i = 0; i < worked.length; i++) {
      const [aStart, aEnd] = shiftBoundsMs(worked[i]);
      for (let j = i + 1; j < worked.length; j++) {
        const [bStart, bEnd] = shiftBoundsMs(worked[j]);
        const overlap = aStart < bEnd && bStart < aEnd;
        if (overlap) {
          violations.push({
            rule: 'double-booking',
            employeeId: emp.id,
            shiftIds: [worked[i].id, worked[j].id],
            detail: `employee ${emp.id} double-booked on overlapping shifts ${worked[i].id} and ${worked[j].id}`,
          });
          continue; // overlap and rest are mutually exclusive; don't double-count
        }
        const restMs = aEnd <= bStart ? bStart - aEnd : aStart - bEnd;
        if (restMs / 3_600_000 < minRestHours) {
          violations.push({
            rule: 'min-rest',
            employeeId: emp.id,
            shiftIds: [worked[i].id, worked[j].id],
            detail: `employee ${emp.id} has ${(restMs / 3_600_000).toFixed(1)}h rest between ${worked[i].id} and ${worked[j].id}, below ${minRestHours}h`,
          });
        }
      }
    }

    // Daily-hours cap per calendar date.
    //
    // Prefers the contract's stored value. The fallback — max(8, weekly / 5) —
    // is what every engine used to compute unconditionally, and it was never a
    // rule anyone agreed to: it appears in no contract, no policy table and no
    // documentation as a decision, while being enforced as a hard constraint
    // against real people. It stays only so an un-migrated caller keeps its
    // existing behaviour, and should be removed once every problem carries a
    // contract-derived cap.
    const dailyBudget = emp.max_hours_per_day ?? Math.max(8, emp.max_hours_per_week / 5);
    const hoursByDate = new Map<string, number>();
    for (const shift of worked) {
      hoursByDate.set(shift.date, (hoursByDate.get(shift.date) ?? 0) + shiftHours(shift));
    }
    for (const [date, hours] of hoursByDate) {
      if (hours > dailyBudget + 1e-9) {
        violations.push({
          rule: 'daily-hours',
          employeeId: emp.id,
          shiftIds: worked.filter((s) => s.date === date).map((s) => s.id),
          detail: `employee ${emp.id} works ${hours}h on ${date}, exceeds daily budget ${dailyBudget}h`,
        });
      }
    }

    // Weekly-hours cap: any 7-consecutive-day window must stay within
    // max_hours_per_week. Forward window [d, d+7) over each worked day — a
    // subset of the greedy's centred check, so a greedy solution always passes.
    if (emp.max_hours_per_week) {
      const days = [...new Set(worked.map((s) => s.date))].sort();
      for (const anchor of days) {
        const anchorMs = dateToMs(anchor);
        let total = 0;
        for (const shift of worked) {
          const diff = (dateToMs(shift.date) - anchorMs) / DAY_MS;
          if (diff >= 0 && diff < 7) total += shiftHours(shift);
        }
        if (total > emp.max_hours_per_week + 1e-9) {
          violations.push({
            rule: 'weekly-hours',
            employeeId: emp.id,
            shiftIds: worked
              .filter((s) => {
                const diff = (dateToMs(s.date) - anchorMs) / DAY_MS;
                return diff >= 0 && diff < 7;
              })
              .map((s) => s.id),
            detail: `employee ${emp.id} works ${total}h in the week starting ${anchor}, exceeds ${emp.max_hours_per_week}h`,
          });
          break; // one weekly violation per employee is enough to fail
        }
      }
    }

    // Consecutive-days cap: longest run of back-to-back worked dates.
    const maxConsec = emp.max_consecutive_days;
    if (maxConsec) {
      const sortedMs = [...new Set(worked.map((s) => s.date))]
        .map(dateToMs)
        .sort((a, b) => a - b);
      let longest = sortedMs.length > 0 ? 1 : 0;
      let run = longest;
      for (let i = 1; i < sortedMs.length; i++) {
        run = (sortedMs[i] - sortedMs[i - 1]) / DAY_MS === 1 ? run + 1 : 1;
        longest = Math.max(longest, run);
      }
      if (longest > maxConsec) {
        violations.push({
          rule: 'consecutive-days',
          employeeId: emp.id,
          shiftIds: worked.map((s) => s.id),
          detail: `employee ${emp.id} works ${longest} consecutive days, exceeds ${maxConsec}`,
        });
      }
    }
  }

  return violations;
}

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
