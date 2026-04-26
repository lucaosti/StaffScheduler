/**
 * ShiftService unit tests.
 */

import { ShiftService } from '../services/ShiftService';

const buildShiftRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  schedule_id: 1,
  department_id: 3,
  department_name: 'Emergency',
  template_id: null,
  date: '2026-05-01',
  start_time: '08:00',
  end_time: '16:00',
  min_staff: 3,
  max_staff: 6,
  notes: null,
  status: 'open',
  schedule_name: 'May 2026',
  assigned_staff: 0,
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

describe('ShiftService.createShift', () => {
  it('rolls back when the schedule does not exist', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[], null]);
    const service = new ShiftService(pool);
    await expect(
      service.createShift({
        scheduleId: 99,
        departmentId: 3,
        date: '2026-05-01',
        startTime: '08:00',
        endTime: '16:00',
        minStaff: 1,
        maxStaff: 5,
      } as never)
    ).rejects.toThrow(/Schedule not found/);
  });

  it('rolls back when the department does not exist', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([[{ id: 1 }], null])
      .mockResolvedValueOnce([[], null]);
    const service = new ShiftService(pool);
    await expect(
      service.createShift({
        scheduleId: 1,
        departmentId: 99,
        date: '2026-05-01',
        startTime: '08:00',
        endTime: '16:00',
        minStaff: 1,
        maxStaff: 5,
      } as never)
    ).rejects.toThrow(/Department not found/);
  });

  it('inserts and links required skills', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[{ id: 1 }], null]) // schedule
      .mockResolvedValueOnce([[{ id: 3 }], null]) // department
      .mockResolvedValueOnce([{ insertId: 11 }, null]) // shift insert
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // skill link
    execute
      .mockResolvedValueOnce([[buildShiftRow({ id: 11 })], null])
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([[], null]);
    const service = new ShiftService(pool);
    const shift = await service.createShift({
      scheduleId: 1,
      departmentId: 3,
      date: '2026-05-01',
      startTime: '08:00',
      endTime: '16:00',
      minStaff: 1,
      maxStaff: 5,
      requiredSkillIds: [9],
    } as never);
    expect(shift.id).toBe(11);
    expect(conn.commit).toHaveBeenCalled();
  });
});

describe('ShiftService.getShiftById', () => {
  it('returns null when no row matches', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);
    const service = new ShiftService(pool);
    expect(await service.getShiftById(99)).toBeNull();
  });
});

describe('ShiftService.getAllShifts', () => {
  it('layers schedule, department, date and status filters', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildShiftRow()], null]);
    const service = new ShiftService(pool);
    await service.getAllShifts({
      scheduleId: 1,
      departmentId: 3,
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      status: 'open',
    });
    const sql = execute.mock.calls[0][0] as string;
    expect(sql).toMatch(/s\.schedule_id = \?/);
    expect(sql).toMatch(/s\.department_id = \?/);
    expect(sql).toMatch(/s\.date >= \?/);
    expect(sql).toMatch(/s\.date <= \?/);
    expect(sql).toMatch(/s\.status = \?/);
  });
});

describe('ShiftService.deleteShift', () => {
  it('throws when no row matched', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([{ affectedRows: 0 }, null]) // delete shift_skills
      .mockResolvedValueOnce([{ affectedRows: 0 }, null]); // delete shift
    const service = new ShiftService(pool);
    await expect(service.deleteShift(99)).rejects.toThrow();
  });
});

describe('ShiftService.getShiftStatistics', () => {
  it('returns aggregate counts for a schedule', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [
        {
          total: 10,
          assigned: 7,
          fully_staffed: 6,
          understaffed: 4,
          overstaffed: 0,
        },
      ],
      null,
    ]);
    const service = new ShiftService(pool);
    const stats = await service.getShiftStatistics(1);
    expect(stats.total).toBe(10);
    expect(stats.assigned).toBe(7);
    expect(stats.unassigned).toBe(3);
    expect(stats.fullyStaffed).toBe(6);
  });
});

describe('ShiftService.getAllShiftTemplates', () => {
  it('returns active templates', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [
        {
          id: 1,
          name: 'Morning',
          description: '',
          department_id: 3,
          start_time: '08:00',
          end_time: '16:00',
          min_staff: 2,
          max_staff: 5,
          is_active: 1,
          created_at: '2026-04-26',
          updated_at: '2026-04-26',
        },
      ],
      null,
    ]);
    const service = new ShiftService(pool);
    const templates = await service.getAllShiftTemplates();
    expect(templates).toHaveLength(1);
    expect(templates[0].isActive).toBe(true);
  });
});
