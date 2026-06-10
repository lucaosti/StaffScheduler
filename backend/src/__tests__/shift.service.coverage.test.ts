/**
 * ShiftService coverage supplement — fills gaps not hit by existing test files:
 *   - createShift post-insert fetch returns empty (line 107)
 *   - getAllShifts with orgUnitIds filter (lines 280-282)
 *   - getAllShifts with pagination (lines 291-292)
 *   - countShifts — entire method (all filters + error) (lines 333-355)
 *   - deleteShift when affectedRows === 0 (line 477)
 *
 * @author Luca Ostinelli
 */

import { ShiftService } from '../services/ShiftService';

type Tuple = [unknown, unknown];

const shiftRow = {
  id: 1,
  schedule_id: 1,
  schedule_name: 'May',
  department_id: 3,
  department_name: 'ICU',
  template_id: null,
  date: '2026-05-01',
  start_time: '08:00',
  end_time: '16:00',
  min_staff: 1,
  max_staff: 5,
  notes: null,
  status: 'open',
  assigned_staff: 0,
  created_at: 't',
  updated_at: 't',
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

// ─── createShift — post-insert fetch empty ────────────────────────────────────

describe('ShiftService.createShift post-insert empty', () => {
  it('throws when getShiftById returns null after insert', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[{ id: 1 }], null])     // dept check
      .mockResolvedValueOnce([{ insertId: 10 }, null]) // INSERT shift
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // INSERT skills (none — requiredSkillIds empty)
    // getShiftById calls pool.execute (not conn.execute)
    execute
      .mockResolvedValueOnce([[], null] as Tuple); // getShiftById returns empty
    const svc = new ShiftService(pool);
    await expect(
      svc.createShift({
        scheduleId: 1,
        departmentId: 3,
        date: '2026-05-01',
        startTime: '08:00',
        endTime: '16:00',
        minStaff: 1,
        maxStaff: 5,
      })
    ).rejects.toThrow('Failed to retrieve created shift');
    expect(conn.rollback).toHaveBeenCalled();
  });
});

// ─── getAllShifts — orgUnitIds and pagination ─────────────────────────────────

describe('ShiftService.getAllShifts orgUnitIds and pagination', () => {
  it('applies orgUnitIds filter', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[shiftRow], null] as Tuple);
    const svc = new ShiftService(pool);
    const out = await svc.getAllShifts({ orgUnitIds: [1, 2] });
    expect(out.length).toBe(1);
    const sql = execute.mock.calls[0][0] as string;
    expect(sql).toMatch(/d\.org_unit_id IN/);
  });

  it('appends LIMIT/OFFSET when pagination provided', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[shiftRow], null] as Tuple);
    const svc = new ShiftService(pool);
    await svc.getAllShifts({}, { limit: 25, offset: 50 });
    const params = execute.mock.calls[0][1] as unknown[];
    expect(params.slice(-2)).toEqual([25, 50]);
  });
});

// ─── countShifts ─────────────────────────────────────────────────────────────

describe('ShiftService.countShifts', () => {
  it('counts without filters', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ total: 10 }], null] as Tuple);
    const svc = new ShiftService(pool);
    expect(await svc.countShifts()).toBe(10);
  });

  it('applies scheduleId filter', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ total: 3 }], null] as Tuple);
    const svc = new ShiftService(pool);
    await svc.countShifts({ scheduleId: 5 });
    const sql = execute.mock.calls[0][0] as string;
    expect(sql).toMatch(/s\.schedule_id/);
  });

  it('applies departmentId filter', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ total: 2 }], null] as Tuple);
    const svc = new ShiftService(pool);
    await svc.countShifts({ departmentId: 3 });
    const sql = execute.mock.calls[0][0] as string;
    expect(sql).toMatch(/s\.department_id/);
  });

  it('applies startDate and endDate filters', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ total: 4 }], null] as Tuple);
    const svc = new ShiftService(pool);
    await svc.countShifts({ startDate: '2026-05-01', endDate: '2026-05-31' });
    const sql = execute.mock.calls[0][0] as string;
    expect(sql).toMatch(/s\.date >= \?/);
    expect(sql).toMatch(/s\.date <= \?/);
  });

  it('applies status filter', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ total: 1 }], null] as Tuple);
    const svc = new ShiftService(pool);
    await svc.countShifts({ status: 'open' });
    const sql = execute.mock.calls[0][0] as string;
    expect(sql).toMatch(/s\.status/);
  });

  it('applies orgUnitIds filter', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ total: 5 }], null] as Tuple);
    const svc = new ShiftService(pool);
    await svc.countShifts({ orgUnitIds: [10, 11] });
    const sql = execute.mock.calls[0][0] as string;
    expect(sql).toMatch(/d\.org_unit_id IN/);
  });

  it('returns 0 when total is absent from result row', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{}], null] as Tuple);
    const svc = new ShiftService(pool);
    expect(await svc.countShifts()).toBe(0);
  });

  it('bubbles errors', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValueOnce(new Error('db gone'));
    const svc = new ShiftService(pool);
    await expect(svc.countShifts()).rejects.toThrow('db gone');
  });
});

// ─── deleteShift — affectedRows === 0 ────────────────────────────────────────

describe('ShiftService.deleteShift affectedRows 0', () => {
  it('throws Shift not found when delete hits no rows', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])  // DELETE shift_assignments
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])  // DELETE shift_skills
      .mockResolvedValueOnce([{ affectedRows: 0 }, null]); // DELETE shifts — 0 rows
    const svc = new ShiftService(pool);
    await expect(svc.deleteShift(1)).rejects.toThrow('Shift not found');
    expect(conn.rollback).toHaveBeenCalled();
  });
});
