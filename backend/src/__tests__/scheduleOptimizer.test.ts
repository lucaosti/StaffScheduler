/**
 * ScheduleOptimizer (OR-Tools wrapper + greedy fallback) tests.
 *
 * The Python path is mocked away — we only test the greedy fallback,
 * evaluateCandidate(), problem validation, and the helpers
 * (_hasOverlappingShift, _calculateShiftHours) via the
 * public surface.
 */

import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { config } from '../config';
import {
  ScheduleOptimizer,
  OptimizationProblem,
  CandidateContext,
  KILL_GRACE_MS,
  MAX_STDERR_TAIL_CHARS,
  MAX_STDOUT_BYTES,
  solverTimeLimitSeconds,
  STDIN_ERROR_GRACE_MS,
} from '../optimization/ScheduleOptimizerORTools';

jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

const mockedSpawn = spawn as unknown as jest.Mock;

/**
 * Build a fake child process that accepts stdin and emits stdout/stderr,
 * but never fires 'close' or 'error' — simulating a hanging Python optimizer.
 */
const buildHangingProcess = (): any => {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = Object.assign(new EventEmitter(), { write: jest.fn(), end: jest.fn() });
  // A real ChildProcess: `killed` turns true once a signal is delivered, while
  // exitCode/signalCode stay null until the process has actually exited — and
  // a process that ignores SIGTERM never does.
  proc.killed = false;
  proc.exitCode = null;
  proc.signalCode = null;
  proc.kill = jest.fn(() => {
    proc.killed = true;
    return true;
  });
  return proc;
};

const buildProblem = (overrides: Partial<OptimizationProblem> = {}): OptimizationProblem => ({
  shifts: [],
  employees: [],
  preferences: {},
  constraints: {
    max_hours_per_week: 40,
    max_consecutive_days: 5,
    min_hours_between_shifts: 8,
  },
  ...overrides,
});

const buildShift = (overrides: Record<string, unknown> = {}): any => ({
  id: 's1',
  date: '2026-05-01',
  start_time: '08:00',
  end_time: '16:00',
  min_staff: 1,
  max_staff: 5,
  required_skills: [],
  priority: 1,
  ...overrides,
});

const buildEmployee = (overrides: Record<string, unknown> = {}): any => ({
  id: 'e1',
  max_hours_per_week: 40,
  min_hours_per_week: 0,
  max_consecutive_days: 5,
  skills: [],
  unavailable_dates: [],
  ...overrides,
});

describe('ScheduleOptimizer.generateGreedySchedule', () => {
  it('returns no assignments for an empty problem', async () => {
    const opt = new ScheduleOptimizer();
    const out = await opt.generateGreedySchedule(buildProblem());
    expect(out).toEqual([]);
  });

  it('assigns up to min_staff candidates per shift', async () => {
    const opt = new ScheduleOptimizer();
    const out = await opt.generateGreedySchedule(
      buildProblem({
        shifts: [buildShift({ id: 's1', min_staff: 2 })],
        employees: [buildEmployee({ id: 'e1' }), buildEmployee({ id: 'e2' }), buildEmployee({ id: 'e3' })],
      })
    );
    expect(out).toHaveLength(2);
  });

  it('skips employees who are unavailable on the shift date', async () => {
    const opt = new ScheduleOptimizer();
    const out = await opt.generateGreedySchedule(
      buildProblem({
        shifts: [buildShift({ id: 's1', min_staff: 1, date: '2026-05-01' })],
        employees: [buildEmployee({ id: 'e1', unavailable_dates: ['2026-05-01'] })],
      })
    );
    expect(out).toEqual([]);
  });

  it('rejects employees missing a required skill', async () => {
    const opt = new ScheduleOptimizer();
    const out = await opt.generateGreedySchedule(
      buildProblem({
        shifts: [buildShift({ id: 's1', min_staff: 1, required_skills: ['Triage'] })],
        employees: [
          buildEmployee({ id: 'e1', skills: [] }),
          buildEmployee({ id: 'e2', skills: ['Triage'] }),
        ],
      })
    );
    expect(out).toHaveLength(1);
    expect(out[0].employeeId).toBe('e2');
  });

  it('does not double-assign an employee to overlapping shifts on the same day', async () => {
    const opt = new ScheduleOptimizer();
    const out = await opt.generateGreedySchedule(
      buildProblem({
        shifts: [
          buildShift({ id: 's1', date: '2026-05-01', start_time: '08:00', end_time: '16:00', min_staff: 1 }),
          buildShift({ id: 's2', date: '2026-05-01', start_time: '12:00', end_time: '20:00', min_staff: 1 }),
        ],
        employees: [buildEmployee({ id: 'e1' })],
      })
    );
    // Only the first shift should get the single employee; the second has
    // no eligible candidate.
    expect(out).toHaveLength(1);
    expect(out[0].shiftId).toBe('s1');
  });

  it('computes overnight shift hours correctly (end < start wraps next day)', async () => {
    const opt = new ScheduleOptimizer();
    const out = await opt.generateGreedySchedule(
      buildProblem({
        shifts: [buildShift({ id: 's1', start_time: '22:00', end_time: '06:00', min_staff: 1 })],
        employees: [buildEmployee({ id: 'e1' })],
      })
    );
    expect(out[0].hours).toBe(8);
  });
});

