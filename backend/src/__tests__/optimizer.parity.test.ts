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
  findOverCommitments,
  restShortfalls,
  timeOffAdjacencies,
  daysOffShortfalls,
  startTimeSpreads,
  illegalTurnarounds,
  DEFAULT_NIGHT_TURNAROUND_HOURS,
  weekendLoads,
  weekendSpread,
  nightLoads,
  nightSpread,
  qualifiedStaffShortfalls,
  type ValidatedAssignment,
} from '../optimization/constraintValidator';
import { shiftBoundsMs, shiftHours } from '../optimization/shiftTime';
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

describe('timeOffAdjacencies', () => {
  const problem = {
    shifts: [
      { id: 's1', date: '2026-06-01', start_time: '09:00', end_time: '17:00', min_staff: 1, max_staff: 1 },
      { id: 's2', date: '2026-06-03', start_time: '09:00', end_time: '17:00', min_staff: 1, max_staff: 1 },
      { id: 's3', date: '2026-06-10', start_time: '09:00', end_time: '17:00', min_staff: 1, max_staff: 1 },
    ],
    employees: [
      { id: 'e1', max_hours_per_week: 40, skills: [], unavailable_dates: ['2026-06-02'] },
      { id: 'e2', max_hours_per_week: 40, skills: [], unavailable_dates: [] },
    ],
    constraints: {},
  };

  it('flags a shift the day before the absence, worked as the eve of it', () => {
    // e1's day off is 06-02; s1 (06-01) is the eve of it.
    const findings = timeOffAdjacencies(problem, [{ employeeId: 'e1', shiftId: 's1' }]);
    expect(findings).toEqual([
      { employeeId: 'e1', shiftId: 's1', shiftDate: '2026-06-01', timeOffDate: '2026-06-02', timeOffSide: 'after' },
    ]);
  });

  it('flags a shift the day after the absence, worked as the return day', () => {
    // e1's day off is 06-02; s2 (06-03) is the day they come back.
    const findings = timeOffAdjacencies(problem, [{ employeeId: 'e1', shiftId: 's2' }]);
    expect(findings).toEqual([
      { employeeId: 'e1', shiftId: 's2', shiftDate: '2026-06-03', timeOffDate: '2026-06-02', timeOffSide: 'before' },
    ]);
  });

  it('stays silent on a shift with no nearby absence', () => {
    expect(timeOffAdjacencies(problem, [{ employeeId: 'e1', shiftId: 's3' }])).toEqual([]);
  });

  it('stays silent for an employee with no approved time off', () => {
    expect(timeOffAdjacencies(problem, [{ employeeId: 'e2', shiftId: 's1' }])).toEqual([]);
  });
});

describe('daysOffShortfalls', () => {
  const week = Array.from({ length: 7 }, (_, i) => ({
    id: `s${i}`,
    date: `2026-06-0${i + 1}`,
    start_time: '09:00',
    end_time: '17:00',
    min_staff: 1,
    max_staff: 1,
  }));

  const problem = (rate?: number) => ({
    shifts: week,
    employees: [
      { id: 'e1', max_hours_per_week: 60, skills: [], unavailable_dates: [], ...(rate ? { min_days_off_per_period: rate } : {}) },
    ],
    constraints: {},
  });

  it('flags a shortfall when the rate is not met over the period', () => {
    // Rate 2/7 over a 7-day period requires 2 days off; only 1 is taken.
    const worked = week.slice(0, 6).map((s) => ({ employeeId: 'e1', shiftId: s.id }));
    const shortfalls = daysOffShortfalls(problem(2), worked);
    expect(shortfalls).toEqual([{ employeeId: 'e1', periodDays: 7, required: 2, actual: 1 }]);
  });

  it('stays silent once the rate is met', () => {
    const worked = week.slice(0, 5).map((s) => ({ employeeId: 'e1', shiftId: s.id }));
    expect(daysOffShortfalls(problem(2), worked)).toEqual([]);
  });

  it('does not measure an employee whose contract sets no rate', () => {
    const worked = week.map((s) => ({ employeeId: 'e1', shiftId: s.id }));
    expect(daysOffShortfalls(problem(), worked)).toEqual([]);
  });

  it('counts external work within the period, and ignores it outside the period', () => {
    const withExternal = {
      ...problem(2),
      employees: [
        {
          ...problem(2).employees[0],
          existing_assignments: [
            { date: '2026-06-01', start_time: '09:00', end_time: '17:00' },
            // Outside the 06-01..06-07 span — must not count against this period.
            { date: '2026-07-01', start_time: '09:00', end_time: '17:00' },
          ],
        },
      ],
    };
    // Only 06-01 counts as worked from external assignments; assigned shifts
    // add five more distinct days, leaving one day off — short of the rate of 2.
    const worked = week.slice(1, 6).map((s) => ({ employeeId: 'e1', shiftId: s.id }));
    const shortfalls = daysOffShortfalls(withExternal, worked);
    expect(shortfalls).toEqual([{ employeeId: 'e1', periodDays: 7, required: 2, actual: 1 }]);
  });
});

describe('startTimeSpreads', () => {
  const shift = (id: string, date: string, startTime: string) => ({
    id,
    date,
    start_time: startTime,
    end_time: '17:00',
    min_staff: 1,
    max_staff: 1,
  });

  const problem = {
    shifts: [
      shift('s1', '2026-06-01', '06:00'),
      shift('s2', '2026-06-02', '14:00'),
      shift('s3', '2026-06-03', '22:00'),
      shift('s4', '2026-06-04', '06:00'),
    ],
    employees: [
      { id: 'e1', max_hours_per_week: 60, skills: [], unavailable_dates: [] },
      { id: 'e2', max_hours_per_week: 60, skills: [], unavailable_dates: [] },
    ],
    constraints: {},
  };

  it('reports the gap between the earliest and latest start time worked', () => {
    // e1 works 06:00, 14:00 and 22:00 — a 16-hour (960-minute) spread.
    const worked = [
      { employeeId: 'e1', shiftId: 's1' },
      { employeeId: 'e1', shiftId: 's2' },
      { employeeId: 'e1', shiftId: 's3' },
    ];
    expect(startTimeSpreads(problem, worked)).toEqual([
      { employeeId: 'e1', distinctStartTimes: 3, spreadMinutes: 960 },
    ]);
  });

  it('is zero for a steady start time, even across several shifts', () => {
    const worked = [
      { employeeId: 'e1', shiftId: 's1' },
      { employeeId: 'e1', shiftId: 's4' },
    ];
    expect(startTimeSpreads(problem, worked)).toEqual([
      { employeeId: 'e1', distinctStartTimes: 1, spreadMinutes: 0 },
    ]);
  });

  it('omits an employee with no assignments rather than reporting a false zero', () => {
    const worked = [{ employeeId: 'e1', shiftId: 's1' }];
    expect(startTimeSpreads(problem, worked)).toEqual([
      { employeeId: 'e1', distinctStartTimes: 1, spreadMinutes: 0 },
    ]);
    expect(startTimeSpreads(problem, worked).find((r) => r.employeeId === 'e2')).toBeUndefined();
  });

  it('measures each employee independently', () => {
    const worked = [
      { employeeId: 'e1', shiftId: 's1' },
      { employeeId: 'e1', shiftId: 's3' },
      { employeeId: 'e2', shiftId: 's2' },
    ];
    const results = startTimeSpreads(problem, worked);
    expect(results.find((r) => r.employeeId === 'e1')).toEqual({
      employeeId: 'e1',
      distinctStartTimes: 2,
      spreadMinutes: 960,
    });
    expect(results.find((r) => r.employeeId === 'e2')).toEqual({
      employeeId: 'e2',
      distinctStartTimes: 1,
      spreadMinutes: 0,
    });
  });
});

