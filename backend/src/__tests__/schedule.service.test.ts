/**
 * ScheduleService unit tests.
 */

import { ScheduleService } from '../services/ScheduleService';

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
  created_at: '2026-04-26',
  updated_at: '2026-04-26',
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

describe('ScheduleService.createSchedule', () => {
  it('rejects when end_date is before start_date', async () => {
    const { pool, conn } = makePool();
    // Service starts a transaction immediately, then validates createdBy + dates.
    const service = new ScheduleService(pool);
    await expect(
      service.createSchedule({
        createdBy: 1,
        name: 'X',
        departmentId: 3,
        startDate: '2026-05-31',
        endDate: '2026-05-01',
      } as never)
    ).rejects.toThrow(/End date must be after start date/);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('refuses an invalid department', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[], null]); // department lookup empty
    const service = new ScheduleService(pool);
    await expect(
      service.createSchedule({
        createdBy: 1,
        name: 'X',
        departmentId: 999,
        startDate: '2026-05-01',
        endDate: '2026-05-31',
      } as never)
    ).rejects.toThrow(/Department not found/);
  });

  it('rolls back when an overlapping schedule already exists', async () => {
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([[{ id: 3 }], null]) // department exists
      .mockResolvedValueOnce([[{ id: 5 }], null]); // overlapping row
    const service = new ScheduleService(pool);
    await expect(
      service.createSchedule({
        createdBy: 1,
        name: 'Overlap',
        departmentId: 3,
        startDate: '2026-05-01',
        endDate: '2026-05-31',
      } as never)
    ).rejects.toThrow(/already exists/);
  });
});

describe('ScheduleService.getScheduleById', () => {
  it('returns null when missing', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);
    const service = new ScheduleService(pool);
    expect(await service.getScheduleById(99)).toBeNull();
  });
});

describe('ScheduleService.publishSchedule', () => {
  it('rolls back when the schedule has no shifts', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[{ shift_count: 0 }], null]);
    const service = new ScheduleService(pool);
    await expect(service.publishSchedule(1)).rejects.toThrow(/no shifts/);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('marks status = published when at least one shift exists', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute
      .mockResolvedValueOnce([[{ shift_count: 5 }], null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    execute.mockResolvedValueOnce([[buildScheduleRow({ status: 'published' })], null]);
    const service = new ScheduleService(pool);
    const out = await service.publishSchedule(1);
    expect(out.status).toBe('published');
    expect(conn.commit).toHaveBeenCalled();
  });
});

describe('ScheduleService.archiveSchedule', () => {
  it('marks any non-archived schedule as archived', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    execute.mockResolvedValueOnce([[buildScheduleRow({ status: 'archived' })], null]);
    const service = new ScheduleService(pool);
    const out = await service.archiveSchedule(1);
    expect(out.status).toBe('archived');
  });
});

describe('ScheduleService.getAllSchedules', () => {
  it('layers filters', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildScheduleRow()], null]);
    const service = new ScheduleService(pool);
    await service.getAllSchedules({
      departmentId: 3,
      status: 'draft',
      startDate: '2026-05-01',
      endDate: '2026-05-31',
    });
    const [, params] = execute.mock.calls[0];
    expect(params).toEqual([3, 'draft', '2026-05-01', '2026-05-31']);
  });
});

describe('ScheduleService.deleteSchedule', () => {
  it('refuses to delete a published schedule', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[{ status: 'published' }], null]);
    const service = new ScheduleService(pool);
    await expect(service.deleteSchedule(1)).rejects.toThrow();
  });
});

describe('ScheduleService.generateOptimizedSchedule', () => {
  it('delegates to AutoScheduleService.generate and wraps the result', async () => {
    const { pool } = makePool();
    // The lazy require pattern in the service makes mocking via jest.mock
    // tricky; we use a property override to inject a fake AutoScheduleService.
    const fakeAuto = {
      generate: jest.fn().mockResolvedValue({
        scheduleId: 1,
        assignmentsCreated: 25,
        totalShifts: 30,
        coveragePercentage: 83,
        status: 'completed',
      }),
    };
    jest.doMock('../services/AutoScheduleService', () => ({
      AutoScheduleService: jest.fn().mockImplementation(() => fakeAuto),
    }));
    // Re-import to pick up the mock.
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ScheduleService: Reloaded } = require('../services/ScheduleService');
    const service = new Reloaded(pool);
    const out = await service.generateOptimizedSchedule(1, 99);
    expect(out.success).toBe(true);
    expect(out.assignmentsCreated).toBe(25);
  });
});
