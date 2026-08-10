/**
 * Hard-constraint checker — the rules a solution MUST obey to be legal.
 *
 * Split out of the former single `constraintValidator.ts` (see that file's
 * header, now `optimization/constraintValidator.ts`, for why a validator
 * exists at all and why both engines are measured against it). This module
 * is the one function that walks every assignment in a single pass —
 * staff-cap, double-booking, minimum rest, unavailability, skills, the
 * hours/consecutive-days caps, and pairing rules — because those checks
 * share the same per-employee grouping of decision + external shifts and
 * splitting them further would duplicate that grouping rather than clarify
 * anything.
 *
 * @author Luca Ostinelli
 */

import type { OptimizationProblem } from '../types';
import { DAY_MS, dateToMs, shiftBoundsMs, shiftHours } from '../shiftTime';
import type { ShiftTimes } from '../shiftTime';

/**
 * A shift the validator can name in a violation.
 *
 * `ShiftTimes` deliberately carries only what the arithmetic needs, because it
 * is also applied to an employee's `existing_assignments`, which have no id.
 * Those get a synthetic one here so a violation can point at them.
 */
export interface IdentifiedShift extends ShiftTimes {
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
    | 'consecutive-days'
    | 'pairing';
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
      const shiftDef = shiftsById.get(shift.id);
      for (const skill of shiftDef?.required_skills ?? []) {
        // An absent requirement means any level will do, and an absent level
        // on the employee means "unknown" rather than "novice" — so a caller
        // that supplies no levels behaves exactly as before this existed.
        const required = shiftDef?.required_skill_levels?.[skill];
        const held = emp.skill_levels?.[skill];
        const underQualified = required !== undefined && held !== undefined && held < required;
        if (!empSkills.has(skill) || underQualified) {
          violations.push({
            rule: 'skill',
            employeeId: emp.id,
            shiftIds: [shift.id],
            detail: underQualified
              ? `employee ${emp.id} holds "${skill}" at level ${held}, below the level ${required} shift ${shift.id} requires`
              : `employee ${emp.id} lacks required skill "${skill}" for shift ${shift.id}`,
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

  // Pairing rules — about who shares a shift, so checked per shift rather than
  // per employee. Unlike skills or availability these cannot be resolved into
  // eligibility, because whether a pairing is legal depends on who ELSE was
  // assigned; they are genuine constraints, not a filter.
  const assigneesByShift = new Map<string, Set<string>>();
  for (const a of assignments) {
    if (!assigneesByShift.has(a.shiftId)) assigneesByShift.set(a.shiftId, new Set());
    assigneesByShift.get(a.shiftId)!.add(a.employeeId);
  }

  for (const rule of problem.pairings ?? []) {
    for (const [shiftId, assignees] of assigneesByShift) {
      if (rule.kind === 'apart') {
        if (assignees.has(rule.employee_id) && assignees.has(rule.other_id)) {
          violations.push({
            rule: 'pairing',
            employeeId: rule.employee_id,
            shiftIds: [shiftId],
            detail: `employees ${rule.employee_id} and ${rule.other_id} must not share shift ${shiftId}`,
          });
        }
      } else if (assignees.has(rule.employee_id) && !assignees.has(rule.other_id)) {
        // Directional: the dependent may not work without the other, but the
        // other is free to work alone.
        violations.push({
          rule: 'pairing',
          employeeId: rule.employee_id,
          shiftIds: [shiftId],
          detail: `employee ${rule.employee_id} may only work shift ${shiftId} alongside ${rule.other_id}`,
        });
      }
    }
  }

  return violations;
}
