/**
 * AutoScheduleService unit tests (F09).
 *
 * The orchestrator stitches together five SQL queries, the optimizer call,
 * and the bulk-insert transaction. We mock the optimizer so the test stays
 * deterministic and focuses on the data plumbing.
 */

import { AutoScheduleService } from '../services/AutoScheduleService';
import { ScheduleOptimizer } from '../optimization/ScheduleOptimizerORTools';
import { config } from '../config';
import { logger } from '../config/logger';

jest.mock('../optimization/ScheduleOptimizerORTools');

const makePool = () => {
  const execute = jest.fn();
  const conn = {
    execute: jest.fn(),
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
  };
  return {
    pool: { execute, getConnection: jest.fn().mockResolvedValue(conn) } as never,
    execute,
    conn,
  };
};


/**
 * The problem the optimizer was handed, whichever engine ran.
 *
 * Tests placed inside the "engine selection" describe inherit its
 * OPTIMIZATION_ENGINE, so asserting against `generateGreedySchedule` alone
 * passes locally and fails in CI when or-tools is selected and the greedy is
 * never called. Reading from whichever path received the call makes the
 * assertion about the PROBLEM, which is the subject, rather than about engine
 * selection, which is not.
 */
const lastProblemGiven = (): any => {
  const instance = (ScheduleOptimizer as jest.Mock).mock.results.at(-1)!.value;
  const call =
    instance.generateGreedySchedule.mock.calls.at(-1) ?? instance.optimize.mock.calls.at(-1);
  if (!call) throw new Error('the optimizer was never called');
  return call[0];
};

