/**
 * The column catalogue — what each export actually publishes.
 *
 * The date cases are here because the driver decides the type: a MySQL DATE
 * arrives as a `YYYY-MM-DD` string, but a DATETIME may arrive as a `Date`, and
 * the same column definition has to produce a calendar date either way. The
 * `Date` branch is the one with the trap, and the one nothing in a normal run
 * exercises.
 *
 * @author Luca Ostinelli
 */

import {
  assignmentColumns,
  employeeColumns,
  shiftColumns,
  timeOffColumns,
} from '../services/exportColumns';
import { toCsv } from '../utils/csv';

export {};

const cell = <T>(columns: readonly { header: string; value: (r: T) => unknown }[], header: string, row: T) =>
  columns.find((c) => c.header === header)!.value(row);

describe('date columns', () => {
  it('slices a MySQL date string', () => {
    expect(cell(shiftColumns, 'Date', { date: '2026-07-30' } as never)).toBe('2026-07-30');
  });

  it('slices the date out of a datetime string', () => {
    expect(cell(shiftColumns, 'Date', { date: '2026-07-30T22:00:00.000Z' } as never)).toBe('2026-07-30');
  });

  it('reads a Date by its LOCAL calendar day', () => {
    // A `Date` at 00:30 in a positive-offset zone is still the previous day in
    // UTC, so `toISOString().slice(0, 10)` would export the wrong date — the
    // same trap the frontend has on the other side of the wire.
    const justAfterMidnight = new Date(2026, 6, 30, 0, 30);
    expect(cell(shiftColumns, 'Date', { date: justAfterMidnight } as never)).toBe('2026-07-30');
  });

  it('leaves a missing date empty rather than writing "null"', () => {
    expect(cell(shiftColumns, 'Date', { date: null } as never)).toBe('');
    expect(cell(assignmentColumns, 'Date', {} as never)).toBe('');
  });

  it('shortens times to HH:MM', () => {
    expect(cell(shiftColumns, 'Start', { startTime: '08:00:00' } as never)).toBe('08:00');
    expect(cell(shiftColumns, 'End', {} as never)).toBe('');
  });
});

describe('fallbacks', () => {
  it('falls back to the id when a joined name is absent', () => {
    // A department column reading "undefined" is worse than one reading "12":
    // the id is at least resolvable.
    expect(cell(shiftColumns, 'Department', { departmentId: 12 } as never)).toBe(12);
    expect(cell(shiftColumns, 'Department', { departmentId: 12, departmentName: 'Ward A' } as never)).toBe('Ward A');
    expect(cell(assignmentColumns, 'Employee', { userId: 3 } as never)).toBe(3);
  });

  it('writes yes/no where the value is a flag a person reads', () => {
    expect(cell(employeeColumns, 'Active', { isActive: false } as never)).toBe('no');
    expect(cell(timeOffColumns, 'Recorded As Unavailable', { unavailabilityId: 5 } as never)).toBe('yes');
    expect(cell(timeOffColumns, 'Recorded As Unavailable', { unavailabilityId: null } as never)).toBe('no');
  });
});

describe('what is NOT published', () => {
  it('omits every employee field that is not a declared column', () => {
    // The point of declaring columns: a field added to the entity — an internal
    // note, a rate, a hash — is not exported until someone chooses to export it.
    const csv = toCsv(
      [
        {
          id: 1,
          firstName: 'Anna',
          lastName: 'Rossi',
          email: 'a@x.y',
          isActive: true,
          hourlyRate: 42,
          passwordHash: 'secret-digest',
        },
      ] as never,
      employeeColumns
    );
    expect(csv).not.toContain('secret-digest');
    expect(csv).not.toContain('42');
  });
});
