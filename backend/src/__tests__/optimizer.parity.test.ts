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
