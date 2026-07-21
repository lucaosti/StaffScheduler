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

import type { OptimizationProblem } from './ScheduleOptimizerORTools';

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

const DAY_MS = 86_400_000;
const DEFAULT_MIN_REST_HOURS = 8;

/** Minutes since midnight for "HH:MM" (or "HH:MM:SS"). */
const timeToMinutes = (time: string): number => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

/** UTC midnight of a "YYYY-MM-DD" date, in ms. */
const dateToMs = (date: string): number => new Date(`${date}T00:00:00Z`).getTime();

interface TimeShift {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
}

/**
 * Absolute [start, end] timestamps for a shift, rolling an overnight shift's
 * end into the following day so a 22:00–06:00 block is a single contiguous
 * interval rather than two fragments. Matches ScheduleOptimizer._shiftBoundsMs.
 */
const shiftBoundsMs = (shift: TimeShift): [number, number] => {
  const day = dateToMs(shift.date);
  const start = day + timeToMinutes(shift.start_time) * 60_000;
  let end = day + timeToMinutes(shift.end_time) * 60_000;
  if (end <= start) end += DAY_MS;
  return [start, end];
};

/** Shift duration in hours, overnight-aware, rounded to 1 decimal (as the greedy). */
const shiftHours = (shift: TimeShift): number => {
  const start = timeToMinutes(shift.start_time);
  let end = timeToMinutes(shift.end_time);
  if (end < start) end += 24 * 60;
  return Math.round(((end - start) / 60) * 10) / 10;
};

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
  const shiftsByEmployee = new Map<string, TimeShift[]>();
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
    const externalShifts: TimeShift[] = (emp.existing_assignments ?? []).map((e, i) => ({
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

    // Daily-hours cap: max(8, max_hours_per_week / 5) per calendar date.
    const dailyBudget = Math.max(8, emp.max_hours_per_week / 5);
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
