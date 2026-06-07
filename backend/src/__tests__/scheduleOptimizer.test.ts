/**
 * ScheduleOptimizer (OR-Tools wrapper + greedy fallback) tests.
 *
 * The Python path is mocked away — we only test the greedy fallback,
 * evaluateCandidate(), problem validation, and the helpers
 * (_hasOverlappingShift, _timesOverlap, _calculateShiftHours) via the
 * public surface.
 */

import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { config } from '../config';
import {
  ScheduleOptimizer,
  OptimizationProblem,
  CandidateContext,
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
  proc.stdin = { write: jest.fn(), end: jest.fn() };
  proc.killed = false;
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
    dailyHoursMap: new Map<string, number>(),
    currentShiftAssignmentCount: 0,
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
    const dailyHoursMap = new Map([['e1|2026-05-01', 1]]);
    const ctx = buildCtx({
      shift: buildShift({ id: 's1', start_time: '08:00', end_time: '16:00' }) as any,
      dailyHoursMap,
    });
    expect(opt.evaluateCandidate(emp, ctx)).toBe(false);
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
    dailyHoursMap: new Map<string, number>(),
    currentShiftAssignmentCount: 0,
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
    const dailyHoursMap = new Map([['e1|2026-05-01', 8]]);
    const ctx = buildCtxSimple({
      shift: buildShift({ id: 's1', date: '2026-05-01', start_time: '08:00', end_time: '16:00' }) as any,
      dailyHoursMap,
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
