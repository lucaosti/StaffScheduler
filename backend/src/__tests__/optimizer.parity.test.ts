/**
 * Optimizer parity suite — the guard against constraint drift between the two
 * scheduling engines.
 *
 * The scheduling rules exist in two implementations: the Python CP-SAT model
 * and the TypeScript greedy pass. This suite pins them to one shared definition
 * (constraintValidator.ts) so a rule enforced by one engine but not the other
 * becomes a red test rather than a silent production divergence.
 *
 * Structure:
 *   1. Validator unit tests — deliberately-broken solutions must be caught, so
 *      the parity assertions below are meaningful (a validator that flags
 *      nothing would pass every engine trivially).
 *   2. Greedy parity — the TypeScript engine's output must be violation-free on
 *      every fixture, and fully cover every feasible one.
 *   3. CP-SAT parity — the Python engine's output must satisfy the SAME
 *      validator on the SAME fixtures. Gated on a local OR-Tools probe so the
 *      suite still runs for developers without Python; in CI, REQUIRE_ORTOOLS=1
 *      makes the engine mandatory so the parity guarantee is actually enforced.
 *
 * @author Luca Ostinelli
 */

import { spawnSync } from 'child_process';
import { join } from 'path';
import { ScheduleOptimizer } from '../optimization/ScheduleOptimizerORTools';
import {
  findConstraintViolations,
  coverageShortfalls,
  type ValidatedAssignment,
} from '../optimization/constraintValidator';
import { allFixtures, feasibleFixtures } from './fixtures/optimizerFixtures';

const toValidated = (
  assignments: Array<{ employeeId: string; shiftId: string }>
): ValidatedAssignment[] => assignments.map((a) => ({ employeeId: a.employeeId, shiftId: a.shiftId }));

describe('constraintValidator catches deliberate violations', () => {
  const problem = allFixtures[0].problem;

  it('flags an assignment to an unknown shift', () => {
    const v = findConstraintViolations(problem, [{ employeeId: 'e1', shiftId: 'nope' }]);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('double-booking');
  });

  it('flags over-staffing past max_staff', () => {
    // basic-coverage fixture s1 has max_staff 2; three assignments breaks it.
    const v = findConstraintViolations(problem, [
      { employeeId: 'e1', shiftId: 's1' },
      { employeeId: 'e2', shiftId: 's1' },
      { employeeId: 'e1', shiftId: 's1' },
    ]);
    expect(v.some((x) => x.rule === 'staff-cap')).toBe(true);
  });

  it('flags a skill violation', () => {
    const skillProblem = feasibleFixtures[1].problem; // s1 requires "RN"
    const v = findConstraintViolations(skillProblem, [{ employeeId: 'e2', shiftId: 's1' }]);
    expect(v.some((x) => x.rule === 'skill')).toBe(true);
  });

  it('flags an assignment on an unavailable date', () => {
    const unavailProblem = feasibleFixtures[2].problem; // e1 unavailable 2026-03-02
    const v = findConstraintViolations(unavailProblem, [{ employeeId: 'e1', shiftId: 's1' }]);
    expect(v.some((x) => x.rule === 'unavailability')).toBe(true);
  });

  it('flags a double-booking on overlapping shifts', () => {
    const overlapProblem = feasibleFixtures[3].problem; // s1 09-13 overlaps s2 11-15
    const v = findConstraintViolations(overlapProblem, [
      { employeeId: 'e1', shiftId: 's1' },
      { employeeId: 'e1', shiftId: 's2' },
    ]);
    expect(v.some((x) => x.rule === 'double-booking')).toBe(true);
  });

  it('flags insufficient rest between adjacent-day shifts', () => {
    const restProblem = allFixtures.find((f) => f.name.includes('rest'))!.problem;
    const v = findConstraintViolations(restProblem, [
      { employeeId: 'e1', shiftId: 's1' },
      { employeeId: 'e1', shiftId: 's2' },
    ]);
    expect(v.some((x) => x.rule === 'min-rest')).toBe(true);
  });

  it('flags exceeding the consecutive-days cap', () => {
    const consecProblem = allFixtures.find((f) => f.name.includes('consecutive'))!.problem;
    // Assign e1 to all six back-to-back days; cap is 5.
    const v = findConstraintViolations(
      consecProblem,
      consecProblem.shifts.map((s) => ({ employeeId: 'e1', shiftId: s.id }))
    );
    expect(v.some((x) => x.rule === 'consecutive-days')).toBe(true);
  });

  it('flags an external assignment that busts the daily budget', () => {
    const extProblem = allFixtures.find((f) => f.name.includes('external'))!.problem;
    const v = findConstraintViolations(extProblem, [{ employeeId: 'e1', shiftId: 's1' }]);
    // e1 already works 8h that day (external) + 8h shift → daily-hours, and the
    // 5h gap also trips min-rest. Either proves the external load is counted.
    expect(v.some((x) => x.rule === 'daily-hours' || x.rule === 'min-rest')).toBe(true);
  });

  it('accepts a legal empty solution', () => {
    expect(findConstraintViolations(problem, [])).toHaveLength(0);
  });

  it('flags exceeding the rolling weekly-hours cap', () => {
    // Five 10h days inside one 7-day window = 50h against a 40h cap.
    const weeklyProblem = {
      shifts: Array.from({ length: 5 }, (_, i) => ({
        id: `w${i + 1}`,
        date: `2026-06-0${i + 1}`,
        start_time: '08:00',
        end_time: '18:00', // 10h
        min_staff: 1,
        max_staff: 1,
      })),
      employees: [
        { id: 'e1', max_hours_per_week: 40, max_consecutive_days: 7, skills: [], unavailable_dates: [] },
      ],
      constraints: { min_hours_between_shifts: 8 },
    };
    const violations = findConstraintViolations(
      weeklyProblem,
      weeklyProblem.shifts.map((s) => ({ employeeId: 'e1', shiftId: s.id }))
    );
    const weekly = violations.filter((v) => v.rule === 'weekly-hours');
    expect(weekly).toHaveLength(1); // reported once per employee
    expect(weekly[0].detail).toMatch(/50h in the week starting 2026-06-01/);
  });
});