describe('ScheduleOptimizer — greedy constraint tests', () => {
  it('does not assign more than max_staff employees to a shift', async () => {
    const opt = new ScheduleOptimizer();
    // Shift allows at most 2 employees but there are 4 available
    const out = await opt.generateGreedySchedule(
      buildProblem({
        shifts: [buildShift({ id: 's1', min_staff: 4, max_staff: 2 })],
        employees: [
          buildEmployee({ id: 'e1' }),
          buildEmployee({ id: 'e2' }),
          buildEmployee({ id: 'e3' }),
          buildEmployee({ id: 'e4' }),
        ],
      })
    );
    // max_staff=2 caps the assignments even though min_staff asks for 4
    expect(out.length).toBeLessThanOrEqual(2);
  });

  it('blocks assignment when daily hours budget is exhausted', async () => {
    const opt = new ScheduleOptimizer();
    // Employee has max 8h/week => daily budget = max(8, 8/5=1.6) = 8h
    // First shift is 8h; second shift on the same day would exceed budget
    const out = await opt.generateGreedySchedule(
      buildProblem({
        shifts: [
          buildShift({ id: 's1', date: '2026-05-01', start_time: '00:00', end_time: '08:00', min_staff: 1 }),
          buildShift({ id: 's2', date: '2026-05-01', start_time: '10:00', end_time: '14:00', min_staff: 1 }),
        ],
        employees: [buildEmployee({ id: 'e1', max_hours_per_week: 8 })],
      })
    );
    // Only the first shift should be assigned — daily budget exhausted after it
    expect(out).toHaveLength(1);
    expect(out[0].shiftId).toBe('s1');
  });

  it('respects min_staff requirement — assigns exactly min_staff when enough candidates', async () => {
    const opt = new ScheduleOptimizer();
    const out = await opt.generateGreedySchedule(
      buildProblem({
        shifts: [buildShift({ id: 's1', min_staff: 3, max_staff: 5 })],
        employees: [
          buildEmployee({ id: 'e1' }),
          buildEmployee({ id: 'e2' }),
          buildEmployee({ id: 'e3' }),
          buildEmployee({ id: 'e4' }),
          buildEmployee({ id: 'e5' }),
        ],
      })
    );
    expect(out).toHaveLength(3);
  });

  it('skips a fully-unavailable employee while assigning an available one', async () => {
    const opt = new ScheduleOptimizer();
    const out = await opt.generateGreedySchedule(
      buildProblem({
        shifts: [buildShift({ id: 's1', date: '2026-05-01', min_staff: 1 })],
        employees: [
          buildEmployee({ id: 'e1', unavailable_dates: ['2026-05-01'] }),
          buildEmployee({ id: 'e2', unavailable_dates: [] }),
        ],
      })
    );
    expect(out).toHaveLength(1);
    expect(out[0].employeeId).toBe('e2');
  });

  it('requires all skills — rejects employee missing any one required skill', async () => {
    const opt = new ScheduleOptimizer();
    const out = await opt.generateGreedySchedule(
      buildProblem({
        shifts: [
          buildShift({ id: 's1', min_staff: 1, required_skills: ['Triage', 'CPR'] }),
        ],
        employees: [
          buildEmployee({ id: 'e1', skills: ['Triage'] }),           // missing CPR
          buildEmployee({ id: 'e2', skills: ['CPR'] }),              // missing Triage
          buildEmployee({ id: 'e3', skills: ['Triage', 'CPR'] }),   // qualifies
        ],
      })
    );
    expect(out).toHaveLength(1);
    expect(out[0].employeeId).toBe('e3');
  });
});

