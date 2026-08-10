/**
 * Per-skill staffing count requirements ("at least N people at level L").
 *
 * Split out of the former single `constraintValidator.ts` — see that
 * file's header for why a validator exists at all.
 *
 * @author Luca Ostinelli
 */

import type { OptimizationProblem } from '../types';
import type { ValidatedAssignment } from './hardConstraints';

/** A shift short of the qualified people some skill requires. */
export interface QualifiedStaffShortfall {
  shiftId: string;
  skill: string;
  /** Proficiency that counts as qualified. */
  level: number;
  required: number;
  assigned: number;
}

/**
 * Shifts staffed below their "at least N at level L" requirement.
 *
 * WHY THIS IS NOT THE PROFICIENCY FILTER. `required_skill_levels` says
 * EVERYONE assigned must be at least this good — a predicate on who may be
 * assigned. This is a COUNT over the shift, and it cannot be expressed by
 * narrowing eligibility: one senior per night shift does not mean everyone
 * must be senior, and requiring that would make most rotas unstaffable. The
 * two are independent requirements over the same shift.
 *
 * WHY A SHORTFALL AND NOT A VIOLATION. Exactly the reasoning that made
 * coverage a minimised target: made hard, a period with no available senior
 * produces no schedule at all, and the harder the problem the worse the answer.
 * Reported alongside the staffing shortfall so a planner can see which shifts
 * lack cover of which kind — a shift can be fully staffed to `min_staff` and
 * still have nobody qualified, which is a different problem with a different
 * fix.
 */
export function qualifiedStaffShortfalls(
  problem: OptimizationProblem,
  assignments: ValidatedAssignment[]
): QualifiedStaffShortfall[] {
  const shortfalls: QualifiedStaffShortfall[] = [];
  const employeesById = new Map(problem.employees.map((e) => [e.id, e]));

  for (const shift of problem.shifts) {
    const requirements = shift.qualified_staff;
    if (!requirements) continue;

    const assignees = assignments
      .filter((a) => a.shiftId === shift.id)
      .map((a) => employeesById.get(a.employeeId))
      .filter((e): e is NonNullable<typeof e> => e !== undefined);

    for (const [skill, { level, count }] of Object.entries(requirements)) {
      const qualified = assignees.filter(
        // An unknown level does NOT count toward the requirement, the reverse
        // of how it is treated in the eligibility filter. There, unknown means
        // "no reason to exclude"; here it would mean asserting a competence
        // nobody recorded, on the one rule that exists to guarantee it.
        (e) => e.skills.includes(skill) && (e.skill_levels?.[skill] ?? 0) >= level
      ).length;

      if (qualified < count) {
        shortfalls.push({ shiftId: shift.id, skill, level, required: count, assigned: qualified });
      }
    }
  }

  return shortfalls;
}
