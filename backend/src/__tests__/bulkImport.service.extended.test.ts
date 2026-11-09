/**
 * Extended BulkImportService tests — covers:
 *   - `importEmployees`: DB error triggers rollback and re-throws.
 *   - `importShifts`: parse errors returned without DB access, successful
 *     insert, and DB error triggers rollback and re-throws.
 */

import { BulkImportService } from '../services/BulkImportService';
import { ADMIN_ACTOR } from './helpers/permissions';
import { NotFoundError } from '../errors';

/** An unscoped importer: the scope check passes without a query. */
const UNSCOPED = { id: 1, permissions: ['shift.manage'], allowedOrgUnitIds: null } as never;

const makePool = () => {
  const conn = {
    execute: jest.fn(),
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
  };
  const execute = jest.fn();
  const getConnection = jest.fn().mockResolvedValue(conn);
  return { pool: { execute, getConnection } as never, execute, conn };
};

describe('BulkImportService.importEmployees — DB error rollback', () => {
  it('rolls back and re-throws when the INSERT fails', async () => {
    const csv = 'email,firstName,lastName,role\na@x.com,A,A,employee\n';
    const { pool, conn } = makePool();
    // Duplicate-email check returns no row (new email).
    conn.execute.mockResolvedValueOnce([[], null]);
    // INSERT throws a DB error.
    const dbErr = new Error('DB constraint violation');
    conn.execute.mockRejectedValueOnce(dbErr);

    const service = new BulkImportService(pool);
    await expect(service.importEmployees(csv, 'pw', ADMIN_ACTOR)).rejects.toThrow('DB constraint violation');
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
  });
});

describe('BulkImportService.importShifts', () => {
  it('returns parse errors without touching the DB when the CSV is invalid', async () => {
    const { pool, conn } = makePool();
    const service = new BulkImportService(pool);
    const out = await service.importShifts('garbage', UNSCOPED);
    expect(out.inserted).toBe(0);
    expect(out.errors.length).toBeGreaterThan(0);
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });

  it('inserts every valid shift row in a single transaction', async () => {
    const csv =
      'scheduleId,departmentId,date,startTime,endTime,minStaff,maxStaff\n' +
      '1,2,2026-06-01,08:00,16:00,2,4\n' +
      '1,2,2026-06-02,08:00,16:00,2,4\n';
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([{ insertId: 10, affectedRows: 1 }, null])
      .mockResolvedValueOnce([{ insertId: 11, affectedRows: 1 }, null]);

    const service = new BulkImportService(pool);
    const out = await service.importShifts(csv, UNSCOPED);
    expect(out.inserted).toBe(2);
    expect(out.errors).toHaveLength(0);
    expect(conn.commit).toHaveBeenCalled();
    expect(conn.execute.mock.calls[0][0]).toMatch(/INSERT INTO shifts/);
  });

  it('rolls back and re-throws when an INSERT fails', async () => {
    const csv =
      'scheduleId,departmentId,date,startTime,endTime,minStaff,maxStaff\n' + '1,2,2026-06-01,08:00,16:00,2,4\n';
    const { pool, conn } = makePool();
    const dbErr = new Error('FK constraint');
    conn.execute.mockRejectedValueOnce(dbErr);

    const service = new BulkImportService(pool);
    await expect(service.importShifts(csv, UNSCOPED)).rejects.toThrow('FK constraint');
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
  });

  it('returns row-level errors without DB access when there are mapping errors', async () => {
    const csv =
      'scheduleId,departmentId,date,startTime,endTime,minStaff,maxStaff\n' + '1,2,not-a-date,08:00,16:00,2,4\n';
    const { pool, conn } = makePool();
    const service = new BulkImportService(pool);
    const out = await service.importShifts(csv, UNSCOPED);
    expect(out.inserted).toBe(0);
    expect(out.errors.length).toBeGreaterThan(0);
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });

  it('refuses the whole file, before writing anything, when a row names another unit', async () => {
    const csv =
      'scheduleId,departmentId,date,startTime,endTime,minStaff,maxStaff\n' + '1,2,2031-03-03,08:00,16:00,2,4\n';
    const { pool, execute, conn } = makePool();
    // The schedule resolves to org unit 9; the importer is scoped to unit 5.
    execute.mockResolvedValue([[{ id: 1, unit: 9, owner: null }], null]);
    const scoped = { id: 1, permissions: ['shift.manage'], allowedOrgUnitIds: [5] } as never;
    await expect(new BulkImportService(pool).importShifts(csv, scoped)).rejects.toThrow(NotFoundError);
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });
});

