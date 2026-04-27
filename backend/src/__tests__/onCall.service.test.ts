/**
 * OnCallService tests (F21).
 */

import { OnCallService } from '../services/OnCallService';

const buildPeriodRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  schedule_id: null,
  department_id: 3,
  department_name: 'Emergency',
  date: '2026-05-01',
  start_time: '20:00',
  end_time: '08:00',
  min_staff: 2,
  max_staff: 4,
  notes: null,
  status: 'open',
  assigned_count: 0,
  created_at: '2026-04-26',
  updated_at: '2026-04-26',
  ...overrides,
});

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

describe('OnCallService.createPeriod', () => {
  it('rejects min_staff < 1', async () => {
    const { pool } = makePool();
    const service = new OnCallService(pool);
    await expect(
      service.createPeriod({
        departmentId: 3,
        date: '2026-05-01',
        startTime: '20:00',
        endTime: '08:00',
        minStaff: 0,
      })
    ).rejects.toThrow(/minStaff/);
  });

  it('rejects when max < min', async () => {
    const { pool } = makePool();
    const service = new OnCallService(pool);
    await expect(
      service.createPeriod({
        departmentId: 3,
        date: '2026-05-01',
        startTime: '20:00',
        endTime: '08:00',
        minStaff: 3,
        maxStaff: 1,
      })
    ).rejects.toThrow(/maxStaff/);
  });

  it('rejects malformed date / time inputs', async () => {
    const { pool } = makePool();
    const service = new OnCallService(pool);
    await expect(
      service.createPeriod({
        departmentId: 3,
        date: 'next tuesday',
        startTime: '20:00',
        endTime: '08:00',
      })
    ).rejects.toThrow(/Invalid date/);
    await expect(
      service.createPeriod({
        departmentId: 3,
        date: '2026-05-01',
        startTime: '8pm',
        endTime: '08:00',
      })
    ).rejects.toThrow(/Invalid startTime/);
  });

  it('inserts and returns the persisted period', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ insertId: 7 }, null]) // INSERT
      .mockResolvedValueOnce([[buildPeriodRow({ id: 7 })], null]); // refetch (getPeriodById)
    const service = new OnCallService(pool);
    const period = await service.createPeriod({
      departmentId: 3,
      date: '2026-05-01',
      startTime: '20:00',
      endTime: '08:00',
      minStaff: 2,
      maxStaff: 3,
    });
    expect(period.id).toBe(7);
    expect(period.minStaff).toBe(2);
  });
});

describe('OnCallService.listPeriods', () => {
  it('layers department, status, and date-range filters', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildPeriodRow()], null]);
    const service = new OnCallService(pool);
    await service.listPeriods({
      departmentId: 3,
      status: 'open',
      rangeStart: '2026-05-01',
      rangeEnd: '2026-05-31',
    });
    const sql = execute.mock.calls[0][0] as string;
    expect(sql).toMatch(/p\.department_id = \?/);
    expect(sql).toMatch(/p\.status = \?/);
    expect(sql).toMatch(/p\.date >= \?/);
    expect(sql).toMatch(/p\.date <= \?/);
  });
});

describe('OnCallService.assign', () => {
  it('rejects when the period is at capacity', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[{ id: 1, max_staff: 2, assigned_count: 2 }], null]);
    const service = new OnCallService(pool);
    await expect(service.assign(1, 7, 99)).rejects.toThrow(/max capacity/);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('inserts an assignment and promotes period status when min_staff is reached', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[{ id: 1, max_staff: 4, assigned_count: 1 }], null])
      .mockResolvedValueOnce([{ insertId: 5 }, null]) // INSERT assignment
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // status promote
    execute.mockResolvedValueOnce([
      [
        {
          id: 5,
          period_id: 1,
          user_id: 7,
          status: 'pending',
          assigned_at: '2026-04-26',
          assigned_by: 99,
          notes: null,
        },
      ],
      null,
    ]);
    const service = new OnCallService(pool);
    const out = await service.assign(1, 7, 99);
    expect(out.userId).toBe(7);
    expect(conn.commit).toHaveBeenCalled();
  });
});

describe('OnCallService.listForUser', () => {
  it('joins on assignments and filters by date range', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [
        {
          ...buildPeriodRow(),
          a_status: 'confirmed',
        },
      ],
      null,
    ]);
    const service = new OnCallService(pool);
    const out = await service.listForUser(7, {
      rangeStart: '2026-05-01',
      rangeEnd: '2026-05-31',
    });
    expect(out).toHaveLength(1);
    expect(out[0].assignmentStatus).toBe('confirmed');
  });
});

describe('OnCallService.deletePeriod', () => {
  it('throws when no row matched', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ affectedRows: 0 }, null]);
    const service = new OnCallService(pool);
    await expect(service.deletePeriod(99)).rejects.toThrow(/not found/);
  });

  it('returns true on a successful delete', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    const service = new OnCallService(pool);
    expect(await service.deletePeriod(1)).toBe(true);
  });
});