describe('ScheduleOptimizer.evaluateCandidate (pure unit tests)', () => {
  const buildCtx = (overrides: Partial<CandidateContext> = {}): CandidateContext => ({
    shift: buildShift({ id: 's1', max_staff: 5 }) as any,
    assignedShiftIds: new Set<string>(),
    allShifts: [],
    dailyMinutesMap: new Map<string, number>(),
    currentShiftAssignmentCount: 0,
    currentShiftAssignees: new Set<string>(),
    minRestHoursBetweenShifts: 8,
    ...overrides,
  });

  it('returns true for a clean, unconstrained candidate', () => {
    const opt = new ScheduleOptimizer();
    expect(opt.evaluateCandidate(buildEmployee() as any, buildCtx())).toBe(true);
  });

  it('returns false when max_staff is already reached', () => {
    const opt = new ScheduleOptimizer();
    const ctx = buildCtx({
      shift: buildShift({ id: 's1', max_staff: 2 }) as any,
      currentShiftAssignmentCount: 2,
    });
    expect(opt.evaluateCandidate(buildEmployee() as any, ctx)).toBe(false);
  });

  it('returns false when employee is marked unavailable on that date', () => {
    const opt = new ScheduleOptimizer();
    const emp = buildEmployee({ unavailable_dates: ['2026-05-01'] }) as any;
    expect(opt.evaluateCandidate(emp, buildCtx())).toBe(false);
  });

  it('returns false when daily hours budget would be exceeded', () => {
    const opt = new ScheduleOptimizer();
    // budget = max(8, 16/5=3.2) = 8h; shift is 8h; already has 1h today → total 9h > 8h
    const emp = buildEmployee({ id: 'e1', max_hours_per_week: 16 }) as any;
    const dailyMinutesMap = new Map([['e1|2026-05-01', 60]]);
    const ctx = buildCtx({
      shift: buildShift({ id: 's1', start_time: '08:00', end_time: '16:00' }) as any,
      dailyMinutesMap,
    });
    expect(opt.evaluateCandidate(emp, ctx)).toBe(false);
  });

  it('returns false when an overnight shift overlaps a same-date evening shift', () => {
    const opt = new ScheduleOptimizer();
    // s1 runs 22:00 → 06:00 (crosses midnight); s2 runs 23:00 → 23:59 the same
    // date. Without overnight normalization s1 appears to "end" at 06:00 and
    // the overlap would be missed.
    const overnight = buildShift({ id: 's1', start_time: '22:00', end_time: '06:00' });
    const evening = buildShift({ id: 's2', start_time: '23:00', end_time: '23:59' });
    const ctx = buildCtx({
      shift: evening,
      assignedShiftIds: new Set(['s1']),
      allShifts: [overnight, evening],
    });
    expect(opt.evaluateCandidate(buildEmployee() as any, ctx)).toBe(false);
  });

  it('returns false when a night shift overlaps a shift starting the next day (#835)', () => {
    const opt = new ScheduleOptimizer();
    // 22:00 → 06:00 runs an hour into the next day's 05:00 start. The two
    // start on different dates, which is where the old same-date comparison
    // stopped looking.
    const night = buildShift({ id: 's1', start_time: '22:00', end_time: '06:00' });
    const morning = buildShift({ id: 's2', date: '2026-05-02', start_time: '05:00', end_time: '13:00' });
    const ctx = buildCtx({ shift: morning, assignedShiftIds: new Set(['s1']), allShifts: [night, morning] });
    expect(opt.evaluateCandidate(buildEmployee() as any, ctx)).toBe(false);
  });

  it('treats an overlap as zero rest even with no rest required', () => {
    // The rest rule must not wave an overlap through on the assumption that
    // the overlap rule already refused it.
    const opt = new ScheduleOptimizer();
    const night = buildShift({ id: 's1', start_time: '22:00', end_time: '06:00' });
    const morning = buildShift({ id: 's2', date: '2026-05-02', start_time: '05:00', end_time: '13:00' });
    const ctx = buildCtx({
      shift: morning,
      assignedShiftIds: new Set(['s1']),
      allShifts: [night, morning],
      minRestHoursBetweenShifts: 0,
    });
    expect((opt as any)._wouldViolateMinRest(morning, ctx)).toBe(true);
  });
});

