/**
 * Extended ShiftService coverage targeting:
 *   - getShiftById row mapping (with skills + assignments)
 *   - getAllShifts mapping
 *   - updateShift dynamic field building (incl. requiredSkillIds)
 *   - deleteShift happy path
 *   - createShiftsFromTemplate (template lookup, day filter, skill propagation)
 *   - getUnassignedShifts and getShiftsByDateRange
 *   - shift template CRUD (list, get, create, update, delete)
 *
 * @author Luca Ostinelli
 */

import { ShiftService } from '../services/ShiftService';

type Tuple = [unknown, unknown];

const buildShiftRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  schedule_id: 1,
  department_id: 3,
  department_name: 'Emergency',
  template_id: null,
  date: '2026-05-01',
  start_time: '08:00',
  end_time: '16:00',
  min_staff: 1,
  max_staff: 5,
  notes: null,
  status: 'open',
  schedule_name: 'May',
  assigned_staff: 0,
  created_at: 't',
  updated_at: 't',
  ...overrides,
});

const skillRow = {
  id: 1,
  name: 'CPR',
  description: '',
  is_active: 1,
  created_at: 't',
};

const assignmentRow = {
  id: 1,
  shift_id: 1,
  user_id: 7,
  status: 'pending',
  assigned_at: 't',
  confirmed_at: null,
  notes: null,
  first_name: 'A',
  last_name: 'B',
  email: 'a@b',
};

const templateRow = {
  id: 1,
  name: 'Morning',
  description: 'd',
  department_id: 3,
  start_time: '08:00',
  end_time: '16:00',
  min_staff: 1,
  max_staff: 4,
  is_active: 1,
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
  const getConnection = jest.fn().mockResolvedValue(conn);
  return { pool: { execute, getConnection } as never, execute, conn };
};

describe('ShiftService.getShiftById (full mapping)', () => {
  it('returns mapped shift with skills + assignments', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[buildShiftRow()], null] as Tuple)
      .mockResolvedValueOnce([[skillRow], null] as Tuple)
      .mockResolvedValueOnce([[assignmentRow], null] as Tuple);
    const svc = new ShiftService(pool);
    const r = await svc.getShiftById(1);
    expect(r?.requiredSkills?.length).toBe(1);
    expect(r?.assignments?.length).toBe(1);
  });

  it('bubbles error', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValueOnce(new Error('boom'));
    const svc = new ShiftService(pool);
    await expect(svc.getShiftById(1)).rejects.toThrow(/boom/);
  });
});

describe('ShiftService.getAllShifts', () => {
  it('returns mapped shifts when filters omitted', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildShiftRow()], null] as Tuple);
    const svc = new ShiftService(pool);
    const r = await svc.getAllShifts();
    expect(r.length).toBe(1);
  });

  it('bubbles errors', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValueOnce(new Error('boom'));
    const svc = new ShiftService(pool);
    await expect(svc.getAllShifts()).rejects.toThrow(/boom/);
  });
});

describe('ShiftService.updateShift', () => {
  it('updates dynamic fields and refreshes', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    execute
      .mockResolvedValueOnce([[buildShiftRow()], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple);
    const svc = new ShiftService(pool);
    const r = await svc.updateShift(1, {
      date: '2026-05-02',
      startTime: '07:00',
      endTime: '15:00',
      minStaff: 2,
      maxStaff: 6,
      status: 'open',
      notes: 'note',
    } as never);
    expect(r.id).toBe(1);
  });

  it('updates required skills (replace path)', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // delete existing skills
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // insert new skill
    execute
      .mockResolvedValueOnce([[buildShiftRow()], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple);
    const svc = new ShiftService(pool);
    const r = await svc.updateShift(1, { requiredSkillIds: [9] } as never);
    expect(r.id).toBe(1);
  });

  it('throws when refresh returns null', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new ShiftService(pool);
    await expect(svc.updateShift(1, { status: 'cancelled' } as never)).rejects.toThrow(
      /Shift not found after update/
    );
  });
});

describe('ShiftService.deleteShift happy', () => {
  it('returns true', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // delete shift_assignments
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // delete shift_skills
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // delete shift
    const svc = new ShiftService(pool);
    expect(await svc.deleteShift(1)).toBe(true);
  });
});

describe('ShiftService.createShiftsFromTemplate', () => {
  it('throws when template missing', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[], null]);
    const svc = new ShiftService(pool);
    await expect(
      svc.createShiftsFromTemplate(99, 1, new Date('2026-05-01'), new Date('2026-05-01'), [4])
    ).rejects.toThrow(/template not found/);
  });

  it('inserts only on selected days', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([[templateRow], null]) // template
      .mockResolvedValueOnce([[{ skill_id: 1 }], null]) // template skills
      .mockResolvedValueOnce([{ insertId: 11 }, null]) // INSERT shift
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // INSERT shift_skills
    const svc = new ShiftService(pool);
    // 2026-05-01 is a Friday (5). daysOfWeek=[5] selects it.
    const ids = await svc.createShiftsFromTemplate(
      1,
      1,
      new Date('2026-05-01'),
      new Date('2026-05-01'),
      [5]
    );
    expect(ids).toEqual([11]);
  });

  it('returns empty when no days match', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([[templateRow], null])
      .mockResolvedValueOnce([[], null]);
    const svc = new ShiftService(pool);
    const ids = await svc.createShiftsFromTemplate(
      1,
      1,
      new Date('2026-05-01'),
      new Date('2026-05-01'),
      [0] // Sunday only
    );
    expect(ids).toEqual([]);
  });
});

