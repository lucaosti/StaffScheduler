/**
 * Extended UserDirectoryService tests — covers:
 *   - `removeField`: returns true on deletion, false when key not found.
 *   - `importVcf` with X-prefixed custom fields: they are stored as user_custom_fields rows.
 *   - `importVcf` DB error: skips the card and surfaces the error reason.
 */

import { UserDirectoryService } from '../services/UserDirectoryService';

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

describe('UserDirectoryService.removeField', () => {
  it('returns true when a matching row is deleted', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]);

    const service = new UserDirectoryService(pool);
    expect(await service.removeField(7, 'birthday')).toBe(true);
    expect(execute.mock.calls[0][0]).toMatch(/DELETE FROM user_custom_fields/);
  });

  it('returns false when no matching row exists', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ affectedRows: 0 }, null]);

    const service = new UserDirectoryService(pool);
    expect(await service.removeField(7, 'nonexistent')).toBe(false);
  });
});

describe('UserDirectoryService.importVcf — custom X- fields are persisted', () => {
  it('stores X- properties (except X-EMPLOYEE-ID and X-ROLE) as custom fields', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[], null]);
    conn.execute.mockResolvedValueOnce([{ insertId: 5 }, null]);
    conn.execute.mockResolvedValueOnce([{ affectedRows: 1 }, null]);

    const vcf =
      'BEGIN:VCARD\r\n' +
      'VERSION:4.0\r\n' +
      'FN:Test User\r\n' +
      'EMAIL:test@example.com\r\n' +
      'X-DEPARTMENT:Engineering\r\n' +
      'END:VCARD\r\n';

    const service = new UserDirectoryService(pool);
    const out = await service.importVcf(vcf, { defaultPasswordHash: 'hash', createdBy: 1 });

    expect(out.inserted).toBe(1);
    expect(out.skipped).toEqual([]);
    expect(conn.execute).toHaveBeenCalledTimes(3);
    const cfCall = conn.execute.mock.calls[2];
    expect(cfCall[0]).toMatch(/INSERT INTO user_custom_fields/);
    expect(cfCall[1]).toContain('department');
    expect(cfCall[1]).toContain('Engineering');
  });

  it('skips X-EMPLOYEE-ID and X-ROLE when storing custom fields', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[], null]);
    conn.execute.mockResolvedValueOnce([{ insertId: 6 }, null]);

    const vcf =
      'BEGIN:VCARD\r\n' +
      'VERSION:4.0\r\n' +
      'FN:Alice Admin\r\n' +
      'EMAIL:alice@example.com\r\n' +
      'X-EMPLOYEE-ID:E-999\r\n' +
      'X-ROLE:admin\r\n' +
      'END:VCARD\r\n';

    const service = new UserDirectoryService(pool);
    const out = await service.importVcf(vcf, { defaultPasswordHash: 'hash', createdBy: 1 });

    expect(out.inserted).toBe(1);
    expect(conn.execute).toHaveBeenCalledTimes(2);
  });
});

describe('UserDirectoryService.importVcf — DB error handling', () => {
  it('skips the card and records the error reason when the DB throws', async () => {
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[], null]);
    conn.execute.mockRejectedValueOnce(new Error('deadlock detected'));

    const vcf =
      'BEGIN:VCARD\r\n' +
      'VERSION:4.0\r\n' +
      'FN:Broken User\r\n' +
      'EMAIL:broken@example.com\r\n' +
      'END:VCARD\r\n';

    const service = new UserDirectoryService(pool);
    const out = await service.importVcf(vcf, { defaultPasswordHash: 'hash', createdBy: 1 });

    expect(out.inserted).toBe(0);
    expect(out.skipped).toHaveLength(1);
    expect(out.skipped[0]).toMatchObject({
      email: 'broken@example.com',
      reason: 'deadlock detected',
    });
    expect(conn.rollback).toHaveBeenCalled();
  });
});