describe('ScheduleOptimizer.optimize falls back to greedy when Python is unavailable', () => {
  it('returns assignments via the fallback path', async () => {
    const opt = new ScheduleOptimizer();
    // We don't need the optimize() public path to actually invoke Python; if
    // it's not available, the implementation falls back to greedy. We just
    // verify it returns a result object without throwing for a tiny problem.
    const result = await opt.generateGreedySchedule(
      buildProblem({
        shifts: [buildShift({ id: 's1', min_staff: 1 })],
        employees: [buildEmployee({ id: 'e1' })],
      })
    );
    expect(result).toHaveLength(1);
  });

  it('optimize() returns GREEDY_FALLBACK status when Python process fails', async () => {
    // Simulate python3 not found by making spawn emit an error event
    const proc = buildHangingProcess();
    mockedSpawn.mockReturnValue(proc);

    const opt = new ScheduleOptimizer();
    const problem = buildProblem({
      shifts: [buildShift({ id: 's1', min_staff: 1 })],
      employees: [buildEmployee({ id: 'e1' })],
    });

    // Start the optimize call, then immediately emit ENOENT to simulate missing python3
    const resultPromise = opt.optimize(problem);
    proc.emit('error', Object.assign(new Error('spawn python3 ENOENT'), { code: 'ENOENT' }));

    const result = await resultPromise;
    expect(result.status).toBe('GREEDY_FALLBACK');
    expect(result.assignments.length).toBeGreaterThanOrEqual(1);
  });
});

/**
 * A run the solver finished without producing a schedule is not a success.
 *
 * Exit code 1 carries a parsed result — but for every status other than
 * OPTIMAL and FEASIBLE that result has no assignments. Passing it through
 * handed the planner an EMPTY schedule labelled as the optimum (#811):
 * MODEL_INVALID from an objective whose coefficients overflow on a realistic
 * instance, UNKNOWN from a time limit hit before any solution, INFEASIBLE
 * from genuinely conflicting hard rules. Each must take the same signalled
 * greedy fallback as a missing python3.
 */
