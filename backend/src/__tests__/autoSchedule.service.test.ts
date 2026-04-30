/**
 * AutoScheduleService unit tests (F09).
 *
 * The orchestrator stitches together five SQL queries, the optimizer call,
 * and the bulk-insert transaction. We mock the optimizer so the test stays
 * deterministic and focuses on the data plumbing.
 */

const mockOptimize = jest.fn();
const mockGreedy = jest.fn();

const mockCtor = jest.fn().mockImplementation(() => ({
    optimize: mockOptimize,
    generateGreedySchedule: mockGreedy,
  }));

jest.mock('../optimization/ScheduleOptimizerORTools', () => ({
  ScheduleOptimizer: mockCtor,
}));

import { AutoScheduleService } from '../services/AutoScheduleService';

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
  beforeEach(() => {
    delete process.env.OPTIMIZATION_ENGINE;
    mockOptimize.mockReset();
    mockGreedy.mockReset();
    mockGreedy.mockResolvedValue([
      { shiftId: '10', employeeId: '1' },
      { shiftId: '11', employeeId: '2' },
    ]);
    mockOptimize.mockResolvedValue({
      status: 'OPTIMAL',
      solveTimeSeconds: 0.1,
      assignments: [
        { shiftId: '10', employeeId: '1' },
        { shiftId: '11', employeeId: '2' },
      ],
      statistics: { isOptimal: true, totalAssignedShifts: 2, coverageStats: { totalShifts: 2, fullyCoveredShifts: 2, coveragePercentage: 100 } },
    });
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
      .mockResolvedValueOnce([[], null]); // unavailability
    conn.execute.mockResolvedValue([{ affectedRows: 1 }, null]);

    const service = new AutoScheduleService(pool);
    const out = await service.generate(1, 7);

    expect(out.status).toBe('OK');
    expect(out.totalShifts).toBe(2);
    expect(out.assignmentsCreated).toBe(2);
    expect(out.coveragePercentage).toBe(100);
    expect(conn.commit).toHaveBeenCalled();
    expect(mockGreedy).toHaveBeenCalled();
  });

  it('uses the Python optimizer when OPTIMIZATION_ENGINE=or-tools', async () => {
    process.env.OPTIMIZATION_ENGINE = 'or-tools';
    jest.resetModules();
    const { AutoScheduleService: FreshService } = await import('../services/AutoScheduleService');
    const { pool, conn, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ id: 1, department_id: 3, start_date: '2026-05-01', end_date: '2026-05-31' }], null])
      .mockResolvedValueOnce([
        [
          { id: 10, date: '2026-05-01', start_time: '08:00', end_time: '16:00', min_staff: 2, max_staff: 5, department_id: 3, skill_names: 'Triage' },
          { id: 11, date: '2026-05-01', start_time: '16:00', end_time: '23:59', min_staff: 1, max_staff: 4, department_id: 3, skill_names: null },
        ],
        null,
      ])
      .mockResolvedValueOnce([[{ id: 1, skill_names: 'Triage', max_hours_per_week: 40, min_hours_per_week: 0, max_consecutive_days: 5 }], null])
      .mockResolvedValueOnce([[], null]);
    conn.execute.mockResolvedValue([{ affectedRows: 1 }, null]);

    const service = new FreshService(pool);
    const out = await service.generate(1, 7);

    expect(out.status).toBe('OK');
    expect(mockOptimize).toHaveBeenCalled();
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
      .mockResolvedValueOnce([[], null]);
    conn.execute.mockRejectedValue(new Error('insert failed'));

    const service = new AutoScheduleService(pool);
    await expect(service.generate(1, 7)).rejects.toThrow(/insert failed/);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('only counts rows that were actually inserted (INSERT IGNORE skip)', async () => {
    const { pool, conn, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ id: 1, department_id: 3, start_date: '2026-05-01', end_date: '2026-05-31' }], null])
      .mockResolvedValueOnce([
        [
          { id: 10, date: '2026-05-01', start_time: '08:00', end_time: '16:00', min_staff: 1, max_staff: 5, department_id: 3, skill_names: '' },
          { id: 11, date: '2026-05-01', start_time: '16:00', end_time: '23:59', min_staff: 1, max_staff: 5, department_id: 3, skill_names: '' },
        ],
        null,
      ])
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([[], null]);
    // First insert succeeds, second is skipped (duplicate row → affectedRows = 0).
    conn.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])
      .mockResolvedValueOnce([{ affectedRows: 0 }, null]);

    const service = new AutoScheduleService(pool);
    const out = await service.generate(1, 7);

    expect(out.assignmentsCreated).toBe(1);
    expect(out.totalShifts).toBe(2);
    expect(out.coveragePercentage).toBe(50);
  });

  it('expands an unavailability date range into a per-day list per user', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute.mockResolvedValue([{ affectedRows: 1 }, null]);
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
      ], null]);

    const service = new AutoScheduleService(pool);
    await service.generate(1, 1);

    const problem = mockGreedy.mock.calls[0][0];
    expect(problem.employees[0].unavailable_dates).toEqual(['2026-05-01', '2026-05-02', '2026-05-03']);
  });
});
