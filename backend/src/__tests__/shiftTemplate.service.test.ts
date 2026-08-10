/**
 * ShiftTemplateService unit tests.
 */

import { ShiftTemplateService } from '../services/ShiftTemplateService';

type Tuple = [unknown, unknown];

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
  return {
    pool: { execute, getConnection: jest.fn().mockResolvedValue(conn) } as never,
    execute,
    conn,
  };
};

describe('ShiftTemplateService.getAllShiftTemplates', () => {
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
    const service = new ShiftTemplateService(pool);
    const templates = await service.getAllShiftTemplates();
    expect(templates).toHaveLength(1);
    expect(templates[0].isActive).toBe(true);
  });
});

describe('ShiftTemplateService templates', () => {
  it('getAllShiftTemplates errors bubble', async () => {
    const { pool, execute } = makePool();
    execute.mockRejectedValueOnce(new Error('boom'));
    const svc = new ShiftTemplateService(pool);
    await expect(svc.getAllShiftTemplates()).rejects.toThrow(/boom/);
  });

  it('getShiftTemplateById null + mapping + error', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[], null] as Tuple)
      .mockResolvedValueOnce([[templateRow], null] as Tuple)
      .mockRejectedValueOnce(new Error('boom'));
    const svc = new ShiftTemplateService(pool);
    expect(await svc.getShiftTemplateById(99)).toBeNull();
    expect((await svc.getShiftTemplateById(1))?.name).toBe('Morning');
    await expect(svc.getShiftTemplateById(1)).rejects.toThrow(/boom/);
  });

  it('createShiftTemplate inserts and returns', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute.mockResolvedValueOnce([{ insertId: 5 }, null]);
    execute.mockResolvedValueOnce([[{ ...templateRow, id: 5 }], null] as Tuple);
    const svc = new ShiftTemplateService(pool);
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
    const svc = new ShiftTemplateService(pool);
    await expect(svc.createShiftTemplate({ name: 'X', departmentId: 1, startTime: '08:00', endTime: '16:00', minStaff: 1, maxStaff: 4 })).rejects.toThrow(/boom/);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('updateShiftTemplate persists each provided field', async () => {
    const { pool, conn, execute } = makePool();
    conn.execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    execute.mockResolvedValueOnce([[templateRow], null] as Tuple);
    const svc = new ShiftTemplateService(pool);
    const r = await svc.updateShiftTemplate(1, {
      name: 'New',
      description: 'd',
      startTime: '07',
      endTime: '15',
      minStaff: 1,
      maxStaff: 5,
    });
    expect(r!.name).toBe('Morning');
  });

  it('updateShiftTemplate skips UPDATE when no fields', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[templateRow], null] as Tuple);
    const svc = new ShiftTemplateService(pool);
    const r = await svc.updateShiftTemplate(1, {});
    expect(r!.id).toBe(1);
  });

  it('updateShiftTemplate rolls back on error', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockRejectedValueOnce(new Error('boom'));
    const svc = new ShiftTemplateService(pool);
    await expect(svc.updateShiftTemplate(1, { name: 'X' })).rejects.toThrow(/boom/);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('deleteShiftTemplate marks inactive rather than removing the row', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    const svc = new ShiftTemplateService(pool);
    expect(await svc.deleteShiftTemplate(1)).toBe(true);
    // Soft on purpose: shifts already created from a template are ordinary
    // shifts with their own rows, and retiring the pattern must not reach back
    // into schedules that have already run.
    expect(String(conn.execute.mock.calls[0][0])).toContain('is_active = 0');
  });

  it('deleteShiftTemplate reports a miss so the route can 404', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([{ affectedRows: 0 }, null]);
    const svc = new ShiftTemplateService(pool);
    // It returned `true` unconditionally, so deleting a template that does not
    // exist reported "deleted successfully" and the route's 404 branch could
    // never be taken.
    expect(await svc.deleteShiftTemplate(99)).toBe(false);
  });

  it('deleteShiftTemplate rolls back on error', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockRejectedValueOnce(new Error('boom'));
    const svc = new ShiftTemplateService(pool);
    await expect(svc.deleteShiftTemplate(1)).rejects.toThrow(/boom/);
    expect(conn.rollback).toHaveBeenCalled();
  });
});