describe('ScheduleOptimizer.optimize degrades on a non-success solver status', () => {
  /** A child process that writes `stdout` and exits with `code` once fed. */
  const buildFinishingProcess = (code: number, stdout: string): any => {
    const proc = buildHangingProcess();
    proc.stdin.end = jest.fn(() =>
      setImmediate(() => {
        proc.stdout.emit('data', Buffer.from(stdout));
        proc.emit('close', code);
      })
    );
    return proc;
  };

  const problem = (): OptimizationProblem =>
    buildProblem({
      shifts: [buildShift({ id: 's1', min_staff: 1 })],
      employees: [buildEmployee({ id: 'e1' })],
    });

  beforeEach(() => {
    mockedSpawn.mockReset();
  });

  it.each(['MODEL_INVALID', 'UNKNOWN', 'INFEASIBLE'])(
    'falls back to greedy, naming the status, when the solver reports %s',
    async (status) => {
      mockedSpawn.mockReturnValue(
        buildFinishingProcess(1, JSON.stringify({ status, assignments: [], statistics: {} }))
      );

      const result = await new ScheduleOptimizer().optimize(problem());

      expect(result.status).toBe('GREEDY_FALLBACK');
      expect(result.assignments).toEqual([expect.objectContaining({ employeeId: 'e1', shiftId: 's1' })]);
      expect(result.error).toContain(status);
    }
  );

  it('carries the script\'s own ERROR reason, not its progress log, on exit 2', async () => {
    // With --stdout the script writes the ERROR JSON to stdout; stderr holds
    // only progress lines, which said nothing about why the run failed.
    const proc = buildFinishingProcess(
      2,
      JSON.stringify({ status: 'ERROR', error: 'Objective magnitude 5e+18 would overflow' })
    );
    mockedSpawn.mockReturnValue(proc);

    const resultPromise = new ScheduleOptimizer().optimize(problem());
    proc.stderr.emit('data', Buffer.from('Building CP-SAT model...\n'));
    const result = await resultPromise;

    expect(result.status).toBe('GREEDY_FALLBACK');
    expect(result.error).toContain('overflow');
    expect(result.error).not.toContain('Building CP-SAT model');
  });

  it('falls back to stderr on a non-zero exit whose stdout is not the ERROR JSON', async () => {
    const proc = buildFinishingProcess(3, 'not json');
    mockedSpawn.mockReturnValue(proc);

    const resultPromise = new ScheduleOptimizer().optimize(problem());
    proc.stderr.emit('data', Buffer.from('Traceback: boom'));
    const result = await resultPromise;

    expect(result.status).toBe('GREEDY_FALLBACK');
    expect(result.error).toContain('Traceback: boom');
  });

  it('maps a FEASIBLE solver result onto the typed assignment shape (#919)', async () => {
    mockedSpawn.mockReturnValue(
      buildFinishingProcess(
        0,
        JSON.stringify({
          status: 'FEASIBLE',
          // The script's real output shape (schedule_optimizer.py _extract_solution):
          // snake_case keys. A camelCase double here is what hid #919.
          assignments: [
            { employee_id: 'e1', shift_id: 's1', date: '2026-03-02', start_time: '09:00', end_time: '17:00', hours: 8 },
          ],
          statistics: { is_optimal: false, total_assigned_shifts: 1 },
        })
      )
    );

    const result = await new ScheduleOptimizer().optimize(problem());

    expect(result.status).toBe('FEASIBLE');
    expect(result.assignments).toEqual([
      { employeeId: 'e1', shiftId: 's1', date: '2026-03-02', startTime: '09:00', endTime: '17:00', hours: 8 },
    ]);
  });
});

/**
 * Explicit tests for the TypeScript-only greedy path, covering the five
 * scenarios requested by the task specification:
 *   1. evaluateCandidate — available employee → true
 *   2. evaluateCandidate — max weekly hours budget exhausted → false
 *   3. evaluateCandidate — overlapping shift already assigned → false
 *   4. generateGreedySchedule — 2 employees, 1 shift → assignments; optimize() wraps as GREEDY_FALLBACK
 *   5. generateGreedySchedule — 0 eligible employees → empty result
 */
