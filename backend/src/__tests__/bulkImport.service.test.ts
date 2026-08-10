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
  it('reports an empty CSV', () => {
    const out = mapEmployeeRows([]);
    expect(out.errors[0].message).toBe('CSV is empty');
  });

  it('reports missing required columns', () => {
    const out = mapEmployeeRows([['email', 'firstName']]);
    expect(out.errors[0].message).toMatch(/Missing required columns/);
  });

  it('rejects rows with an empty role and continues with the rest', () => {
    const csv = parseCsv(
      'email,firstName,lastName,role\n' +
        'a@x.com,A,A,Manager\n' +
        'b@x.com,B,B,\n' +
        'c@x.com,C,C,Employee\n'
    );
    const out = mapEmployeeRows(csv);
    expect(out.rows.map((r) => r.email)).toEqual(['a@x.com', 'c@x.com']);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0].row).toBe(3);
  });

  it('rejects a blank email cell as invalid rather than crashing', () => {
    const out = mapEmployeeRows([
      ['email', 'firstName', 'lastName', 'role'],
      ['', 'A', 'A', 'Manager'],
    ]);
    expect(out.errors[0].message).toMatch(/Invalid email/);
  });

  it('rejects rows with malformed emails', () => {
    const csv = parseCsv('email,firstName,lastName,role\nnot-an-email,X,Y,employee\n');
    const out = mapEmployeeRows(csv);
    expect(out.errors[0].message).toMatch(/Invalid email/);
  });

  it('leaves optional fields undefined when their columns are absent', () => {
    const csv = parseCsv('email,firstName,lastName,role\na@x.com,A,A,Manager\n');
    const [row] = mapEmployeeRows(csv).rows;
    expect(row.employeeId).toBeUndefined();
    expect(row.phone).toBeUndefined();
    expect(row.position).toBeUndefined();
    expect(row.hourlyRate).toBeUndefined();
  });

  it('reads employeeId, phone, position and hourlyRate when their columns are present', () => {
    const csv = parseCsv(
      'email,firstName,lastName,role,employeeId,phone,position,hourlyRate\n' +
        'a@x.com,A,Ann,Manager,EMP1,555-1234,Lead,25.5\n'
    );
    const [row] = mapEmployeeRows(csv).rows;
    expect(row.employeeId).toBe('EMP1');
    expect(row.phone).toBe('555-1234');
    expect(row.position).toBe('Lead');
    expect(row.hourlyRate).toBe(25.5);
  });

  it('treats blank optional cells as undefined even when the column is present', () => {
    const csv = parseCsv(
      'email,firstName,lastName,role,employeeId,phone,position,hourlyRate\n' + 'a@x.com,A,Ann,Manager,,,,\n'
    );
    const [row] = mapEmployeeRows(csv).rows;
    expect(row.employeeId).toBeUndefined();
    expect(row.phone).toBeUndefined();
    expect(row.position).toBeUndefined();
    expect(row.hourlyRate).toBeUndefined();
  });

  it('drops a non-numeric hourlyRate to undefined instead of NaN', () => {
    const csv = parseCsv('email,firstName,lastName,role,hourlyRate\na@x.com,A,Ann,Manager,not-a-number\n');
    const [row] = mapEmployeeRows(csv).rows;
    expect(row.hourlyRate).toBeUndefined();
  });

  it('falls back to empty strings when firstName/lastName cells are blank', () => {
    const csv = parseCsv('email,firstName,lastName,role\na@x.com,,,Manager\n');
    const [row] = mapEmployeeRows(csv).rows;
    expect(row.firstName).toBe('');
    expect(row.lastName).toBe('');
  });
});

describe('mapShiftRows', () => {
  it('reports an empty CSV', () => {
    const out = mapShiftRows([]);
    expect(out.errors[0].message).toBe('CSV is empty');
  });

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

  it('treats a row shorter than the header as blank date/startTime/endTime cells', () => {
    const out = mapShiftRows([
      ['scheduleId', 'departmentId', 'date', 'startTime', 'endTime', 'minStaff', 'maxStaff'],
      ['1', '2'], // date/startTime/endTime/minStaff/maxStaff cells missing entirely
    ]);
    expect(out.rows).toHaveLength(0);
    // minStaff/maxStaff parse to NaN first, so this hits the numeric-column error,
    // not the date one — mapShiftRows checks numbers before dates/times.
    expect(out.errors[0].message).toMatch(/Numeric column failed to parse/);
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

  it('rolls back when the role name does not exist', async () => {
    const csv = 'email,firstName,lastName,role\nnew@x.com,A,A,NoSuchRole\n';
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([[], null]) // email check: no duplicate
      .mockResolvedValueOnce([[], null]); // role lookup: not found

    const service = new BulkImportService(pool);
    const out = await service.importEmployees(csv, 'pw');
    expect(out.inserted).toBe(0);
    expect(out.errors[0].message).toMatch(/Unknown role/);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('inserts every valid row in one transaction', async () => {
    const csv =
      'email,firstName,lastName,role\n' +
      'a@x.com,A,A,Employee\n' +
      'b@x.com,B,B,Manager\n';
    const { pool, conn } = makePool();
    conn.execute
      .mockResolvedValueOnce([[], null])                         // email check row 1
      .mockResolvedValueOnce([[{ id: 3 }], null])               // role lookup row 1
      .mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }, null]) // INSERT user row 1
      .mockResolvedValueOnce([{ affectedRows: 1 }, null])       // INSERT IGNORE user_roles row 1
      .mockResolvedValueOnce([[], null])                         // email check row 2
      .mockResolvedValueOnce([[{ id: 2 }], null])               // role lookup row 2
      .mockResolvedValueOnce([{ insertId: 2, affectedRows: 1 }, null]) // INSERT user row 2
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);      // INSERT IGNORE user_roles row 2

    const service = new BulkImportService(pool);
    const out = await service.importEmployees(csv, 'pw');
    expect(out.inserted).toBe(2);
    expect(out.errors).toHaveLength(0);
    expect(conn.commit).toHaveBeenCalled();
  });
});