describe('AutoScheduleService.generate', () => {
  const originalEngine = config.optimization.engine;

  beforeEach(() => {
    // These plumbing tests assert on the greedy path; select it explicitly so
    // the default 'or-tools' route (which would call optimize()) is bypassed.
    config.optimization.engine = 'greedy';
    (ScheduleOptimizer as jest.Mock).mockImplementation(() => ({
      generateGreedySchedule: jest.fn().mockResolvedValue([
        { shiftId: '10', employeeId: '1' },
        { shiftId: '11', employeeId: '2' },
      ]),
      optimize: jest.fn().mockResolvedValue({
        status: 'OPTIMAL',
        assignments: [
          { shiftId: '10', employeeId: '1' },
          { shiftId: '11', employeeId: '2' },
        ],
      }),
    }));
  });

  afterEach(() => {
    config.optimization.engine = originalEngine;
  });

  it('throws when the schedule does not exist', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);
    const service = new AutoScheduleService(pool);
    await expect(service.generate(99, 1)).rejects.toThrow(/Schedule not found/);
  });

  it('returns EMPTY when the schedule has no shifts', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ id: 1, department_id: 3, start_date: '2026-05-01', end_date: '2026-05-31' }], null])
      .mockResolvedValueOnce([[], null]); // shifts empty
    const service = new AutoScheduleService(pool);
    const out = await service.generate(1, 7);
    expect(out.status).toBe('EMPTY');
    expect(out.totalShifts).toBe(0);
    expect(out.assignmentsCreated).toBe(0);
  });

  it('runs the optimizer and persists each returned assignment', async () => {
    const { pool, conn, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ id: 1, department_id: 3, start_date: '2026-05-01', end_date: '2026-05-31' }], null]) // schedule
      .mockResolvedValueOnce([
        [
          { id: 10, date: '2026-05-01', start_time: '08:00', end_time: '16:00', min_staff: 2, max_staff: 5, department_id: 3, skill_names: 'Triage' },
          { id: 11, date: '2026-05-01', start_time: '16:00', end_time: '23:59', min_staff: 1, max_staff: 4, department_id: 3, skill_names: null },
        ],
        null,
      ]) // shifts
      .mockResolvedValueOnce([[{ id: 1, skill_names: 'Triage', max_hours_per_week: 40, min_hours_per_week: 0, max_consecutive_days: 5 }], null]) // employees
      .mockResolvedValueOnce([[], null]) // pinned commitments (none)
      .mockResolvedValueOnce([[], null]) // pairing rules (none)
      .mockResolvedValueOnce([[], null]) // employment contracts (none: defaults apply)
      .mockResolvedValueOnce([[], null]) // unavailability
      .mockResolvedValueOnce([[], null]); // external assignments (other schedules)
    conn.execute.mockResolvedValue([{ affectedRows: 2 }, null]);

    const service = new AutoScheduleService(pool);
    const out = await service.generate(1, 7);

    expect(out.status).toBe('OK');
    expect(out.totalShifts).toBe(2);
    expect(out.assignmentsCreated).toBe(2);
    expect(out.coveragePercentage).toBe(100);
    expect(out.engine).toBe('greedy');
    expect(out.degraded).toBe(false);
    expect(conn.commit).toHaveBeenCalled();
  });

  it('persists with one multi-row INSERT and counts only rows actually inserted', async () => {
    const { pool, conn, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ id: 1, department_id: 3, start_date: '2026-05-01', end_date: '2026-05-31' }], null])
      .mockResolvedValueOnce([
        [
          { id: 10, date: '2026-05-01', start_time: '08:00', end_time: '16:00', min_staff: 2, max_staff: 5, department_id: 3, skill_names: '' },
          { id: 11, date: '2026-05-01', start_time: '16:00', end_time: '23:59', min_staff: 1, max_staff: 4, department_id: 3, skill_names: null },
        ],
        null,
      ])
      .mockResolvedValueOnce([[{ id: 1, skill_names: '', max_hours_per_week: 40, min_hours_per_week: 0, max_consecutive_days: 5 }], null])
      .mockResolvedValueOnce([[], null]) // pinned commitments (none)
      .mockResolvedValueOnce([[], null]) // pairing rules (none)
      .mockResolvedValueOnce([[], null]) // employment contracts (none: defaults apply)
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([[], null]);
    // INSERT IGNORE skipped one row (a duplicate assignment already existed).
    conn.execute.mockResolvedValue([{ affectedRows: 1 }, null]);

    const out = await new AutoScheduleService(pool).generate(1, 7);

    // Two assignments -> ONE statement with two value groups, not two statements.
    expect(conn.execute).toHaveBeenCalledTimes(1);
    const [sql, params] = conn.execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/VALUES \(\?, \?, \?, \?\), \(\?, \?, \?, \?\)/);
    expect(params).toHaveLength(8); // 4 bound values per row

    // ...and the count reflects rows the database actually inserted, so an
    // IGNOREd duplicate is not reported as created.
    expect(out.assignmentsCreated).toBe(1);
  });

  it('rolls back when an INSERT fails', async () => {
    const { pool, conn, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ id: 1, department_id: 3, start_date: '2026-05-01', end_date: '2026-05-31' }], null])
      .mockResolvedValueOnce([
        [
          { id: 10, date: '2026-05-01', start_time: '08:00', end_time: '16:00', min_staff: 1, max_staff: 5, department_id: 3, skill_names: '' },
        ],
        null,
      ])
      // Query order: schedule, shifts, employees, pinned commitments, pairing
      // rules, employment contracts, unavailability, external assignments.
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([[], null]); // external assignments (other schedules)
    conn.execute.mockRejectedValue(new Error('insert failed'));

    const service = new AutoScheduleService(pool);
    await expect(service.generate(1, 7)).rejects.toThrow(/insert failed/);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('expands an unavailability date range into a per-day list per user', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute.mockResolvedValue([{ affectedRows: 2 }, null]); // chunked bulk INSERT
    execute
      .mockResolvedValueOnce([[{ id: 1, department_id: 3, start_date: '2026-05-01', end_date: '2026-05-31' }], null])
      .mockResolvedValueOnce([[
        { id: 10, date: '2026-05-01', start_time: '08:00', end_time: '16:00', min_staff: 1, max_staff: 5, department_id: 3, skill_names: '' },
      ], null])
      .mockResolvedValueOnce([[
        { id: 7, skill_names: '', max_hours_per_week: 40, min_hours_per_week: 0, max_consecutive_days: 5 },
      ], null])
      .mockResolvedValueOnce([[], null]) // pinned commitments (none)
      .mockResolvedValueOnce([[], null]) // pairing rules (none)
      .mockResolvedValueOnce([[], null]) // employment contracts (none: defaults apply)
      .mockResolvedValueOnce([[
        { user_id: 7, start_date: new Date('2026-05-01T00:00:00Z'), end_date: new Date('2026-05-03T00:00:00Z') },
      ], null])
      .mockResolvedValueOnce([[], null]); // external assignments (other schedules)

    const service = new AutoScheduleService(pool);
    await service.generate(1, 1);

    const optimizerInstance = (ScheduleOptimizer as jest.Mock).mock.results[0].value;
    const problem = optimizerInstance.generateGreedySchedule.mock.calls[0][0];
    expect(problem.employees[0].unavailable_dates).toEqual(['2026-05-01', '2026-05-02', '2026-05-03']);
  });

  it('feeds other-schedule assignments into the optimizer as busy time', async () => {
    // The ±14-day window query exists so the greedy engine sees cross-schedule
    // commitments; this pins the per-user grouping of those rows.
    const { pool, conn, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ id: 1, department_id: 3, start_date: '2026-05-01', end_date: '2026-05-31' }], null]) // schedule
      .mockResolvedValueOnce([
        [
          { id: 10, date: '2026-05-01', start_time: '08:00', end_time: '16:00', min_staff: 1, max_staff: 5, department_id: 3, skill_names: '' },
        ],
        null,
      ]) // shifts
      .mockResolvedValueOnce([[{ id: 1, skill_names: '', max_hours_per_week: 40, min_hours_per_week: 0, max_consecutive_days: 5 }], null])
      .mockResolvedValueOnce([[], null]) // pinned commitments (none)
      .mockResolvedValueOnce([[], null]) // pairing rules (none) // employees
      .mockResolvedValueOnce([[], null]) // employment contracts (none: defaults apply)
      .mockResolvedValueOnce([[], null]) // unavailability
      .mockResolvedValueOnce([
        [
          { user_id: 1, date: '2026-05-01', start_time: '08:00', end_time: '16:00' },
          { user_id: 1, date: '2026-05-02', start_time: '08:00', end_time: '16:00' },
        ],
        null,
      ]); // external assignments: employee 1 already busy on the 1st
    conn.execute.mockResolvedValue([{ affectedRows: 1 }, null]);

    const service = new AutoScheduleService(pool);
    await service.generate(1, 7);

    // The optimizer is mocked, so the assertion is on the problem plumbing:
    // both external rows must arrive grouped under the employee's
    // existing_assignments so the greedy engine treats them as busy time.
    const optimizerInstance = (ScheduleOptimizer as jest.Mock).mock.results[0].value;
    const problem = optimizerInstance.generateGreedySchedule.mock.calls[0][0];
    expect(problem.employees[0].existing_assignments).toEqual([
      { date: '2026-05-01', start_time: '08:00', end_time: '16:00' },
      { date: '2026-05-02', start_time: '08:00', end_time: '16:00' },
    ]);
  });
});