describe('ShiftService.getUnassignedShifts', () => {
  it('with scheduleId filter', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildShiftRow()], null] as Tuple);
    const svc = new ShiftService(pool);
    const r = await svc.getUnassignedShifts(1);
    expect(r.length).toBe(1);
    expect(execute.mock.calls[0][0]).toMatch(/s\.schedule_id = \?/);
  });

  it('without scheduleId filter', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildShiftRow()], null] as Tuple);
    const svc = new ShiftService(pool);
    const r = await svc.getUnassignedShifts();
    expect(r.length).toBe(1);
  });

  it('bubbles errors', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValueOnce(new Error('boom'));
    const svc = new ShiftService(pool);
    await expect(svc.getUnassignedShifts()).rejects.toThrow(/boom/);
  });
});

describe('ShiftService.getShiftsByDateRange / BySchedule / ByDepartment', () => {
  it('all forward to getAllShifts', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValue([[buildShiftRow()], null] as Tuple);
    const svc = new ShiftService(pool);
    expect((await svc.getShiftsByDateRange('2026-05-01', '2026-05-31')).length).toBe(1);
    expect((await svc.getShiftsByDateRange('2026-05-01', '2026-05-31', 3)).length).toBe(1);
    expect((await svc.getShiftsBySchedule(1)).length).toBe(1);
    expect((await svc.getShiftsByDepartment(3)).length).toBe(1);
  });
});

describe('ShiftService.getShiftStatistics', () => {
  it('handles empty schedule (no scheduleId filter)', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [{ total: 0, assigned: 0, fully_staffed: 0, understaffed: 0, overstaffed: 0 }],
      null,
    ] as Tuple);
    const svc = new ShiftService(pool);
    const s = await svc.getShiftStatistics();
    expect(s.total).toBe(0);
  });

  it('bubbles errors', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValueOnce(new Error('boom'));
    const svc = new ShiftService(pool);
    await expect(svc.getShiftStatistics(1)).rejects.toThrow(/boom/);
  });
});

describe('ShiftService templates', () => {
  it('getAllShiftTemplates errors bubble', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValueOnce(new Error('boom'));
    const svc = new ShiftService(pool);
    await expect(svc.getAllShiftTemplates()).rejects.toThrow(/boom/);
  });

  it('getShiftTemplateById null + mapping + error', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[], null] as Tuple)
      .mockResolvedValueOnce([[templateRow], null] as Tuple)
      .mockRejectedValueOnce(new Error('boom'));
    const svc = new ShiftService(pool);
    expect(await svc.getShiftTemplateById(99)).toBeNull();
    expect((await svc.getShiftTemplateById(1))?.name).toBe('Morning');
    await expect(svc.getShiftTemplateById(1)).rejects.toThrow(/boom/);
  });

  it('createShiftTemplate inserts and returns', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute.mockResolvedValueOnce([{ insertId: 5 }, null]);
    execute.mockResolvedValueOnce([[{ ...templateRow, id: 5 }], null] as Tuple);
    const svc = new ShiftService(pool);
    const r = await svc.createShiftTemplate({
      name: 'X',
      departmentId: 3,
      startTime: '08:00',
      endTime: '16:00',
      minStaff: 1,
      maxStaff: 4,
    });
    expect(r.id).toBe(5);
  });

  it('createShiftTemplate rolls back on error', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockRejectedValueOnce(new Error('boom'));
    const svc = new ShiftService(pool);
    await expect(svc.createShiftTemplate({ name: 'X' })).rejects.toThrow(/boom/);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('updateShiftTemplate persists each provided field', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    execute.mockResolvedValueOnce([[templateRow], null] as Tuple);
    const svc = new ShiftService(pool);
    const r = await svc.updateShiftTemplate(1, {
      name: 'New',
      description: 'd',
      startTime: '07',
      endTime: '15',
      minStaff: 1,
      maxStaff: 5,
    });
    expect(r.name).toBe('Morning');
  });

  it('updateShiftTemplate skips UPDATE when no fields', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[templateRow], null] as Tuple);
    const svc = new ShiftService(pool);
    const r = await svc.updateShiftTemplate(1, {});
    expect(r.id).toBe(1);
  });

  it('updateShiftTemplate rolls back on error', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockRejectedValueOnce(new Error('boom'));
    const svc = new ShiftService(pool);
    await expect(svc.updateShiftTemplate(1, { name: 'X' })).rejects.toThrow(/boom/);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('deleteShiftTemplate marks inactive', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    const svc = new ShiftService(pool);
    expect(await svc.deleteShiftTemplate(1)).toBe(true);
  });

  it('deleteShiftTemplate rolls back on error', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockRejectedValueOnce(new Error('boom'));
    const svc = new ShiftService(pool);
    await expect(svc.deleteShiftTemplate(1)).rejects.toThrow(/boom/);
    expect(conn.rollback).toHaveBeenCalled();
  });
});