describe('illegalTurnarounds', () => {
  const shift = (id: string, date: string, startTime: string, endTime: string) => ({
    id,
    date,
    start_time: startTime,
    end_time: endTime,
    min_staff: 1,
    max_staff: 1,
  });

  const employee = (id: string) => ({
    id,
    max_hours_per_week: 60,
    min_hours_between_shifts: 4, // clears the GENERAL minimum, so only the night-specific rule can catch this
    skills: [],
    unavailable_dates: [],
  });

  it('flags a night shift followed too soon by a morning one', () => {
    // Night shift ends 2026-06-02 06:00; next shift starts 08:00 — 2h rest.
    const problem = {
      shifts: [
        shift('s1', '2026-06-01', '22:00', '06:00'),
        shift('s2', '2026-06-02', '08:00', '16:00'),
      ],
      employees: [employee('e1')],
      constraints: {},
    };
    const worked = [
      { employeeId: 'e1', shiftId: 's1' },
      { employeeId: 'e1', shiftId: 's2' },
    ];
    expect(illegalTurnarounds(problem, worked)).toEqual([
      {
        employeeId: 'e1',
        nightShiftId: 's1',
        nextShiftId: 's2',
        restHours: 2,
        requiredHours: DEFAULT_NIGHT_TURNAROUND_HOURS,
      },
    ]);
  });

  it('stays silent once the turnaround clears the required rest', () => {
    // Night shift ends 06:00; next shift starts the following day at 09:00 — 27h rest.
    const problem = {
      shifts: [
        shift('s1', '2026-06-01', '22:00', '06:00'),
        shift('s2', '2026-06-03', '09:00', '17:00'),
      ],
      employees: [employee('e1')],
      constraints: {},
    };
    const worked = [
      { employeeId: 'e1', shiftId: 's1' },
      { employeeId: 'e1', shiftId: 's2' },
    ];
    expect(illegalTurnarounds(problem, worked)).toEqual([]);
  });

  it('does not flag a morning-then-morning pair, even with a short gap', () => {
    // Neither shift is night work — the general min-rest rule owns this case.
    const problem = {
      shifts: [
        shift('s1', '2026-06-01', '08:00', '16:00'),
        shift('s2', '2026-06-01', '18:00', '22:00'),
      ],
      employees: [employee('e1')],
      constraints: {},
    };
    const worked = [
      { employeeId: 'e1', shiftId: 's1' },
      { employeeId: 'e1', shiftId: 's2' },
    ];
    expect(illegalTurnarounds(problem, worked)).toEqual([]);
  });

  it('honours a configured turnaround threshold', () => {
    const problem = {
      shifts: [
        shift('s1', '2026-06-01', '22:00', '06:00'),
        shift('s2', '2026-06-02', '08:00', '16:00'),
      ],
      employees: [employee('e1')],
      constraints: { min_hours_after_night_shift: 1 }, // 2h rest now clears it
    };
    const worked = [
      { employeeId: 'e1', shiftId: 's1' },
      { employeeId: 'e1', shiftId: 's2' },
    ];
    expect(illegalTurnarounds(problem, worked)).toEqual([]);
  });

  it('only examines the immediately next shift, not every later one', () => {
    const problem = {
      shifts: [
        shift('s1', '2026-06-01', '22:00', '06:00'),
        // A well-rested shift sits between the night shift and a third one.
        shift('s2', '2026-06-03', '09:00', '17:00'),
        shift('s3', '2026-06-03', '19:00', '20:00'),
      ],
      employees: [employee('e1')],
      constraints: {},
    };
    const worked = [
      { employeeId: 'e1', shiftId: 's1' },
      { employeeId: 'e1', shiftId: 's2' },
      { employeeId: 'e1', shiftId: 's3' },
    ];
    // s1→s2 clears the threshold; s2 is not night work, so s2→s3 is never examined.
    expect(illegalTurnarounds(problem, worked)).toEqual([]);
  });

  it('counts work held on other schedules toward the turnaround', () => {
    const problem = {
      shifts: [shift('s2', '2026-06-02', '08:00', '16:00')],
      employees: [
        {
          ...employee('e1'),
          existing_assignments: [
            { date: '2026-06-01', start_time: '22:00', end_time: '06:00' },
          ],
        },
      ],
      constraints: {},
    };
    const worked = [{ employeeId: 'e1', shiftId: 's2' }];
    expect(illegalTurnarounds(problem, worked)).toEqual([
      {
        employeeId: 'e1',
        nightShiftId: 'ext:e1:0',
        nextShiftId: 's2',
        restHours: 2,
        requiredHours: DEFAULT_NIGHT_TURNAROUND_HOURS,
      },
    ]);
  });

  it('skips an overlapping pair rather than reporting a negative rest', () => {
    const problem = {
      shifts: [
        shift('s1', '2026-06-01', '22:00', '08:00'),
        shift('s2', '2026-06-02', '06:00', '14:00'),
      ],
      employees: [employee('e1')],
      constraints: {},
    };
    const worked = [
      { employeeId: 'e1', shiftId: 's1' },
      { employeeId: 'e1', shiftId: 's2' },
    ];
    expect(illegalTurnarounds(problem, worked)).toEqual([]);
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
describeOrtools('CP-SAT engine carries equity across the boundary', () => {
  /**
   * The discriminating fixture, which is the hard part of testing this.
   *
   * WEEKDAY SHIFTS ARE PART OF IT, not padding. With only the two weekend days
   * the weekend term and the HOURS term are in direct opposition — giving both
   * weekend days to one person is the only way to balance weekends and the
   * surest way to unbalance hours — and hours wins, so the run is 1–1 whatever
   * the history says. Two weekday shifts give the solver a way to satisfy both:
   * whoever is behind on weekends takes them, the other takes the weekdays, and
   * the hours stay level. Without them this test passes against an engine that
   * ignores carried history entirely.
   *
   * The person already ahead is also the one who WANTS the weekend, so the
   * preference pulls the wrong way and cannot be what produces the result.
   */
  const weekendProblem = (carried?: number) => {
    const shift = (id: string, date: string) => ({
      id,
      date,
      start_time: '08:00',
      end_time: '16:00',
      min_staff: 1,
      max_staff: 1,
      required_skills: [],
      priority: 1,
    });
    return {
      shifts: [
        shift('sat', '2026-05-02'),
        shift('sun', '2026-05-03'),
        shift('mon', '2026-05-04'),
        shift('tue', '2026-05-05'),
      ],
      employees: [
        {
          id: 'ahead',
          max_hours_per_week: 40,
          min_hours_per_week: 0,
          max_consecutive_days: 7,
          skills: [],
          unavailable_dates: [],
          ...(carried === undefined ? {} : { carried_load: { weekend: carried } }),
        },
        {
          id: 'behind',
          max_hours_per_week: 40,
          min_hours_per_week: 0,
          max_consecutive_days: 7,
          skills: [],
          unavailable_dates: [],
        },
      ],
      preferences: [
        { employee_id: 'ahead', shift_id: 'sat', preference: 'prefer' },
        { employee_id: 'ahead', shift_id: 'sun', preference: 'prefer' },
      ],
    };
  };

  const weekendDaysOf = (assignments: ValidatedAssignment[], employeeId: string): number =>
    assignments.filter(
      (a) => a.employeeId === employeeId && (a.shiftId === 'sat' || a.shiftId === 'sun')
    ).length;

  it('splits the weekend evenly when no history is carried', () => {
    // The control, and it is not what the preference alone would give: the
    // in-period equity term already outweighs two satisfied preferences. The
    // test below is only meaningful as a DIFFERENCE from this baseline.
    const assignments = runPython(weekendProblem());
    expect(weekendDaysOf(assignments, 'ahead')).toBe(1);
    expect(weekendDaysOf(assignments, 'behind')).toBe(1);
  });

  it('gives the weekend to whoever is behind once the history says so', () => {
    // Four weekend days more than the other candidate, carried in. Everything
    // else is identical to the control, including the preference pulling the
    // other way; the only difference is that the spread no longer starts at
    // zero, so an even split is no longer the balanced answer.
    const assignments = runPython(weekendProblem(4));
    expect(weekendDaysOf(assignments, 'behind')).toBe(2);
    expect(weekendDaysOf(assignments, 'ahead')).toBe(0);
  });

  it('does not pay for that with the hours', () => {
    // The weekdays exist so equity on WHICH hours and equity on HOW MANY can
    // both be satisfied. If the engine bought weekend balance by handing
    // someone the whole week, that would be a worse schedule reported as a
    // better one.
    const assignments = runPython(weekendProblem(4));
    const shiftsOf = (id: string) => assignments.filter((a) => a.employeeId === id).length;
    expect(shiftsOf('ahead')).toBe(2);
    expect(shiftsOf('behind')).toBe(2);
  });

  it('leaves both engines reading the carried load the same way', () => {
    const problem = weekendProblem(4) as never;
    const assignments = runPython(problem);
    // Four carried plus none worked against zero carried plus two worked: a
    // spread of two, the smallest reachable here, measured by the canonical
    // validator rather than by the engine's own arithmetic.
    expect(weekendSpread(problem, assignments)).toBe(2);
    expect(findConstraintViolations(problem, assignments)).toEqual([]);
  });
});

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

/**
 * Over-commitment: the one thing that can still make the problem unsolvable.
 *
 * Measured rather than assumed. Once coverage became a minimised shortfall,
 * assigning NOTHING satisfies every remaining hard rule, and skills and
 * availability produce no constraints at all (ineligible pairings get no
 * variable). Running the four candidate causes confirmed it: only an
 * employee's `existing_assignments` — work on OTHER schedules, fixed facts
 * here — can still make the model INFEASIBLE.
 *
 * This is why the explainability work is a deterministic pre-check and not an
 * unsat core: the condition is decidable in one pass over data already in
 * hand, and names the employee, the rule and the numbers instead of returning
 * opaque literals. Assumption literals would disable parts of CP-SAT's
 * presolve on every run to explain a case that should be rare.
 *
 * Verified against the previous implementation: this fixture returned
 * INFEASIBLE with zero assignments and no explanation at all.
 */
describeOrtools('CP-SAT engine explains an over-committed employee', () => {
  const overCommitted = {
    shifts: [
      {
        id: 's0',
        date: '2033-03-01',
        start_time: '09:00',
        end_time: '17:00',
        min_staff: 1,
        max_staff: 2,
        department_id: 1,
      },
    ],
    employees: [
      {
        id: 'e1',
        max_hours_per_week: 8,
        max_consecutive_days: 5,
        min_hours_between_shifts: 8,
        skills: [],
        unavailable_dates: [],
        // Already working 23h a day elsewhere: no decision here can repair it.
        existing_assignments: [1, 2, 3, 4, 5].map((d) => ({
          date: `2033-03-0${d}`,
          start_time: '00:00',
          end_time: '23:00',
        })),
      },
      {
        id: 'e2',
        max_hours_per_week: 40,
        max_consecutive_days: 5,
        min_hours_between_shifts: 8,
        skills: [],
        unavailable_dates: [],
      },
    ],
    skills: {},
    preferences: {},
    constraints: {},
  };

  it('still schedules everyone else instead of refusing outright', () => {
    const assignments = runPython(overCommitted);
    // The shift is covered by the employee who legally can take it.
    expect(assignments).toHaveLength(1);
    expect(assignments[0].employeeId).toBe('e2');
  });

  it('never assigns work to the over-committed employee', () => {
    const assignments = runPython(overCommitted);
    expect(assignments.some((a) => a.employeeId === 'e1')).toBe(false);
  });

  it('names the employee, the rule and the numbers', () => {
    const findings = findOverCommitments(overCommitted);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]).toMatchObject({ employeeId: 'e1', rule: 'daily-hours' });
    // A bare "INFEASIBLE" gave the planner nothing to act on; the detail has
    // to carry what is wrong and by how much.
    expect(findings[0].detail).toMatch(/23h on 2033-03-01/);
    expect(findings[0].detail).toMatch(/8h daily limit/);
  });

  it('reports nothing for an employee within their limits', () => {
    expect(
      findOverCommitments({ ...overCommitted, employees: [overCommitted.employees[1]] })
    ).toEqual([]);
  });

  it('detects a breached weekly cap from external work alone', () => {
    const findings = findOverCommitments({
      ...overCommitted,
      employees: [
        {
          ...overCommitted.employees[0],
          // Within the daily cap, but seven of them bust the week.
          max_hours_per_week: 20,
          max_hours_per_day: 24,
          existing_assignments: [1, 2, 3, 4, 5].map((d) => ({
            date: `2033-03-0${d}`,
            start_time: '09:00',
            end_time: '17:00',
          })),
        },
      ],
    });
    expect(findings.map((f) => f.rule)).toContain('weekly-hours');
  });

  it('detects a breached consecutive-days limit from external work alone', () => {
    const findings = findOverCommitments({
      ...overCommitted,
      employees: [
        {
          ...overCommitted.employees[0],
          max_hours_per_week: 200,
          max_hours_per_day: 24,
          max_consecutive_days: 3,
          existing_assignments: [1, 2, 3, 4, 5].map((d) => ({
            date: `2033-03-0${d}`,
            start_time: '09:00',
            end_time: '17:00',
          })),
        },
      ],
    });
    expect(findings.map((f) => f.rule)).toContain('consecutive-days');
  });
});

/**
 * Continuous replanning: a published assignment is a COMMITMENT.
 *
 * `generate` always solved from scratch, so re-running it on a published
 * schedule could legally reshuffle everyone. That is wrong in a way no
 * scheduling metric can see: once published, an assignment is something a
 * person has arranged their life around. A re-solve that improves the schedule
 * by 3% while moving a third of the staff has made things WORSE — and the model
 * could not express that at all, because disruption had no cost, so the solver
 * was free to cause any amount of it.
 *
 * Pinned assignments now sit at their OWN objective level, between coverage and
 * the soft terms. That placement is the whole design:
 *
 *   - above preferences and fairness, because a commitment must never be broken
 *     to satisfy a preference, however many of them accumulate — a lexicographic
 *     statement no weight can make;
 *   - below coverage, because leaving a shift unstaffed to avoid moving someone
 *     is worse than moving them.
 */
describeOrtools('CP-SAT engine treats a published assignment as a commitment', () => {
  const twoEmployees = [1, 2].map((i) => ({
    id: `e${i}`,
    max_hours_per_week: 60,
    max_consecutive_days: 7,
    min_hours_between_shifts: 8,
    skills: [],
    unavailable_dates: [],
  }));

  const fourShifts = [0, 1, 2, 3].map((i) => ({
    id: `s${i}`,
    date: `2033-05-0${i + 1}`,
    start_time: '09:00',
    end_time: '17:00',
    min_staff: 1,
    max_staff: 1,
    department_id: 1,
  }));

  const base = {
    shifts: fourShifts,
    employees: twoEmployees,
    skills: {},
    preferences: {},
    constraints: {},
  };

  /**
   * THE ACCEPTANCE TEST FROM THE ISSUE: re-solving with unchanged inputs must
   * return zero changes. The previous implementation could not pass it —
   * nothing preserved a prior decision, so the answer depended on search order.
   */
  it('re-solving unchanged inputs preserves every commitment', () => {
    const first = runPython(base);
    const pins = first.map((a) => ({ employee_id: a.employeeId, shift_id: a.shiftId }));

    const second = runPython({ ...base, pinned_assignments: pins });

    const key = (a: { employeeId: string; shiftId: string }) => `${a.employeeId}:${a.shiftId}`;
    expect(new Set(second.map(key))).toEqual(new Set(first.map(key)));
  });

  /**
   * The sharp case: commitments that are maximally UNFAIR. Without pinning the
   * fairness term splits this 2/2; with everything committed to one person,
   * keeping the commitments must win — otherwise "improving fairness" is a
   * licence to reshuffle people who were already told.
   */
  it('does not break commitments to improve fairness', () => {
    const pins = fourShifts.map((s) => ({ employee_id: 'e1', shift_id: s.id }));
    const assignments = runPython({ ...base, pinned_assignments: pins });

    expect(assignments.filter((a) => a.employeeId === 'e1')).toHaveLength(4);
  });

  it('does not break commitments to satisfy a preference', () => {
    const pins = fourShifts.map((s) => ({ employee_id: 'e1', shift_id: s.id }));
    const assignments = runPython({
      ...base,
      pinned_assignments: pins,
      // e1 declares every committed shift as one to avoid. Preferences sit
      // below commitments, so this must change nothing.
      preferences: { e1: { avoid_shifts: fourShifts.map((s) => s.id) } },
    });

    expect(assignments.filter((a) => a.employeeId === 'e1')).toHaveLength(4);
  });

  /**
   * Commitments are NOT inviolable. Coverage outranks them, so a commitment
   * that stands between a shift and being staffed gets broken — the direction
   * the ordering deliberately allows.
   */
  it('breaks a commitment rather than leave a shift unstaffed', () => {
    // One employee, two same-day shifts they cannot both work, both committed.
    const clashing = {
      ...base,
      shifts: [
        { ...fourShifts[0], id: 'a', date: '2033-05-01', min_staff: 1, max_staff: 1 },
        {
          ...fourShifts[0],
          id: 'b',
          date: '2033-05-01',
          start_time: '10:00',
          end_time: '18:00',
          min_staff: 1,
          max_staff: 1,
        },
      ],
      employees: [twoEmployees[0]],
      pinned_assignments: [
        { employee_id: 'e1', shift_id: 'a' },
        { employee_id: 'e1', shift_id: 'b' },
      ],
    };
    const assignments = runPython(clashing);

    // Double-booking is hard, so one commitment cannot survive. The engine
    // still answers rather than refusing.
    expect(assignments).toHaveLength(1);
  });

  it('ignores a commitment whose pairing is no longer possible', () => {
    // The person lost the skill or booked the day off, so the pairing has no
    // variable at all. Rewarding it would be meaningless; the diff reports it
    // as broken, which is the honest answer.
    const assignments = runPython({
      ...base,
      shifts: fourShifts.map((s) => ({ ...s, required_skills: ['nurse'] })),
      pinned_assignments: [{ employee_id: 'e1', shift_id: 's0' }],
    });
    expect(assignments).toEqual([]);
  });
});

/**
 * Minimum consecutive days off.
 *
 * `max_consecutive_days` caps how long someone works without a break and says
 * nothing about the break itself: five-on, one-off, five-on, one-off satisfies
 * it completely while the person never gets two days together. That is the
 * difference between "not overworked" and "rested", and only the first was
 * modelled — two separate single days is not a weekend.
 *
 * Verified against the previous implementation: the fixture below left three
 * 7-day windows with no two-day rest block; it now leaves none.
 */
describeOrtools('CP-SAT engine gives rest in blocks, not scattered days', () => {
  const fortnight = Array.from({ length: 14 }, (_, i) => ({
    id: `s${i}`,
    date: `2033-06-${String(i + 1).padStart(2, '0')}`,
    start_time: '09:00',
    end_time: '17:00',
    min_staff: 1,
    max_staff: 1,
    department_id: 1,
  }));

  const employee = (id: string, restDays?: number) => ({
    id,
    max_hours_per_week: 60,
    max_consecutive_days: 7,
    min_hours_between_shifts: 8,
    skills: [],
    unavailable_dates: [],
    ...(restDays ? { min_consecutive_days_off: restDays } : {}),
  });

  const problem = (restDays?: number) => ({
    shifts: fortnight,
    employees: [employee('e1', restDays), employee('e2', restDays)],
    skills: {},
    preferences: {},
    constraints: {},
  });

  it('leaves no window short of a rest block when the contract asks for one', () => {
    const assignments = runPython(problem(2));
    expect(restShortfalls(problem(2), assignments)).toEqual([]);
  });

  it('does not sacrifice coverage to arrange rest', () => {
    // Rest sits at SOFT and coverage at MEDIUM, so every shift must still be
    // staffed — the rest goal may only choose BETWEEN full-coverage answers.
    const withRest = problem(2);
    const assignments = runPython(withRest);
    expect(assignments).toHaveLength(fortnight.length);
    expect(coverageShortfalls(withRest, assignments)).toEqual([]);
  });

  it('reports shortfalls when no rest is requested, rather than inventing a goal', () => {
    // A contract that does not ask for rest blocks must not be measured
    // against one: `null` means unconstrained, not zero.
    const assignments = runPython(problem());
    expect(restShortfalls(problem(), assignments)).toEqual([]);
  });


  it('counts external work as occupying the day for rest purposes', () => {
    // A rest block is only rest if nothing else claims the day — work on
    // another schedule breaks it exactly as work on this one does.
    const withExternal = {
      ...problem(2),
      employees: [
        {
          ...employee('e1', 2),
          existing_assignments: fortnight.map((s) => ({
            date: s.date,
            start_time: '09:00',
            end_time: '17:00',
          })),
        },
        employee('e2', 2),
      ],
    };
    // Every day is taken by other schedules, so no window can hold a block.
    const shortfalls = restShortfalls(withExternal, []);
    expect(shortfalls.length).toBeGreaterThan(0);
    expect(shortfalls[0]).toMatchObject({ employeeId: 'e1', longestRest: 0 });
  });

  /**
   * Rest and fairness pull against each other: concentrating someone's shifts
   * creates longer free runs but a less even split. Both sit at SOFT, so
   * neither is guaranteed to win — what must hold is that the higher levels
   * are untouched. Asserting a particular compromise would be asserting
   * CP-SAT's tie-breaking rather than a property of the model.
   */
  it('keeps coverage and legality while the two soft goals compete', () => {
    const withRest = problem(3);
    const assignments = runPython(withRest);
    expect(coverageShortfalls(withRest, assignments)).toEqual([]);
    expect(findConstraintViolations(withRest, assignments)).toEqual([]);
  });
});

/**
 * Weekend equity: balancing WHICH hours, not just how many.
 *
 * The hours fairness term (#450) cannot see this. A schedule can be perfectly
 * even by total load while one person works every Saturday and Sunday and
 * another works only weekdays — both carry the same hours, and only one of
 * them has no weekends. To an hours-only measure a Sunday hour and a Tuesday
 * hour are the same hour.
 *
 * THE FIXTURE IS THE POINT, and it took three attempts to build honestly. With
 * shifts of equal length, one per day, balancing hours ALREADY balances
 * weekends as a side effect — the first two fixtures showed 4/4 both before
 * and after the change, demonstrating nothing. The distributions only diverge
 * when equal hours can be reached by more than one weekend split: 16 identical
 * shifts, half of them at weekends, over four employees. Four shifts each is
 * reachable as weekends 4/4/0/0 or 2/2/2/2, and hours fairness cannot tell
 * those apart.
 *
 * Verified against the previous implementation: that fixture produced a spread
 * of 2 (1/2/2/3) and now produces 0.
 */
describeOrtools('CP-SAT engine balances weekend work', () => {
  // Eight weekend days and eight weekdays, all shifts identical.
  const weekendDates = ['2033-06-04', '2033-06-05', '2033-06-11', '2033-06-12',
    '2033-06-18', '2033-06-19', '2033-06-25', '2033-06-26'];
  const weekdayDates = ['2033-06-01', '2033-06-02', '2033-06-03', '2033-06-06',
    '2033-06-07', '2033-06-08', '2033-06-09', '2033-06-10'];

  const problem = {
    shifts: [...weekendDates, ...weekdayDates].map((date, i) => ({
      id: `s${i}`,
      date,
      start_time: '09:00',
      end_time: '17:00',
      min_staff: 1,
      max_staff: 1,
      department_id: 1,
    })),
    employees: [1, 2, 3, 4].map((i) => ({
      id: `e${i}`,
      max_hours_per_week: 200,
      max_consecutive_days: 30,
      min_hours_between_shifts: 8,
      skills: [],
      unavailable_dates: [],
    })),
    skills: {},
    preferences: {},
    constraints: {},
  };

  it('spreads weekend days evenly when hours alone cannot decide', () => {
    expect(weekendSpread(problem, runPython(problem))).toBe(0);
  });

  it('does not trade coverage for weekend equity', () => {
    // The term sits at SOFT; coverage is MEDIUM. It may only choose BETWEEN
    // fully-staffed answers.
    const assignments = runPython(problem);
    expect(assignments).toHaveLength(problem.shifts.length);
    expect(coverageShortfalls(problem, assignments)).toEqual([]);
  });

  it('counts a day once however many shifts it holds', () => {
    // Two shifts on one Saturday cost one weekend, not two — the unit is the
    // day someone loses, not the hours they work in it.
    const doubled = {
      ...problem,
      shifts: [
        ...problem.shifts,
        { id: 'extra', date: '2033-06-04', start_time: '18:00', end_time: '20:00',
          min_staff: 1, max_staff: 1, department_id: 1 },
      ],
    };
    const loads = weekendLoads(doubled, [
      { employeeId: 'e1', shiftId: 's0' },
      { employeeId: 'e1', shiftId: 'extra' },
    ]);
    expect(loads.find((l) => l.employeeId === 'e1')?.days).toBe(1);
  });


  it('counts weekend work held on other schedules', () => {
    // The person's weekend is gone regardless of which schedule took it, so a
    // measure that ignored external work would report someone as free while
    // they are already committed.
    const withExternal = {
      ...problem,
      employees: [
        {
          ...problem.employees[0],
          existing_assignments: [
            { date: '2033-06-04', start_time: '09:00', end_time: '17:00' },
            { date: '2033-06-05', start_time: '09:00', end_time: '17:00' },
          ],
        },
        ...problem.employees.slice(1),
      ],
    };
    const loads = weekendLoads(withExternal, []);
    expect(loads.find((l) => l.employeeId === 'e1')?.days).toBe(2);
  });

  it('honours a configured weekend that is not Saturday and Sunday', () => {
    // Saturday/Sunday is a default, not a truth: several sectors run rotas
    // where the unsocial days differ.
    const fridayWeekend = { ...problem, constraints: { weekend_days: [5] } };
    const loads = weekendLoads(fridayWeekend, [{ employeeId: 'e1', shiftId: 's8' }]);
    // s8 is 2033-06-01, a Wednesday — not a weekend under either definition.
    expect(loads.find((l) => l.employeeId === 'e1')?.days).toBe(0);
  });
});

/**
 * Night-shift equity, and the mechanism it shares with weekend equity.
 *
 * Nothing balanced night work. Hours fairness balances how many hours; weekend
 * equity balances weekend days. A night shift on a Tuesday is invisible to
 * both, so one person could work every night in the period while the totals
 * looked perfectly even — and it lands on the same person as always, whoever
 * is most available, because nothing charged for concentrating it.
 *
 * Verified against the previous implementation: the fixture below produced
 * nights of 0/1/3/4 and now produces 2/2/2/2.
 *
 * All shifts fall on WEEKDAYS on purpose, so weekend equity is inert and the
 * night term is the only one that can be responsible.
 */
describeOrtools('CP-SAT engine shares night work', () => {
  const weekdays = ['2033-08-01', '2033-08-02', '2033-08-03', '2033-08-04',
    '2033-08-05', '2033-08-08', '2033-08-09', '2033-08-10'];

  const problem = {
    shifts: weekdays.flatMap((date, i) => [
      { id: `n${i}`, date, start_time: '22:00', end_time: '06:00',
        min_staff: 1, max_staff: 1, department_id: 1 },
      { id: `d${i}`, date, start_time: '09:00', end_time: '17:00',
        min_staff: 1, max_staff: 1, department_id: 1 },
    ]),
    employees: [1, 2, 3, 4].map((i) => ({
      id: `e${i}`,
      max_hours_per_week: 200,
      max_consecutive_days: 30,
      min_hours_between_shifts: 1,
      skills: [],
      unavailable_dates: [],
    })),
    skills: {},
    preferences: {},
    constraints: {},
  };

  it('spreads night work evenly when hours alone cannot decide', () => {
    expect(nightSpread(problem, runPython(problem))).toBe(0);
  });

  it('does not trade coverage for night equity', () => {
    const assignments = runPython(problem);
    expect(assignments).toHaveLength(problem.shifts.length);
    expect(coverageShortfalls(problem, assignments)).toEqual([]);
  });

  it('classifies by OVERLAP with the window, not by start time', () => {
    // A start-time threshold is wrong at the edges: 02:00–10:00 never starts
    // "late" but is unmistakably night work. Both of these must count.
    const shifts = [
      { id: 'late', date: '2033-08-01', start_time: '22:00', end_time: '06:00',
        min_staff: 1, max_staff: 1, department_id: 1 },
      { id: 'early', date: '2033-08-02', start_time: '02:00', end_time: '10:00',
        min_staff: 1, max_staff: 1, department_id: 1 },
      { id: 'day', date: '2033-08-03', start_time: '09:00', end_time: '17:00',
        min_staff: 1, max_staff: 1, department_id: 1 },
    ];
    const loads = nightLoads({ ...problem, shifts }, [
      { employeeId: 'e1', shiftId: 'late' },
      { employeeId: 'e1', shiftId: 'early' },
      { employeeId: 'e1', shiftId: 'day' },
    ]);
    expect(loads.find((l) => l.employeeId === 'e1')?.days).toBe(2);
  });

  it('honours a configured night window', () => {
    // What counts as unsocial is sector-specific; the default is a default.
    const evening = {
      ...problem,
      constraints: { night_window: { start: '18:00', end: '23:00' } },
      shifts: [
        { id: 'evening', date: '2033-08-01', start_time: '19:00', end_time: '22:00',
          min_staff: 1, max_staff: 1, department_id: 1 },
      ],
    };
    const loads = nightLoads(evening, [{ employeeId: 'e1', shiftId: 'evening' }]);
    expect(loads.find((l) => l.employeeId === 'e1')?.days).toBe(1);
  });
});

/**
 * Skill proficiency: the level the system already stored and the scheduler
 * ignored.
 *
 * `user_skills.proficiency_level` has existed since the initial schema and is
 * settable through the API, but the optimizer received skills as bare names —
 * so someone at level 1 and someone at level 5 were interchangeable to it. The
 * data was captured, displayed, and then discarded at exactly the point it
 * would matter.
 *
 * THE DISCRIMINATING FIXTURE IS THE ONE WHERE THE UNDER-QUALIFIED PERSON WOULD
 * OTHERWISE BE CHOSEN. A first attempt offered a qualified and an
 * under-qualified candidate for one slot; the solver picked the qualified one
 * both before and after, proving nothing. Only when the under-qualified person
 * is the ONLY candidate does the behaviour diverge — before: assigned, level
 * ignored; after: left unstaffed and reported as a shortfall.
 */
describeOrtools('CP-SAT engine respects skill proficiency', () => {
  const nightShift = {
    id: 's0',
    date: '2033-09-01',
    start_time: '22:00',
    end_time: '06:00',
    min_staff: 1,
    max_staff: 1,
    department_id: 1,
    required_skills: ['nurse'],
    required_skill_levels: { nurse: 4 },
  };

  const nurse = (id: string, level: number) => ({
    id,
    max_hours_per_week: 60,
    max_consecutive_days: 7,
    min_hours_between_shifts: 8,
    skills: ['nurse'],
    skill_levels: { nurse: level },
    unavailable_dates: [],
  });

  it('leaves a shift unstaffed rather than assign someone under-qualified', () => {
    // Refusing is right here: a shift that says it needs level 4 is saying
    // level 2 will not do, and quietly filling it would make the schedule look
    // covered while it is not.
    const problem = { shifts: [nightShift], employees: [nurse('e1', 2)], skills: {}, preferences: {}, constraints: {} };
    expect(runPython(problem)).toEqual([]);
    expect(coverageShortfalls(problem, [])).toHaveLength(1);
  });

  it('assigns the qualified person when one exists', () => {
    const problem = {
      shifts: [nightShift],
      employees: [nurse('e1', 2), nurse('e2', 5)],
      skills: {}, preferences: {}, constraints: {},
    };
    const assignments = runPython(problem);
    expect(assignments.map((a) => a.employeeId)).toEqual(['e2']);
  });

  it('flags an under-qualified assignment as a skill violation', () => {
    const problem = { shifts: [nightShift], employees: [nurse('e1', 2)], skills: {}, preferences: {}, constraints: {} };
    const violations = findConstraintViolations(problem, [{ employeeId: 'e1', shiftId: 's0' }]);
    expect(violations).toHaveLength(1);
    // The message names the gap, not just the rule: a planner needs to know
    // which level was short of which requirement.
    expect(violations[0].detail).toMatch(/level 2, below the level 4/);
  });

  it('treats an absent requirement as any level, and an absent level as unknown', () => {
    // Both defaults exist so a problem that carries no levels behaves exactly
    // as it did before proficiency reached the scheduler. Without this, adding
    // the field would have silently re-qualified every existing employee.
    const noRequirement = { ...nightShift, required_skill_levels: {} };
    const noLevel = { ...nurse('e1', 1), skill_levels: {} };
    const problem = { shifts: [noRequirement], employees: [noLevel], skills: {}, preferences: {}, constraints: {} };
    expect(findConstraintViolations(problem, [{ employeeId: 'e1', shiftId: 's0' }])).toEqual([]);
    expect(runPython(problem)).toHaveLength(1);
  });
});

/**
 * "At least one senior on this shift."
 *
 * The rule regulated settings actually run on, and NOT the same as the
 * proficiency filter. `required_skill_levels` says everyone assigned must be
 * at least this good; this is a COUNT over the shift. One senior per night
 * shift does not mean everyone must be senior, and requiring that would make
 * most rotas unstaffable.
 *
 * THE FIXTURE HAD TO MAKE THE SENIOR UNATTRACTIVE. A first attempt simply
 * offered two juniors and a senior for two slots — the solver picked the
 * senior anyway, before and after, proving nothing. That is now the fourth
 * constraint in this catalogue whose first fixture demonstrated nothing, so
 * the senior here declares the shift as one to AVOID: without the rule the
 * soft preference pushes the solver to the two juniors, and with it the senior
 * must be present regardless.
 *
 * That doubles as a demonstration of the level ordering — the requirement sits
 * at MEDIUM and the preference at SOFT, so no accumulation of preference can
 * buy away a qualified person.
 */
describeOrtools('CP-SAT engine staffs a shift with the qualified people it needs', () => {
  const nurse = (id: string, level: number) => ({
    id,
    max_hours_per_week: 60,
    max_consecutive_days: 7,
    min_hours_between_shifts: 8,
    skills: ['nurse'],
    skill_levels: { nurse: level },
    unavailable_dates: [],
  });

  const shift = {
    id: 's0',
    date: '2033-10-01',
    start_time: '22:00',
    end_time: '06:00',
    min_staff: 2,
    max_staff: 2,
    department_id: 1,
    required_skills: ['nurse'],
    qualified_staff: { nurse: { level: 5, count: 1 } },
  };

  const problem = {
    shifts: [shift],
    employees: [nurse('e1', 2), nurse('e2', 2), nurse('e3', 5)],
    skills: {},
    // The senior would rather not be here. Verified against the previous
    // implementation: without the rule this produced e1 + e2.
    preferences: { e3: { employee_id: 'e3', preferred_shifts: [], avoid_shifts: ['s0'] } },
    constraints: {},
  };

  it('includes a qualified person even when they would rather not be there', () => {
    const assignments = runPython(problem);
    expect(assignments.map((a) => a.employeeId)).toContain('e3');
    expect(qualifiedStaffShortfalls(problem, assignments)).toEqual([]);
  });

  it('still fills the shift to min_staff', () => {
    // The requirement is about composition, not size: it must not be satisfied
    // by assigning only the senior.
    expect(runPython(problem)).toHaveLength(2);
  });

  it('reports a shortfall rather than refusing when nobody qualifies', () => {
    // Made hard, a period with no available senior would produce no schedule
    // at all — the failure that made coverage a target rather than a
    // constraint. The shift is still staffed; the gap is reported.
    const noSenior = { ...problem, employees: [nurse('e1', 2), nurse('e2', 2)], preferences: {} };
    const assignments = runPython(noSenior);
    expect(assignments).toHaveLength(2);
    expect(qualifiedStaffShortfalls(noSenior, assignments)).toEqual([
      { shiftId: 's0', skill: 'nurse', level: 5, required: 1, assigned: 0 },
    ]);
  });

  it('does not count an unrecorded proficiency as qualified', () => {
    // The reverse of the eligibility filter, where an unknown level means "no
    // reason to exclude". Here it would assert a competence nobody recorded,
    // on the one rule that exists to guarantee it.
    const unknown = { ...nurse('e4', 5), skill_levels: {} };
    const shortfalls = qualifiedStaffShortfalls(
      { ...problem, employees: [unknown] },
      [{ employeeId: 'e4', shiftId: 's0' }]
    );
    expect(shortfalls).toHaveLength(1);
    expect(shortfalls[0].assigned).toBe(0);
  });
});

/**
 * Pairing: who may share a shift.
 *
 * Two rules that are commonly conflated. `apart` — these two must not be on
 * the same shift (conflict separation). `requires` — one may only work a shift
 * the other also works (a trainee who must not work unsupervised).
 *
 * `requires` IS DIRECTIONAL ON PURPOSE. "They must work together" reads as
 * symmetric and almost never is: a trainee must not work without their
 * supervisor, but the supervisor works perfectly well alone. A symmetric rule
 * would forbid the supervisor from taking any shift the trainee is not on —
 * the opposite of what anyone wants. Symmetric pairing is two directional
 * rules.
 *
 * BOTH CAN BE HARD ONLY BECAUSE OF #448. While coverage was a hard constraint,
 * "the trainee may only work with their supervisor" could make a period
 * INFEASIBLE. Now that coverage is a minimised shortfall, an unsatisfiable
 * pairing leaves that person unassigned and the shift short — reported, not
 * refused. Asserted below rather than assumed.
 */
describeOrtools('CP-SAT engine respects pairing rules', () => {
  const employee = (id: string, unavailable: string[] = []) => ({
    id,
    max_hours_per_week: 60,
    max_consecutive_days: 7,
    min_hours_between_shifts: 8,
    skills: [],
    unavailable_dates: unavailable,
  });

  const twoSeats = {
    id: 's0',
    date: '2033-11-01',
    start_time: '09:00',
    end_time: '17:00',
    min_staff: 2,
    max_staff: 2,
    department_id: 1,
  };

  it('keeps two people apart who must not share a shift', () => {
    // e3 avoids the shift, so without the rule the solver pairs e1 + e2 —
    // verified against the previous implementation, which did exactly that
    // even with the rule present, since it ignored pairings entirely.
    const problem = {
      shifts: [twoSeats],
      employees: [employee('e1'), employee('e2'), employee('e3')],
      skills: {},
      preferences: { e3: { employee_id: 'e3', preferred_shifts: [], avoid_shifts: ['s0'] } },
      constraints: {},
      pairings: [{ employee_id: 'e1', other_id: 'e2', kind: 'apart' as const }],
    };
    const assigned = runPython(problem).map((a) => a.employeeId);
    expect(assigned).toHaveLength(2);
    expect(assigned.includes('e1') && assigned.includes('e2')).toBe(false);
    expect(findConstraintViolations(problem, runPython(problem))).toEqual([]);
  });

  it('leaves a shift short rather than place a dependent unsupervised', () => {
    // The claim that makes these rules safe to enforce exactly. Before
    // coverage became a shortfall this fixture would have been INFEASIBLE.
    const problem = {
      shifts: [{ ...twoSeats, min_staff: 1 }],
      employees: [employee('e1'), employee('e2', ['2033-11-01'])],
      skills: {},
      preferences: {},
      constraints: {},
      pairings: [{ employee_id: 'e1', other_id: 'e2', kind: 'requires' as const }],
    };
    const assignments = runPython(problem);
    expect(assignments).toEqual([]);
    expect(coverageShortfalls(problem, assignments)).toHaveLength(1);
  });

  it('lets the depended-upon person work alone', () => {
    // The directional half. A symmetric rule would have forbidden this.
    const problem = {
      shifts: [{ ...twoSeats, min_staff: 1, max_staff: 1 }],
      employees: [employee('e1'), employee('e2')],
      skills: {},
      preferences: {},
      constraints: {},
      pairings: [{ employee_id: 'e1', other_id: 'e2', kind: 'requires' as const }],
    };
    expect(runPython(problem).map((a) => a.employeeId)).toEqual(['e2']);
  });


  it('flags two people who must stay apart sharing a shift', () => {
    // The `apart` half of the violation check. The engine prevents it, so this
    // asserts the validator would catch a schedule produced some other way —
    // a hand edit, an import, or a future engine.
    const problem = {
      shifts: [twoSeats],
      employees: [employee('e1'), employee('e2')],
      skills: {},
      preferences: {},
      constraints: {},
      pairings: [{ employee_id: 'e1', other_id: 'e2', kind: 'apart' as const }],
    };
    const violations = findConstraintViolations(problem, [
      { employeeId: 'e1', shiftId: 's0' },
      { employeeId: 'e2', shiftId: 's0' },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0].detail).toMatch(/must not share/);
  });

  it('flags an unsupervised dependent as a violation', () => {
    const problem = {
      shifts: [twoSeats],
      employees: [employee('e1'), employee('e2')],
      skills: {},
      preferences: {},
      constraints: {},
      pairings: [{ employee_id: 'e1', other_id: 'e2', kind: 'requires' as const }],
    };
    const violations = findConstraintViolations(problem, [{ employeeId: 'e1', shiftId: 's0' }]);
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('pairing');
  });
});

/**
 * A zero-length shift means the same thing everywhere.
 *
 * `shiftBoundsMs` treated `end === start` as a full day while `shiftHours`
 * treated it as zero, and the SQL fragments agreed with the former — so one
 * row was a 24-hour commitment to conflict detection and the dashboard, and a
 * zero-hour non-event to the hours caps. The two lived in the same module.
 *
 * Reconciled toward 24 hours because that is the safe direction: for a cap,
 * over-counting refuses work that might have been allowed, while a zero-hour
 * shift is invisible to every limit, so someone could hold an unbounded number
 * of them.
 *
 * The request schemas reject `startTime === endTime`, so the shape can only
 * arrive by direct insert or a seed — which the seeds do, bypassing
 * validation. That is why the readers had to agree rather than the case being
 * dismissed as impossible.
 */
/**
 * Equity carried across the schedule boundary.
 *
 * The category spread used to start counting today, so "weekend work is spread
 * evenly" was true of every month in isolation and could be false of the year:
 * the same person could take the unpopular end every month with nothing in the
 * objective noticing, as long as each month was internally balanced.
 */
describe('carried equity history', () => {
  const twoPeople = (carried?: Array<{ weekend?: number; night?: number }>) => ({
    shifts: [
      // A Saturday and a Sunday, one seat each.
      { id: 's1', date: '2026-05-02', start_time: '08:00', end_time: '16:00', min_staff: 1, max_staff: 1, required_skills: [], priority: 1 },
      { id: 's2', date: '2026-05-03', start_time: '08:00', end_time: '16:00', min_staff: 1, max_staff: 1, required_skills: [], priority: 1 },
    ],
    employees: [
      { id: 'a', max_hours_per_week: 40, min_hours_per_week: 0, max_consecutive_days: 7, skills: [], carried_load: carried?.[0] },
      { id: 'b', max_hours_per_week: 40, min_hours_per_week: 0, max_consecutive_days: 7, skills: [], carried_load: carried?.[1] },
    ],
    preferences: [],
  });

  it('adds the carried load to the in-period weekend load', () => {
    const problem = twoPeople([{ weekend: 3 }, { weekend: 0 }]) as never;
    const loads = weekendLoads(problem, [{ employeeId: 'a', shiftId: 's1' }]);

    // One weekend day worked here plus three carried in.
    expect(loads.find((l) => l.employeeId === 'a')?.days).toBe(4);
    expect(loads.find((l) => l.employeeId === 'b')?.days).toBe(0);
  });

  it('makes an even split look uneven when the history is uneven', () => {
    const problem = twoPeople([{ weekend: 2 }, { weekend: 0 }]) as never;

    // One weekend day each: perfectly balanced by the old measure...
    const even = weekendSpread(problem, [
      { employeeId: 'a', shiftId: 's1' },
      { employeeId: 'b', shiftId: 's2' },
    ]);
    // ...and giving both to the person already ahead is what the old measure
    // could not tell apart from giving both to the other one.
    const worse = weekendSpread(problem, [
      { employeeId: 'a', shiftId: 's1' },
      { employeeId: 'a', shiftId: 's2' },
    ]);
    const better = weekendSpread(problem, [
      { employeeId: 'b', shiftId: 's1' },
      { employeeId: 'b', shiftId: 's2' },
    ]);

    expect(even).toBe(2);
    expect(worse).toBe(4);
    // Assigning both to whoever is behind is the only option that closes the
    // gap — which is the whole point of carrying the history.
    expect(better).toBe(0);
    expect(better).toBeLessThan(even);
  });

  it('changes nothing when no history is carried', () => {
    const problem = twoPeople() as never;
    // The field is optional, and an installation with no published past must
    // behave exactly as before.
    expect(
      weekendSpread(problem, [
        { employeeId: 'a', shiftId: 's1' },
        { employeeId: 'b', shiftId: 's2' },
      ])
    ).toBe(0);
  });

  it('keeps the weekend and night histories separate', () => {
    const problem = twoPeople([{ night: 5 }, { weekend: 5 }]) as never;
    const weekend = weekendLoads(problem, []);
    const night = nightLoads(problem, []);

    // A night carried in must not read as a weekend carried in: they are
    // different things to lose, which is why there are two categories.
    expect(weekend.find((l) => l.employeeId === 'a')?.days).toBe(0);
    expect(weekend.find((l) => l.employeeId === 'b')?.days).toBe(5);
    expect(night.find((l) => l.employeeId === 'a')?.days).toBe(5);
    expect(night.find((l) => l.employeeId === 'b')?.days).toBe(0);
  });
});

describe('zero-length shifts are read consistently', () => {
  const zeroLength = { date: '2033-12-01', start_time: '08:00', end_time: '08:00' };

  it('spans a full day in both the interval and the hours reading', () => {
    const [start, end] = shiftBoundsMs(zeroLength);
    expect((end - start) / 3_600_000).toBe(24);
    expect(shiftHours(zeroLength)).toBe(24);
  });

  it('still measures an ordinary shift normally', () => {
    // The guard that stops the fix from making every shift a day long.
    expect(shiftHours({ date: '2033-12-01', start_time: '09:00', end_time: '17:00' })).toBe(8);
    expect(shiftHours({ date: '2033-12-01', start_time: '22:00', end_time: '06:00' })).toBe(8);
  });

  it('consumes a daily cap rather than slipping past it', () => {
    // The consequence that matters: at zero hours this shift was invisible to
    // every limit, so an employee could hold any number of them.
    const problem = {
      shifts: [{ id: 's0', ...zeroLength, min_staff: 1, max_staff: 1, department_id: 1 }],
      employees: [{
        id: 'e1',
        max_hours_per_week: 40,
        max_hours_per_day: 8,
        max_consecutive_days: 7,
        min_hours_between_shifts: 8,
        skills: [],
        unavailable_dates: [],
      }],
      skills: {}, preferences: {}, constraints: {},
    };
    const violations = findConstraintViolations(problem, [{ employeeId: 'e1', shiftId: 's0' }]);
    expect(violations.map((v) => v.rule)).toContain('daily-hours');
  });
});
