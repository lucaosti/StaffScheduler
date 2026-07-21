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
      .mockResolvedValueOnce([[], null]) // unavailability
      .mockResolvedValueOnce([[], null]); // external assignments (other schedules)
    conn.execute.mockResolvedValue([{ affectedRows: 1 }, null]);

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
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([[], null]); // external assignments (other schedules)
    conn.execute.mockRejectedValue(new Error('insert failed'));

    const service = new AutoScheduleService(pool);
    await expect(service.generate(1, 7)).rejects.toThrow(/insert failed/);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('expands an unavailability date range into a per-day list per user', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ id: 1, department_id: 3, start_date: '2026-05-01', end_date: '2026-05-31' }], null])
      .mockResolvedValueOnce([[
        { id: 10, date: '2026-05-01', start_time: '08:00', end_time: '16:00', min_staff: 1, max_staff: 5, department_id: 3, skill_names: '' },
      ], null])
      .mockResolvedValueOnce([[
        { id: 7, skill_names: '', max_hours_per_week: 40, min_hours_per_week: 0, max_consecutive_days: 5 },
      ], null])
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
      .mockResolvedValueOnce([[{ id: 1, skill_names: '', max_hours_per_week: 40, min_hours_per_week: 0, max_consecutive_days: 5 }], null]) // employees
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
});