describe('Pure TS greedy fallback — specified scenarios', () => {
  const buildCtxSimple = (overrides: Partial<CandidateContext> = {}): CandidateContext => ({
    shift: buildShift({ id: 's1', date: '2026-05-01', start_time: '08:00', end_time: '16:00', max_staff: 5 }) as any,
    assignedShiftIds: new Set<string>(),
    allShifts: [],
    dailyMinutesMap: new Map<string, number>(),
    currentShiftAssignmentCount: 0,
    currentShiftAssignees: new Set<string>(),
    minRestHoursBetweenShifts: 8,
    ...overrides,
  });

  it('scenario 1: evaluateCandidate returns true for an available, unconstrained employee', () => {
    const opt = new ScheduleOptimizer();
    const emp = buildEmployee({ id: 'e1', max_hours_per_week: 40, skills: [], unavailable_dates: [] }) as any;
    expect(opt.evaluateCandidate(emp, buildCtxSimple())).toBe(true);
  });

  it('scenario 2: evaluateCandidate returns false when the daily hours budget is fully consumed', () => {
    const opt = new ScheduleOptimizer();
    // max_hours_per_week=8 → daily budget = max(8, 8/5) = 8h
    // Shift is 8h; employee already has 8h logged today → adding more would exceed the cap
    const emp = buildEmployee({ id: 'e1', max_hours_per_week: 8 }) as any;
    const dailyMinutesMap = new Map([['e1|2026-05-01', 480]]);
    const ctx = buildCtxSimple({
      shift: buildShift({ id: 's1', date: '2026-05-01', start_time: '08:00', end_time: '16:00' }) as any,
      dailyMinutesMap,
    });
    expect(opt.evaluateCandidate(emp, ctx)).toBe(false);
  });

  it('scenario 3: evaluateCandidate returns false when employee already has an overlapping shift', () => {
    const opt = new ScheduleOptimizer();
    const assignedShift = buildShift({
      id: 'assigned-s',
      date: '2026-05-01',
      start_time: '06:00',
      end_time: '14:00',
    });
    const targetShift = buildShift({
      id: 's-target',
      date: '2026-05-01',
      start_time: '12:00',
      end_time: '20:00',
    });
    const emp = buildEmployee({ id: 'e1' }) as any;
    const ctx = buildCtxSimple({
      shift: targetShift as any,
      assignedShiftIds: new Set(['assigned-s']),
      allShifts: [assignedShift as any, targetShift as any],
    });
    expect(opt.evaluateCandidate(emp, ctx)).toBe(false);
  });

  it('scenario 4: generateGreedySchedule with 2 employees and 1 shift returns assignments; optimize() wraps them as GREEDY_FALLBACK', async () => {
    const proc = buildHangingProcess();
    mockedSpawn.mockReturnValue(proc);

    const opt = new ScheduleOptimizer();
    const problem = buildProblem({
      shifts: [buildShift({ id: 's1', min_staff: 1, max_staff: 1 })],
      employees: [buildEmployee({ id: 'e1' }), buildEmployee({ id: 'e2' })],
    });

    // generateGreedySchedule does not invoke spawn, so the mock above only
    // applies to the optimize() call below. Both calls share the same opt
    // instance; the direct greedy call is independent of Python.
    const greedy = await opt.generateGreedySchedule(problem);
    expect(greedy).toHaveLength(1);
    expect(greedy[0].shiftId).toBe('s1');

    // optimize() must return GREEDY_FALLBACK status when Python is unavailable
    const optimizePromise = opt.optimize(problem);
    proc.emit('error', Object.assign(new Error('spawn python3 ENOENT'), { code: 'ENOENT' }));
    const result = await optimizePromise;
    expect(result.status).toBe('GREEDY_FALLBACK');
    expect(result.assignments).toHaveLength(1);
  });

  it('scenario 5: generateGreedySchedule returns an empty array when no employees are eligible', async () => {
    const opt = new ScheduleOptimizer();
    const problem = buildProblem({
      shifts: [buildShift({ id: 's1', date: '2026-05-01', min_staff: 1 })],
      employees: [
        buildEmployee({ id: 'e1', unavailable_dates: ['2026-05-01'] }),
        buildEmployee({ id: 'e2', unavailable_dates: ['2026-05-01'] }),
      ],
    });
    const result = await opt.generateGreedySchedule(problem);
    expect(result).toEqual([]);
  });
});

