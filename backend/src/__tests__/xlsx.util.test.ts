/**
 * The XLSX serializer.
 *
 * Each case round-trips a produced buffer through `exceljs`'s own reader
 * rather than inspecting the raw bytes: what matters is what a spreadsheet
 * application would actually see when it opens the file, and `exceljs` is the
 * same library on both sides of that question.
 *
 * @author Luca Ostinelli
 */

import ExcelJS from 'exceljs';
import { toXlsxBuffer } from '../utils/xlsx';

export {};

interface Row {
  name: string;
  hours: number | null;
  hired: Date | null;
}

const columns = [
  { header: 'Name', value: (r: Row) => r.name },
  { header: 'Hours', value: (r: Row) => r.hours },
  { header: 'Hired', value: (r: Row) => r.hired },
];

const readBack = async (buffer: Buffer) => {
  const workbook = new ExcelJS.Workbook();
  // `exceljs`'s declared `Buffer` type resolves against a different
  // `@types/node` copy than this package's, so the two `Buffer` types are
  // structurally incompatible to the compiler though identical at runtime.
  await workbook.xlsx.load(buffer as never);
  return workbook;
};

describe('toXlsxBuffer', () => {
  it('produces a workbook whose header row matches the declared columns, in order', async () => {
    const buffer = await toXlsxBuffer([{ name: 'Rossi', hours: 8, hired: null }], columns);
    const workbook = await readBack(buffer);
    const sheet = workbook.worksheets[0];

    expect(sheet.getRow(1).getCell(1).value).toBe('Name');
    expect(sheet.getRow(1).getCell(2).value).toBe('Hours');
    expect(sheet.getRow(1).getCell(3).value).toBe('Hired');
    expect(sheet.getRow(1).font?.bold).toBe(true);
  });

  it('writes the declared row values back out', async () => {
    const buffer = await toXlsxBuffer([{ name: 'Rossi', hours: 8, hired: null }], columns);
    const workbook = await readBack(buffer);
    const sheet = workbook.worksheets[0];

    expect(sheet.getRow(2).getCell(1).value).toBe('Rossi');
    expect(sheet.getRow(2).getCell(2).value).toBe(8);
  });

  it('publishes exactly the declared columns, not a field the row happens to carry', async () => {
    const buffer = await toXlsxBuffer(
      [{ name: 'Rossi', hours: 8, hired: null, salary: 99_000 } as unknown as Row],
      columns
    );
    const workbook = await readBack(buffer);
    const sheet = workbook.worksheets[0];
    expect(sheet.getRow(1).cellCount).toBe(3);
    const values = sheet.getRow(2).values as unknown[];
    expect(values).not.toContain(99_000);
  });

  it('keeps a number as a genuine number cell, not text', async () => {
    const buffer = await toXlsxBuffer([{ name: 'a', hours: 40, hired: null }], columns);
    const workbook = await readBack(buffer);
    const cell = workbook.worksheets[0].getRow(2).getCell(2);
    expect(typeof cell.value).toBe('number');
  });

  it('keeps a Date as a genuine date cell, not a formatted string', async () => {
    const hired = new Date(2026, 0, 15);
    const buffer = await toXlsxBuffer([{ name: 'a', hours: 1, hired }], columns);
    const workbook = await readBack(buffer);
    const cell = workbook.worksheets[0].getRow(2).getCell(3);
    expect(cell.value).toBeInstanceOf(Date);
    expect((cell.value as Date).getFullYear()).toBe(2026);
  });

  it('JSON-encodes an object value, as the CSV writer does', async () => {
    const objColumns = [{ header: 'Snapshot', value: (r: { snapshot: unknown }) => r.snapshot }];
    const buffer = await toXlsxBuffer([{ snapshot: { a: 1 } }], objColumns);
    const workbook = await readBack(buffer);
    expect(workbook.worksheets[0].getRow(2).getCell(1).value).toBe('{"a":1}');
  });

  it('writes an empty cell for null, keeping the columns aligned', async () => {
    const buffer = await toXlsxBuffer([{ name: 'a', hours: null, hired: null }], columns);
    const workbook = await readBack(buffer);
    const cell = workbook.worksheets[0].getRow(2).getCell(2);
    expect(cell.value == null).toBe(true);
  });

  it('emits the header row even with no data', async () => {
    const buffer = await toXlsxBuffer([], columns);
    const workbook = await readBack(buffer);
    const sheet = workbook.worksheets[0];
    expect(sheet.getRow(1).getCell(1).value).toBe('Name');
    expect(sheet.rowCount).toBe(1);
  });

  describe('formula injection', () => {
    // Same guard, same reason as the CSV writer's — and it matters MORE here,
    // since a `.xlsx` file is evaluated the moment it opens, with no import
    // step in between.
    // A bare CR is not asserted byte-for-byte through the round trip: XLSX
    // cell text is XML, and the XML spec normalizes a bare CR to LF on parse
    // — a property of the file format, not of this guard. The tab prefix
    // (what makes the guard work) and the original payload both survive.
    it.each(['=', '+', '-', '@', '\t', '\r'])('defuses a string cell starting with %j', async (prefix) => {
      const buffer = await toXlsxBuffer([{ name: `${prefix}HYPERLINK(1)`, hours: 1, hired: null }], columns);
      const workbook = await readBack(buffer);
      const value = String(workbook.worksheets[0].getRow(2).getCell(1).value);
      expect(value.startsWith('\t')).toBe(true);
      expect(value).toContain('HYPERLINK(1)');
    });

    it('does not touch a value that merely contains one of the characters', async () => {
      const buffer = await toXlsxBuffer([{ name: 'a=b', hours: 1, hired: null }], columns);
      const workbook = await readBack(buffer);
      expect(workbook.worksheets[0].getRow(2).getCell(1).value).toBe('a=b');
    });

    it('never defuses a genuine number cell, even a negative one', async () => {
      // Unlike CSV, a number cell is stored with a number type and is never
      // evaluated as a formula, so defusing -5 here would misrepresent the data.
      const buffer = await toXlsxBuffer([{ name: 'a', hours: -5, hired: null }], columns);
      const workbook = await readBack(buffer);
      expect(workbook.worksheets[0].getRow(2).getCell(2).value).toBe(-5);
    });
  });

  describe('sheet naming', () => {
    it('uses the given sheet name', async () => {
      const buffer = await toXlsxBuffer([], columns, 'Employees');
      const workbook = await readBack(buffer);
      expect(workbook.worksheets[0].name).toBe('Employees');
    });

    it('defaults to "Export" when none is given', async () => {
      const buffer = await toXlsxBuffer([], columns);
      const workbook = await readBack(buffer);
      expect(workbook.worksheets[0].name).toBe('Export');
    });

    it('strips characters Excel forbids in a sheet name', async () => {
      const buffer = await toXlsxBuffer([], columns, 'a/b:c*d?e[f]g\\h');
      const workbook = await readBack(buffer);
      expect(workbook.worksheets[0].name).not.toMatch(/[\\/?*[\]:]/);
    });

    it('truncates to Excel\'s 31-character limit', async () => {
      const buffer = await toXlsxBuffer([], columns, 'a'.repeat(50));
      const workbook = await readBack(buffer);
      expect(workbook.worksheets[0].name.length).toBeLessThanOrEqual(31);
    });

    it('falls back rather than producing a nameless sheet', async () => {
      const buffer = await toXlsxBuffer([], columns, '***');
      const workbook = await readBack(buffer);
      expect(workbook.worksheets[0].name).toBe('Export');
    });
  });
});