describe('AutoScheduleService.generate — engine selection and fallback signalling', () => {
  const originalEngine = config.optimization.engine;

  // Standard 5-query happy path: one shift, one eligible employee.
  const primeQueries = (execute: jest.Mock) => {
    execute
      .mockResolvedValueOnce([[{ id: 1, department_id: 3, start_date: '2026-05-01', end_date: '2026-05-31' }], null])
      .mockResolvedValueOnce([[
        { id: 10, date: '2026-05-01', start_time: '08:00', end_time: '16:00', min_staff: 1, max_staff: 5, department_id: 3, skill_names: '' },
      ], null])
      .mockResolvedValueOnce([[{ id: 1, skill_names: '', max_hours_per_week: 40, min_hours_per_week: 0, max_consecutive_days: 5 }], null])
      .mockResolvedValueOnce([[], null]) // pinned commitments (none)
      .mockResolvedValueOnce([[], null]) // pairing rules (none)
      .mockResolvedValueOnce([[], null]) // employment contracts (none: defaults apply)
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([[], null]);
  };

  afterEach(() => {
    config.optimization.engine = originalEngine;
  });

  it('reports engine="or-tools", not degraded, when CP-SAT solves', async () => {
    config.optimization.engine = 'or-tools';
    const optimize = jest.fn().mockResolvedValue({
      status: 'OPTIMAL',
      assignments: [{ shiftId: '10', employeeId: '1' }],
    });
    const generateGreedySchedule = jest.fn();
    (ScheduleOptimizer as jest.Mock).mockImplementation(() => ({ optimize, generateGreedySchedule }));

    const { pool, conn, execute } = makePool();
    primeQueries(execute);
    conn.execute.mockResolvedValue([{ affectedRows: 1 }, null]);

    const out = await new AutoScheduleService(pool).generate(1, 7);

    expect(optimize).toHaveBeenCalled();
    expect(generateGreedySchedule).not.toHaveBeenCalled();
    expect(out.engine).toBe('or-tools');
    expect(out.degraded).toBe(false);
    expect(out.degradedReason).toBeUndefined();
  });

  it('signals a degraded greedy fallback when CP-SAT is unavailable', async () => {
    config.optimization.engine = 'or-tools';
    // optimize() runs its own greedy fallback internally and reports it.
    const optimize = jest.fn().mockResolvedValue({
      status: 'GREEDY_FALLBACK',
      assignments: [{ shiftId: '10', employeeId: '1' }],
      error: 'python3 not found',
    });
    (ScheduleOptimizer as jest.Mock).mockImplementation(() => ({ optimize, generateGreedySchedule: jest.fn() }));

    const { pool, conn, execute } = makePool();
    primeQueries(execute);
    conn.execute.mockResolvedValue([{ affectedRows: 1 }, null]);

    const out = await new AutoScheduleService(pool).generate(1, 7);

    expect(out.engine).toBe('greedy');
    expect(out.degraded).toBe(true);
    expect(out.degradedReason).toContain('python3 not found');
  });

  it('uses the greedy draft engine directly (not degraded) when selected explicitly', async () => {
    config.optimization.engine = 'greedy';
    const optimize = jest.fn();
    const generateGreedySchedule = jest.fn().mockResolvedValue([{ shiftId: '10', employeeId: '1' }]);
    (ScheduleOptimizer as jest.Mock).mockImplementation(() => ({ optimize, generateGreedySchedule }));

    const { pool, conn, execute } = makePool();
    primeQueries(execute);
    conn.execute.mockResolvedValue([{ affectedRows: 1 }, null]);

    const out = await new AutoScheduleService(pool).generate(1, 7);

    expect(generateGreedySchedule).toHaveBeenCalled();
    expect(optimize).not.toHaveBeenCalled();
    expect(out.engine).toBe('greedy');
    expect(out.degraded).toBe(false);
  });

  /**
   * The diff is the deliverable, so both halves of it need covering — and the
   * broken half is the one that matters. A published assignment that
   * disappears is someone who was told they were working and now is not; a
   * re-solve must never do that silently.
   */
  it('reports commitments kept and broken, and warns about the broken ones', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute.mockResolvedValue([{ affectedRows: 1 }, null]);
    execute
      .mockResolvedValueOnce([[{ id: 1, department_id: 3, start_date: '2026-05-01', end_date: '2026-05-31' }], null]) // schedule
      .mockResolvedValueOnce([[
        { id: 10, date: '2026-05-01', start_time: '08:00', end_time: '16:00', min_staff: 1, max_staff: 5, department_id: 3, skill_names: '' },
        { id: 11, date: '2026-05-02', start_time: '08:00', end_time: '16:00', min_staff: 1, max_staff: 5, department_id: 3, skill_names: '' },
      ], null]) // shifts
      .mockResolvedValueOnce([[{ id: 1, skill_names: '', max_hours_per_week: 40, min_hours_per_week: 0, max_consecutive_days: 5 }], null]) // employees
      // Two published commitments; the optimizer below returns only the first.
      .mockResolvedValueOnce([[{ user_id: 1, shift_id: 10 }, { user_id: 1, shift_id: 11 }], null])
      .mockResolvedValueOnce([[], null]) // pairing rules (none)
      .mockResolvedValueOnce([[], null]) // employment contracts
      .mockResolvedValueOnce([[], null]) // unavailability
      .mockResolvedValueOnce([[], null]); // external assignments

    // Both engine paths return the same single assignment, so this test does
    // not depend on which one the ambient OPTIMIZATION_ENGINE selects — the
    // subject is the diff, not engine selection.
    const kept = [
      { employeeId: '1', shiftId: '10', date: '2026-05-01', startTime: '08:00', endTime: '16:00', hours: 8 },
    ];
    const optimizerInstance = {
      generateGreedySchedule: jest.fn().mockResolvedValue(kept),
      optimize: jest.fn().mockResolvedValue({
        status: 'OPTIMAL',
        assignments: kept,
        statistics: { isOptimal: true },
      }),
    };
    (ScheduleOptimizer as jest.Mock).mockImplementation(() => optimizerInstance);

    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    const result = await new AutoScheduleService(pool).generate(1, 1);

    expect(result.keptCommitments).toBe(1);
    expect(result.brokenCommitments).toEqual([{ userId: 1, shiftId: 11 }]);
    // Named in the log, not merely counted: the affected person is the point.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('affected users: 1'));
    warn.mockRestore();
  });

  it('ignores malformed skill and qualification lists from the database', () => {
    // GROUP_CONCAT emits an empty segment when a nullable column is NULL, so
    // rows that state no requirement arrive as "name:" or "name::". Those must
    // be skipped rather than parsed as level 0, which would silently
    // disqualify everyone.
    const { pool, conn, execute } = makePool();
    conn.execute.mockResolvedValue([{ affectedRows: 0 }, null]);
    execute
      .mockResolvedValueOnce([[{ id: 1, department_id: 3, start_date: '2026-05-01', end_date: '2026-05-31' }], null])
      .mockResolvedValueOnce([[
        { id: 10, date: '2026-05-01', start_time: '08:00', end_time: '16:00', min_staff: 1, max_staff: 5,
          department_id: 3, skill_names: 'Triage', skill_levels: 'Triage:', qualified_staff: 'Triage::' },
      ], null])
      .mockResolvedValueOnce([[
        { id: 1, skill_names: 'Triage', skill_levels: 'Triage:', max_hours_per_week: 40,
          min_hours_per_week: 0, max_consecutive_days: 5 },
      ], null])
      .mockResolvedValueOnce([[], null]) // pinned commitments
      .mockResolvedValueOnce([[], null]) // pairing rules
      .mockResolvedValueOnce([[], null]) // employment contracts
      .mockResolvedValueOnce([[], null]) // unavailability
      .mockResolvedValueOnce([[], null]); // external assignments

    return new AutoScheduleService(pool).generate(1, 1).then(() => {
      const problem = lastProblemGiven();
      expect(problem.shifts[0].required_skill_levels).toEqual({});
      expect(problem.shifts[0].qualified_staff).toEqual({});
      expect(problem.employees[0].skill_levels).toEqual({});
    });
  });

  it('carries well-formed skill levels and qualification requirements through', () => {
    // The counterpart of the malformed case: the parsers must still populate
    // when the columns ARE set, or the previous test would pass against a
    // parser that simply returned nothing.
    const { pool, conn, execute } = makePool();
    conn.execute.mockResolvedValue([{ affectedRows: 0 }, null]);
    execute
      .mockResolvedValueOnce([[{ id: 1, department_id: 3, start_date: '2026-05-01', end_date: '2026-05-31' }], null])
      .mockResolvedValueOnce([[
        { id: 10, date: '2026-05-01', start_time: '08:00', end_time: '16:00', min_staff: 1, max_staff: 5,
          department_id: 3, skill_names: 'Triage', skill_levels: 'Triage:3', qualified_staff: 'Triage:5:1' },
      ], null])
      .mockResolvedValueOnce([[
        { id: 1, skill_names: 'Triage', skill_levels: 'Triage:4', max_hours_per_week: 40,
          min_hours_per_week: 0, max_consecutive_days: 5 },
      ], null])
      .mockResolvedValueOnce([[], null]) // pinned commitments
      .mockResolvedValueOnce([[], null]) // pairing rules
      .mockResolvedValueOnce([[], null]) // employment contracts
      .mockResolvedValueOnce([[], null]) // unavailability
      .mockResolvedValueOnce([[], null]); // external assignments

    return new AutoScheduleService(pool).generate(1, 1).then(() => {
      const problem = lastProblemGiven();
      expect(problem.shifts[0].required_skill_levels).toEqual({ Triage: 3 });
      expect(problem.shifts[0].qualified_staff).toEqual({ Triage: { level: 5, count: 1 } });
      expect(problem.employees[0].skill_levels).toEqual({ Triage: 4 });
    });
  });
});