describe('ScheduleOptimizer._callPythonOptimizer timeout', () => {
  const originalTimeout = config.optimization.timeout;

  beforeEach(() => {
    mockedSpawn.mockReset();
  });

  afterEach(() => {
    config.optimization.timeout = originalTimeout;
  });

  it('kills the process and rejects when the optimizer never settles', async () => {
    // Use a small timeout so the test is fast.
    config.optimization.timeout = 50;

    const proc = buildHangingProcess();
    mockedSpawn.mockReturnValue(proc);

    const opt = new ScheduleOptimizer();
    const problem = buildProblem({
      shifts: [buildShift({ id: 's1', min_staff: 1 })],
      employees: [buildEmployee({ id: 'e1' })],
    });

    // Access the private method via the public-ish surface.
    const promise = (opt as any)._callPythonOptimizer(problem, 300);

    await expect(promise).rejects.toThrow(/timed out after 50ms/);
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
  });
});

/**
 * The solver's budget must fit inside the watchdog with room to spare. It used
 * to BE the watchdog (300 s against 300 000 ms), so a run that searched to its
 * limit after building its model was always killed first and degraded (#837).
 */
describe('solverTimeLimitSeconds (#837)', () => {
  it('keeps a tenth of the default watchdog back', () => {
    expect(solverTimeLimitSeconds(300_000)).toBe(270);
  });

  it('keeps at least five seconds back from a short watchdog', () => {
    expect(solverTimeLimitSeconds(20_000)).toBe(15);
  });

  it('honours a smaller requested limit, and caps a larger one', () => {
    expect(solverTimeLimitSeconds(300_000, 60)).toBe(60);
    expect(solverTimeLimitSeconds(300_000, 600)).toBe(270);
  });

  it('never goes below one second', () => {
    expect(solverTimeLimitSeconds(3_000)).toBe(1);
  });

  it('is what optimize() hands the solver, strictly below the watchdog', async () => {
    mockedSpawn.mockReset();
    const proc = buildHangingProcess();
    mockedSpawn.mockReturnValue(proc);

    const resultPromise = new ScheduleOptimizer().optimize(
      buildProblem({ shifts: [buildShift()], employees: [buildEmployee()] })
    );
    proc.emit('error', new Error('spawn python3 ENOENT'));
    await resultPromise;

    const args: string[] = mockedSpawn.mock.calls[0][1];
    const limit = Number(args[args.indexOf('--time-limit') + 1]);
    expect(limit).toBe(solverTimeLimitSeconds(config.optimization.timeout));
    expect(limit * 1000).toBeLessThan(config.optimization.timeout);
  });
});

/**
 * The child process can fail in ways that are not a solver answer: it exits
 * before reading its input, ignores SIGTERM, or writes without end. Each used
 * to escape this wrapper — an uncaught EPIPE killed the backend, a SIGKILL
 * that could never fire left a solver running, an unbounded buffer grew with
 * the child's output (#836). Each must end in the signalled greedy fallback.
 */
