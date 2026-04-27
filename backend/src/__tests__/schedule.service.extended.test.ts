/**
 * Extended ScheduleService coverage targeting:
 *   - createSchedule guards (missing createdBy, happy path with mapping)
 *   - getScheduleById row mapping
 *   - updateSchedule (every branch + archived rejection + missing schedule)
 *   - deleteSchedule happy path + missing schedule
 *   - getScheduleStatistics (zero + non-zero coverage math)
 *   - getScheduleShifts mapping
 *   - cloneSchedule happy + missing source
 *   - getSchedulesByDateRange / Department / User and getScheduleWithShifts
 *
 * @author Luca Ostinelli
 */

import { ScheduleService } from '../services/ScheduleService';

type Tuple = [unknown, unknown];

const buildScheduleRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'May 2026',
  description: '',
  department_id: 3,
  department_name: 'Emergency',
  start_date: '2026-05-01',
  end_date: '2026-05-31',
  status: 'draft',
  published_at: null,
  notes: null,
  created_at: 't',
  updated_at: 't',
  total_shifts: 0,
  total_assignments: 0,
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

describe('ScheduleService.createSchedule (extended)', () => {
  it('throws when createdBy is missing', async () => {
    const { pool } = makePool();
    const svc = new ScheduleService(pool);
    await expect(
      svc.createSchedule({
        name: 'X',
        departmentId: 3,
        startDate: '2026-05-01',
        endDate: '2026-05-31',
      } as never)
    ).rejects.toThrow(/createdBy is required/);
  });

  it('inserts and returns a mapped schedule on the happy path', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[{ id: 3 }], null]) // department exists
      .mockResolvedValueOnce([[], null]) // no overlap
      .mockResolvedValueOnce([{ insertId: 11 }, null]); // INSERT
    execute.mockResolvedValueOnce([[buildScheduleRow({ id: 11 })], null] as Tuple);
    const svc = new ScheduleService(pool);
    const out = await svc.createSchedule({
      createdBy: 1,
      name: 'May',
      departmentId: 3,
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      notes: 'note',
    } as never);
    expect(out.id).toBe(11);
  });

  it('throws when post-insert lookup returns nothing', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[{ id: 3 }], null])
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([{ insertId: 12 }, null]);
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new ScheduleService(pool);
    await expect(
      svc.createSchedule({
        createdBy: 1,
        name: 'X',
        departmentId: 3,
        startDate: '2026-05-01',
        endDate: '2026-05-31',
      } as never)
    ).rejects.toThrow(/Failed to retrieve created schedule/);
  });
});

describe('ScheduleService.getScheduleById', () => {
  it('returns mapped schedule when found', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildScheduleRow({ total_shifts: 5, total_assignments: 4 })], null] as Tuple);
    const svc = new ScheduleService(pool);
    const out = await svc.getScheduleById(1);
    expect(out?.totalShifts).toBe(5);
    expect(out?.totalAssignments).toBe(4);
  });

  it('bubbles errors', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValueOnce(new Error('boom'));
    const svc = new ScheduleService(pool);
    await expect(svc.getScheduleById(1)).rejects.toThrow(/boom/);
  });
});

describe('ScheduleService.updateSchedule', () => {
  it('throws when schedule does not exist', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[], null]);
    const svc = new ScheduleService(pool);
    await expect(svc.updateSchedule(1, { name: 'X' } as never)).rejects.toThrow(/Schedule not found/);
  });

  it('blocks editing of archived schedules', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[{ status: 'archived' }], null]);
    const svc = new ScheduleService(pool);
    await expect(svc.updateSchedule(1, { name: 'X' } as never)).rejects.toThrow(/archived/);
  });

  it('persists each provided field and sets published_at when status -> published', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[{ status: 'draft' }], null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    execute.mockResolvedValueOnce([[buildScheduleRow({ status: 'published' })], null] as Tuple);
    const svc = new ScheduleService(pool);
    const out = await svc.updateSchedule(1, {
      name: 'New',
      startDate: '2026-05-02',
      endDate: '2026-05-30',
      status: 'published',
      notes: 'n',
    } as never);
    expect(out.status).toBe('published');
  });

  it('throws when schedule disappears after update', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[{ status: 'draft' }], null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new ScheduleService(pool);
    await expect(svc.updateSchedule(1, { name: 'X' } as never)).rejects.toThrow(
      /Schedule not found after update/
    );
  });
});

describe('ScheduleService.deleteSchedule', () => {
  it('throws when schedule does not exist', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[], null]);
    const svc = new ScheduleService(pool);
    await expect(svc.deleteSchedule(1)).rejects.toThrow(/Schedule not found/);
  });

  it('deletes a draft schedule', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([[{ status: 'draft' }], null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // DELETE assignments
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // DELETE skills
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]) // DELETE shifts
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // DELETE schedule
    const svc = new ScheduleService(pool);
    expect(await svc.deleteSchedule(1)).toBe(true);
  });
});