describe('coverageShortfalls', () => {
  it('reports shifts staffed below min_staff and stays silent otherwise', () => {
    const problem = feasibleFixtures[0].problem; // two shifts, min_staff 1 each
    const [first, second] = problem.shifts;

    expect(coverageShortfalls(problem, [])).toEqual([
      { shiftId: first.id, assigned: 0, required: 1 },
      { shiftId: second.id, assigned: 0, required: 1 },
    ]);

    expect(
      coverageShortfalls(problem, [
        { employeeId: 'e1', shiftId: first.id },
        { employeeId: 'e2', shiftId: second.id },
      ])
    ).toEqual([]);
  });
});

describe('greedy engine respects the canonical constraints', () => {
  const optimizer = new ScheduleOptimizer();

  it.each(allFixtures)('produces no violations on: $name', async ({ problem }) => {
    const assignments = toValidated(await optimizer.generateGreedySchedule(problem));
    const violations = findConstraintViolations(problem, assignments);
    expect(violations).toEqual([]);
  });

  it.each(feasibleFixtures)('fully covers the feasible fixture: $name', async ({ problem }) => {
    const assignments = toValidated(await optimizer.generateGreedySchedule(problem));
    expect(coverageShortfalls(problem, assignments)).toEqual([]);
  });
});

// --- CP-SAT parity (Python) -------------------------------------------------

const PYTHON_SCRIPT = join(__dirname, '../../optimization-scripts/schedule_optimizer.py');
const REQUIRE_ORTOOLS = process.env.REQUIRE_ORTOOLS === '1';

/** Probe whether python3 + ortools are importable in this environment. */
const ortoolsAvailable = (): boolean => {
  const probe = spawnSync('python3', ['-c', 'import ortools'], { encoding: 'utf8' });
  return probe.status === 0;
};

interface PythonAssignment {
  employee_id: string;
  shift_id: string;
}