describe('ScheduleOptimizer subprocess failures (#836)', () => {
  const originalTimeout = config.optimization.timeout;
  const problem = (): OptimizationProblem =>
    buildProblem({
      shifts: [buildShift({ id: 's1', min_staff: 1 })],
      employees: [buildEmployee({ id: 'e1' })],
    });

  beforeEach(() => {
    mockedSpawn.mockReset();
  });

  afterEach(() => {
    config.optimization.timeout = originalTimeout;
    jest.useRealTimers();
  });

  it('falls back to greedy when writing the problem fails with EPIPE and the child never exits', async () => {
    jest.useFakeTimers();
    const proc = buildHangingProcess();
    mockedSpawn.mockReturnValue(proc);

    const resultPromise = new ScheduleOptimizer().optimize(problem());
    // What a real pipe emits when the child exits before reading the payload.
    proc.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
    jest.advanceTimersByTime(STDIN_ERROR_GRACE_MS);
    const result = await resultPromise;

    expect(result.status).toBe('GREEDY_FALLBACK');
    expect(result.error).toContain('EPIPE');
    expect(result.assignments).toEqual([expect.objectContaining({ employeeId: 'e1', shiftId: 's1' })]);
  });

  it("reports the child's own reason, not the EPIPE that preceded its exit", async () => {
    // The EPIPE nearly always wins the race with 'close'; settling on it made
    // every such degraded reason "write EPIPE" and dropped the traceback.
    const proc = buildHangingProcess();
    mockedSpawn.mockReturnValue(proc);

    const resultPromise = new ScheduleOptimizer().optimize(problem());
    proc.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
    proc.stderr.emit('data', Buffer.from("ModuleNotFoundError: No module named 'ortools'\n"));
    proc.emit('close', 1);
    const result = await resultPromise;

    expect(result.status).toBe('GREEDY_FALLBACK');
    expect(result.error).toContain("ModuleNotFoundError: No module named 'ortools'");
    expect(result.error).not.toContain('EPIPE');
  });

  it('escalates to SIGKILL when the solver ignores SIGTERM', async () => {
    jest.useFakeTimers();
    config.optimization.timeout = 50;
    const proc = buildHangingProcess();
    mockedSpawn.mockReturnValue(proc);

    const promise = (new ScheduleOptimizer() as any)._callPythonOptimizer(problem(), 1);
    const settled = expect(promise).rejects.toThrow(/timed out/);
    jest.advanceTimersByTime(50);
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    jest.advanceTimersByTime(KILL_GRACE_MS);
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
    await settled;
  });

  it('does not SIGKILL a solver that exited on SIGTERM', async () => {
    jest.useFakeTimers();
    config.optimization.timeout = 50;
    const proc = buildHangingProcess();
    proc.kill = jest.fn((signal: string) => {
      proc.killed = true;
      proc.signalCode = signal;
      return true;
    });
    mockedSpawn.mockReturnValue(proc);

    const promise = (new ScheduleOptimizer() as any)._callPythonOptimizer(problem(), 1);
    const settled = expect(promise).rejects.toThrow(/timed out/);
    jest.advanceTimersByTime(50 + KILL_GRACE_MS);
    expect(proc.kill).toHaveBeenCalledTimes(1);
    await settled;
  });

  it('abandons a solver whose output exceeds the cap, and falls back', async () => {
    config.optimization.timeout = 2000;
    const proc = buildHangingProcess();
    mockedSpawn.mockReturnValue(proc);

    const resultPromise = new ScheduleOptimizer().optimize(problem());
    proc.stdout.emit('data', Buffer.alloc(MAX_STDOUT_BYTES + 1, 0x20));
    const result = await resultPromise;

    expect(result.status).toBe('GREEDY_FALLBACK');
    expect(result.error).toContain('exceeded');
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('keeps only the tail of stderr as the crash reason', async () => {
    const proc = buildHangingProcess();
    mockedSpawn.mockReturnValue(proc);

    const resultPromise = new ScheduleOptimizer().optimize(problem());
    proc.stderr.emit('data', Buffer.from('x'.repeat(4 * MAX_STDERR_TAIL_CHARS)));
    proc.stderr.emit('data', Buffer.from('Traceback: boom'));
    proc.emit('close', 3);
    const result = await resultPromise;

    expect(result.status).toBe('GREEDY_FALLBACK');
    expect(result.error).toContain('Traceback: boom');
    expect(result.error!.length).toBeLessThanOrEqual(MAX_STDERR_TAIL_CHARS + 100);
  });
});
