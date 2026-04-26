/**
 * BulkImportService tests (F16).
 *
 * Heavy emphasis on the pure parser/mapper to lock the CSV contract down.
 */

import {
  BulkImportService,
  mapEmployeeRows,
  mapShiftRows,
  parseCsv,
} from '../services/BulkImportService';

describe('parseCsv', () => {
  it('parses a plain header + row', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('honours double-quoted cells with embedded commas', () => {
    expect(parseCsv('a,b\n"hello, world",2\n')).toEqual([
      ['a', 'b'],
      ['hello, world', '2'],
    ]);
  });

  it('handles escaped quotes ("") inside quoted cells', () => {
    expect(parseCsv('"a ""b"" c"\n')).toEqual([['a "b" c']]);
  });

  it('tolerates CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('mapEmployeeRows', () => {
  it('reports missing required columns', () => {
    const out = mapEmployeeRows([['email', 'firstName']]);
    expect(out.errors[0].message).toMatch(/Missing required columns/);
  });

  it('rejects an invalid role and continues with the rest', () => {
    const csv = parseCsv(
      'email,firstName,lastName,role\n' +
        'a@x.com,A,A,manager\n' +
        'b@x.com,B,B,king\n' +
        'c@x.com,C,C,employee\n'
    );
    const out = mapEmployeeRows(csv);
    expect(out.rows.map((r) => r.email)).toEqual(['a@x.com', 'c@x.com']);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0].row).toBe(3);
  });

  it('rejects rows with malformed emails', () => {
    const csv = parseCsv('email,firstName,lastName,role\nnot-an-email,X,Y,employee\n');
    const out = mapEmployeeRows(csv);
    expect(out.errors[0].message).toMatch(/Invalid email/);
  });
});

describe('mapShiftRows', () => {
  it('parses numbers, dates, and times; rejects malformed rows', () => {
    const csv = parseCsv(
      'scheduleId,departmentId,date,startTime,endTime,minStaff,maxStaff\n' +
        '1,2,2026-05-01,07:00,15:00,2,4\n' +
        '1,2,not-a-date,07:00,15:00,2,4\n' +
        '1,2,2026-05-02,07:00,xx:yy,2,4\n' +
        '1,two,2026-05-03,07:00,15:00,2,4\n'
    );
    const out = mapShiftRows(csv);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toEqual({
      scheduleId: 1,
      departmentId: 2,
      date: '2026-05-01',
      startTime: '07:00',
      endTime: '15:00',
      minStaff: 2,
      maxStaff: 4,
    });
    expect(out.errors).toHaveLength(3);
  });

  it('reports missing columns when the header is incomplete', () => {
    const out = mapShiftRows([['scheduleId', 'departmentId']]);
    expect(out.errors[0].message).toMatch(/Missing required columns/);
  });
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
  const getConnection = jest.fn().mockResolvedValue(conn);
  return { pool: { execute, getConnection } as never, execute, conn };
};

describe('BulkImportService.importEmployees', () => {
  it('returns parse errors without touching the DB', async () => {
    const { pool, conn } = makePool();
    const service = new BulkImportService(pool);
    const out = await service.importEmployees('garbage', 'pw');
    expect(out.inserted).toBe(0);
    expect(out.errors.length).toBeGreaterThan(0);
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });

  it('rolls back when a duplicate email is encountered', async () => {
    const csv = 'email,firstName,lastName,role\nused@x.com,A,A,employee\n';
    const { pool, conn } = makePool();
    conn.execute.mockResolvedValueOnce([[{ id: 1 }], null]);

    const service = new BulkImportService(pool);
    const out = await service.importEmployees(csv, 'pw');
    expect(out.inserted).toBe(0);
    expect(out.errors[0].message).toMatch(/already exists/);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('inserts every valid row in one transaction', async () => {
    const csv =
      'email,firstName,lastName,role\n' +
      'a@x.com,A,A,employee\n' +
      'b@x.com,B,B,manager\n';
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }, null])
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([{ insertId: 2, affectedRows: 1 }, null]);

    const service = new BulkImportService(pool);
    const out = await service.importEmployees(csv, 'pw');
    expect(out.inserted).toBe(2);
    expect(out.errors).toHaveLength(0);
    expect(conn.commit).toHaveBeenCalled();
  });
});
