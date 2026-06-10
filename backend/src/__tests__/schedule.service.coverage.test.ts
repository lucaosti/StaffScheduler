/**
 * ScheduleService coverage supplement — fills gaps not hit by existing test files:
 *   - getAllSchedules with orgUnitIds filter (lines 157-159)
 *   - getAllSchedules with pagination (lines 165-166)
 *   - countSchedules entire method — all filter branches + error (lines 189-222)
 *   - deleteSchedule when affectedRows === 0 (line 312)
 *
 * @author Luca Ostinelli
 */

import { ScheduleService } from '../services/ScheduleService';

type Tuple = [unknown, unknown];

const scheduleRow = {
  id: 1,
  name: 'May 2026',
  department_id: 3,
  department_name: 'Emergency',
  department_org_unit_id: null,
  start_date: '2026-05-01',
  end_date: '2026-05-31',
  status: 'draft',
  published_at: null,
  notes: null,
  created_at: 't',
  updated_at: 't',
  total_shifts: 0,
  total_assignments: 0,
};

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

// ─── getAllSchedules — orgUnitIds and pagination ──────────────────────────────

describe('ScheduleService.getAllSchedules orgUnitIds and pagination', () => {
  it('applies orgUnitIds filter', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[scheduleRow], null] as Tuple);
    const svc = new ScheduleService(pool);
    const out = await svc.getAllSchedules({ orgUnitIds: [5, 6] });
    expect(out.length).toBe(1);
    const sql = execute.mock.calls[0][0] as string;
    expect(sql).toMatch(/d\.org_unit_id IN/);
  });

  it('appends LIMIT/OFFSET when pagination provided', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[scheduleRow], null] as Tuple);
    const svc = new ScheduleService(pool);
    await svc.getAllSchedules({}, { limit: 20, offset: 40 });
    const params = execute.mock.calls[0][1] as unknown[];
    expect(params.slice(-2)).toEqual([20, 40]);
  });
});

// ─── countSchedules ───────────────────────────────────────────────────────────

describe('ScheduleService.countSchedules', () => {
  it('counts without filters', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ total: 7 }], null] as Tuple);
    const svc = new ScheduleService(pool);
    expect(await svc.countSchedules()).toBe(7);
  });

  it('applies departmentId filter', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ total: 2 }], null] as Tuple);
    const svc = new ScheduleService(pool);
    await svc.countSchedules({ departmentId: 3 });
    const sql = execute.mock.calls[0][0] as string;
    expect(sql).toMatch(/s\.department_id/);
  });

  it('applies status filter', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ total: 1 }], null] as Tuple);
    const svc = new ScheduleService(pool);
    await svc.countSchedules({ status: 'published' });
    const sql = execute.mock.calls[0][0] as string;
    expect(sql).toMatch(/s\.status/);
  });

  it('applies startDate and endDate filters', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ total: 3 }], null] as Tuple);
    const svc = new ScheduleService(pool);
    await svc.countSchedules({ startDate: '2026-05-01', endDate: '2026-05-31' });
    const sql = execute.mock.calls[0][0] as string;
    expect(sql).toMatch(/s\.end_date >= \?/);
    expect(sql).toMatch(/s\.start_date <= \?/);
  });

  it('applies orgUnitIds filter', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ total: 4 }], null] as Tuple);
    const svc = new ScheduleService(pool);
    await svc.countSchedules({ orgUnitIds: [1, 2] });
    const sql = execute.mock.calls[0][0] as string;
    expect(sql).toMatch(/d\.org_unit_id IN/);
  });

  it('returns 0 when total absent from result', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{}], null] as Tuple);
    const svc = new ScheduleService(pool);
    expect(await svc.countSchedules()).toBe(0);
  });

  it('bubbles errors', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValueOnce(new Error('db fail'));
    const svc = new ScheduleService(pool);
    await expect(svc.countSchedules()).rejects.toThrow('db fail');
  });
});

// ─── deleteSchedule — affectedRows === 0 ─────────────────────────────────────

describe('ScheduleService.deleteSchedule affectedRows 0', () => {
  it('throws Schedule not found when DELETE hits no rows', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([[{ status: 'draft' }], null])  // SELECT status
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])    // DELETE shift_assignments
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])    // DELETE shift_skills
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])    // DELETE shifts
      .mockResolvedValueOnce([{ affectedRows: 0 }, null]);   // DELETE schedules — 0 rows
    const svc = new ScheduleService(pool);
    await expect(svc.deleteSchedule(1)).rejects.toThrow('Schedule not found');
    expect(conn.rollback).toHaveBeenCalled();
  });
});