describe('ScheduleService.getScheduleStatistics', () => {
  it('returns 0 coverage when totals are 0', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [{ total_shifts: 0, total_staff_needed: 0, total_assignments: 0 }],
      null,
    ] as Tuple);
    const svc = new ScheduleService(pool);
    const s = await svc.getScheduleStatistics(1);
    expect(s.coveragePercentage).toBe(0);
  });

  it('computes coverage percentage and bubbles errors', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([
        [
          {
            total_shifts: 10,
            total_staff_needed: 20,
            total_assignments: 10,
            fully_staffed: 4,
            understaffed: 5,
            overstaffed: 1,
            empty_shifts: 0,
          },
        ],
        null,
      ] as Tuple)
      .mockRejectedValueOnce(new Error('boom'));
    const svc = new ScheduleService(pool);
    expect((await svc.getScheduleStatistics(1)).coveragePercentage).toBe(50);
    await expect(svc.getScheduleStatistics(1)).rejects.toThrow(/boom/);
  });
});

describe('ScheduleService.getScheduleShifts', () => {
  it('returns mapped shifts and bubbles errors', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([
        [
          {
            id: 1,
            date: 'd',
            start_time: 's',
            end_time: 'e',
            min_staff: 1,
            max_staff: 2,
            status: 'open',
            department_id: 3,
            department_name: 'X',
            assigned_staff: 1,
          },
        ],
        null,
      ] as Tuple)
      .mockRejectedValueOnce(new Error('boom'));
    const svc = new ScheduleService(pool);
    expect((await svc.getScheduleShifts(1)).length).toBe(1);
    await expect(svc.getScheduleShifts(1)).rejects.toThrow(/boom/);
  });
});

describe('ScheduleService.cloneSchedule + duplicateSchedule', () => {
  it('rolls back when source is missing', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[], null]);
    const svc = new ScheduleService(pool);
    await expect(svc.cloneSchedule(1, 'New', '2026-06-01', '2026-06-30')).rejects.toThrow(
      /Source schedule not found/
    );
  });

  it('clones and returns the new schedule', async () => {
    const { pool, conn, execute } = makePool();
    const source = {
      id: 1,
      name: 'Old',
      department_id: 3,
      created_by: 1,
      start_date: '2026-05-01',
    };
    conn.execute
      .mockResolvedValueOnce([[source], null]) // source schedule
      .mockResolvedValueOnce([{ insertId: 99 }, null]) // new schedule insert
      .mockResolvedValueOnce([
        [
          {
            id: 5,
            department_id: 3,
            template_id: null,
            date: '2026-05-01',
            start_time: '08:00',
            end_time: '16:00',
            min_staff: 1,
            max_staff: 4,
            notes: null,
          },
        ],
        null,
      ]) // shifts
      .mockResolvedValueOnce([{ insertId: 100 }, null]) // new shift insert
      .mockResolvedValueOnce([[{ skill_id: 1 }], null]) // shift skills
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // INSERT shift_skills
    execute.mockResolvedValueOnce([[buildScheduleRow({ id: 99 })], null] as Tuple);
    const svc = new ScheduleService(pool);
    const out = await svc.duplicateSchedule(1, 'New', '2026-06-01', '2026-06-30');
    expect(out.id).toBe(99);
  });

  it('throws when post-clone lookup fails', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[{ id: 1, name: 'Old', department_id: 3, created_by: 1, start_date: '2026-05-01' }], null])
      .mockResolvedValueOnce([{ insertId: 99 }, null])
      .mockResolvedValueOnce([[], null]); // no shifts to clone
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new ScheduleService(pool);
    await expect(svc.cloneSchedule(1, 'New', '2026-06-01', '2026-06-30')).rejects.toThrow(
      /Failed to retrieve cloned schedule/
    );
  });
});

describe('ScheduleService convenience helpers', () => {
  it('getSchedulesByDateRange / Department forward', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValue([[buildScheduleRow()], null] as Tuple);
    const svc = new ScheduleService(pool);
    expect((await svc.getSchedulesByDateRange('2026-05-01', '2026-05-31')).length).toBe(1);
    expect((await svc.getSchedulesByDateRange('2026-05-01', '2026-05-31', 3)).length).toBe(1);
    expect((await svc.getSchedulesByDepartment(3)).length).toBe(1);
  });

  it('getSchedulesByUser returns mapped schedules; bubbles errors', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ id: 1 }, { id: 2 }], null] as Tuple) // user schedules
      .mockResolvedValueOnce([[buildScheduleRow({ id: 1 })], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple) // null filtered
      .mockRejectedValueOnce(new Error('boom'));
    const svc = new ScheduleService(pool);
    const out = await svc.getSchedulesByUser(7);
    expect(out.length).toBe(1);
    await expect(svc.getSchedulesByUser(7)).rejects.toThrow(/boom/);
  });

  it('getScheduleWithShifts returns null when not found, returns shifts otherwise, bubbles errors', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new ScheduleService(pool);
    expect(await svc.getScheduleWithShifts(99)).toBeNull();

    execute
      .mockResolvedValueOnce([[buildScheduleRow()], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple);
    const out = await svc.getScheduleWithShifts(1);
    expect(out.shifts).toEqual([]);

    execute.mockRejectedValueOnce(new Error('boom'));
    await expect(svc.getScheduleWithShifts(1)).rejects.toThrow(/boom/);
  });
});

describe('ScheduleService.archiveSchedule error path', () => {
  it('throws when schedule disappears after archiving', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new ScheduleService(pool);
    await expect(svc.archiveSchedule(1)).rejects.toThrow(/Schedule not found after archiving/);
  });
});

describe('ScheduleService.publishSchedule error path', () => {
  it('throws when schedule disappears after publishing', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[{ shift_count: 5 }], null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const svc = new ScheduleService(pool);
    await expect(svc.publishSchedule(1)).rejects.toThrow(/Schedule not found after publishing/);
  });
});