/** Run the Python CP-SAT engine on a problem and return its assignments. */
const runPython = (problem: unknown): ValidatedAssignment[] => {
  const res = spawnSync(
    'python3',
    [PYTHON_SCRIPT, '--stdin', '--stdout', '--time-limit', '10'],
    { input: JSON.stringify(problem), encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
  );
  if (res.status !== 0 && res.status !== 1) {
    throw new Error(`Python optimizer failed (status ${res.status}): ${res.stderr}`);
  }
  const parsed = JSON.parse(res.stdout) as { status: string; assignments?: PythonAssignment[] };
  if (parsed.status !== 'OPTIMAL' && parsed.status !== 'FEASIBLE') {
    throw new Error(`Python optimizer returned ${parsed.status} for a feasible fixture`);
  }
  return (parsed.assignments ?? []).map((a) => ({
    employeeId: String(a.employee_id),
    shiftId: String(a.shift_id),
  }));
};

const describeOrtools = REQUIRE_ORTOOLS || ortoolsAvailable() ? describe : describe.skip;

describeOrtools('CP-SAT engine respects the same canonical constraints', () => {
  it.each(allFixtures)('produces no violations on: $name', ({ problem }) => {
    const assignments = runPython(problem);
    const violations = findConstraintViolations(problem, assignments);
    expect(violations).toEqual([]);
  });

  it.each(feasibleFixtures)('fully covers the feasible fixture: $name', ({ problem }) => {
    const assignments = runPython(problem);
    expect(coverageShortfalls(problem, assignments)).toEqual([]);
  });
});

/**
 * Overconstrained planning: not enough staff must produce the best partial
 * schedule, not nothing.
 *
 * WHY THIS IS THE MOST IMPORTANT CASE IN THIS FILE. `min_staff` used to be a
 * hard constraint, so a single uncoverable shift made CP-SAT prove the whole
 * model INFEASIBLE and the run degraded to the greedy engine. The consequence
 * was backwards: the harder the problem, the worse the engine you got — and
 * understaffing is the normal condition in workforce management, not an
 * exceptional one.
 *
 * It also corrupted the degradation signal. `degraded: true` means "the
 * optimal engine was unavailable"; there the engine ran fine and correctly
 * proved the model as stated had no solution. The model was wrong, not the run.
 *
 * Verified against the previous implementation: the first fixture below
 * returned INFEASIBLE with zero assignments.
 */
describeOrtools('CP-SAT engine plans under insufficient staff', () => {
  /** Three shifts needing two people each, with a single employee available. */
  const understaffed = {
    shifts: [0, 1, 2].map((i) => ({
      id: `s${i}`,
      date: `2033-03-0${i + 1}`,
      start_time: '09:00',
      end_time: '17:00',
      min_staff: 2,
      max_staff: 3,
      department_id: 1,
    })),
    employees: [
      {
        id: 'e1',
        max_hours_per_week: 40,
        max_consecutive_days: 6,
        min_hours_between_shifts: 8,
        skills: [],
        unavailable_dates: [],
      },
    ],
    skills: {},
    preferences: {},
    constraints: {},
  };

  it('returns a partial schedule instead of refusing to answer', () => {
    const assignments = runPython(understaffed);
    // One person can work all three, so every shift gets its one available
    // body. Refusing outright discarded exactly this.
    expect(assignments).toHaveLength(3);
  });

  it('keeps the partial schedule legal', () => {
    // Relaxing coverage must not relax anything else: the hard rules still
    // hold, which is what makes a partial schedule usable rather than merely
    // non-empty.
    const assignments = runPython(understaffed);
    expect(findConstraintViolations(understaffed, assignments)).toEqual([]);
  });

  it('reports the shortfall rather than letting it look complete', () => {
    const assignments = runPython(understaffed);
    const shortfalls = coverageShortfalls(understaffed, assignments);
    // A partial schedule that looks complete is how a draft gets published.
    expect(shortfalls).toHaveLength(3);
  });

  /**
   * The objective must aim at `min_staff`, not `max_staff`.
   *
   * The old objective rewarded EVERY assignment at a flat weight while
   * coverage was hard-bounded to `[min_staff, max_staff]`, so the solver always
   * filled to the ceiling: more people was always worth more, and nothing
   * charged for them. `min_staff` therefore never functioned as a target, and
   * the greedy engine — which fills only to `min_staff` — produced
   * systematically different staffing from the same input. Nothing caught it,
   * because the parity assertions above check hard-constraint validity, never
   * staffing level.
   *
   * Verified against the previous implementation: this fixture produced 9
   * assignments (3 shifts x max_staff 3).
   */
  it('staffs to min_staff rather than filling to max_staff', () => {
    const plentiful = {
      ...understaffed,
      employees: [1, 2, 3, 4].map((i) => ({
        id: `e${i}`,
        max_hours_per_week: 40,
        max_consecutive_days: 6,
        min_hours_between_shifts: 8,
        skills: [],
        unavailable_dates: [],
      })),
    };
    const assignments = runPython(plentiful);
    expect(assignments).toHaveLength(6);
    expect(coverageShortfalls(plentiful, assignments)).toEqual([]);
  });

  /**
   * MEDIUM outranks SOFT lexicographically, whatever the magnitudes.
   *
   * This is the property the old single weighted sum could not guarantee:
   * coverage at 100 against preferences at 55 meant two satisfied preferences
   * outweighed one covered seat, so whether coverage dominated depended on how
   * many preference terms a dataset happened to produce.
   *
   * The fixture makes the two levels pull in opposite directions: the employee
   * declares every shift as one to AVOID, so satisfying preferences means
   * working none of them. If soft could outrank medium, the solver would leave
   * all three shifts empty.
   */
  it('never buys a preference with an unstaffed seat', () => {
    const avoidsEverything = {
      ...understaffed,
      preferences: { e1: { avoid_shifts: ['s0', 's1', 's2'] } },
    };
    const assignments = runPython(avoidsEverything);
    expect(assignments).toHaveLength(3);
  });
});

/**
 * Workload fairness: the solver must balance, not merely be measured.
 *
 * WHY THIS MATTERS BEYOND THE NUMBER. The objective maximised coverage and
 * preferences and nothing else, so nothing preferred an even split — both
 * distributions scored identically and which one appeared was an artefact of
 * CP-SAT's search order. Meanwhile `/api/reports/fairness` computed and
 * displayed a fairness figure, so the system measured and reported an
 * equilibrium it had never been asked to produce, and a planner reading a poor
 * number had no lever.
 *
 * Verified against the previous implementation: the fixture below gave ALL
 * FOUR shifts to one employee and none to the other.
 */
describeOrtools('CP-SAT engine balances workload', () => {
  const twoEmployees = [1, 2].map((i) => ({
    id: `e${i}`,
    max_hours_per_week: 60,
    max_consecutive_days: 7,
    min_hours_between_shifts: 8,
    skills: [],
    unavailable_dates: [],
  }));

  /** Four single-person shifts on separate days: an even split is 2/2. */
  const splittable = {
    shifts: [0, 1, 2, 3].map((i) => ({
      id: `s${i}`,
      date: `2033-05-0${i + 1}`,
      start_time: '09:00',
      end_time: '17:00',
      min_staff: 1,
      max_staff: 1,
      department_id: 1,
    })),
    employees: twoEmployees,
    skills: {},
    preferences: {},
    constraints: {},
  };

  it('splits divisible work evenly rather than loading one person', () => {
    const assignments = runPython(splittable);
    const perEmployee = new Map<string, number>();
    for (const a of assignments) {
      perEmployee.set(a.employeeId, (perEmployee.get(a.employeeId) ?? 0) + 1);
    }
    expect(assignments).toHaveLength(4);
    expect([...perEmployee.values()].sort()).toEqual([2, 2]);
  });

  it('keeps the balanced schedule legal', () => {
    expect(findConstraintViolations(splittable, runPython(splittable))).toEqual([]);
  });

  /**
   * Fairness sits at SOFT, so it must never buy an unstaffed seat — and the
   * temptation is real: with one employee and three shifts, working none of
   * them gives a spread of zero, which is perfectly "fair".
   *
   * This is the same lexicographic property the preference test asserts, but
   * it needs its own case because fairness is measured in MINUTES: a single
   * unbalanced schedule carries a far larger magnitude than any preference
   * term, so a bound that happened to cover preferences would not cover this.
   * Adding the fairness term without folding its magnitude into that bound
   * re-creates the defect at a larger scale.
   */
  it('never buys balance with an unstaffed seat', () => {
    const oneEmployee = {
      ...splittable,
      shifts: splittable.shifts.slice(0, 3).map((s) => ({ ...s, max_staff: 2 })),
      employees: [twoEmployees[0]],
    };
    expect(runPython(oneEmployee)).toHaveLength(3);
  });
});

/**
 * Fairness must not manufacture work to look balanced.
 *
 * Nothing rewards staffing between `min_staff` and `max_staff` — `max_staff` is
 * a ceiling, not a target. But fairness rewards it INDIRECTLY, because adding
 * people flattens the load distribution. Observed directly when the fairness
 * term first landed: this fixture went from 6 assignments to 8, buying a
 * perfectly even split with two extra shifts of wages.
 *
 * An optimizer that inflates payroll to improve its own fairness metric is
 * exactly the "measured but not meaningful" failure fairness was added to fix,
 * so surplus staffing is charged at a DERIVED weight: one extra assignment can
 * improve the spread by at most the longest shift's duration, so charging
 * strictly more than that makes over-staffing never worth a fairness gain.
 */
describeOrtools('CP-SAT engine does not over-staff to look fair', () => {
  it('staffs to min_staff even when spare capacity would flatten the load', () => {
    const problem = {
      shifts: [0, 1, 2].map((i) => ({
        id: `s${i}`,
        date: `2033-03-0${i + 1}`,
        start_time: '09:00',
        end_time: '17:00',
        min_staff: 2,
        max_staff: 3,
        department_id: 1,
      })),
      // Four employees over three shifts: 6 assignments splits 2/2/1/1
      // (spread of one shift), 8 splits 2/2/2/2 (spread of zero).
      employees: [1, 2, 3, 4].map((i) => ({
        id: `e${i}`,
        max_hours_per_week: 40,
        max_consecutive_days: 7,
        min_hours_between_shifts: 8,
        skills: [],
        unavailable_dates: [],
      })),
      skills: {},
      preferences: {},
      constraints: {},
    };
    const assignments = runPython(problem);
    expect(assignments).toHaveLength(6);
    expect(coverageShortfalls(problem, assignments)).toEqual([]);
  });
});
