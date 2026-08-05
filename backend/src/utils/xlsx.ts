/**
 * The XLSX counterpart to `utils/csv.ts`.
 *
 * WHY IT REUSES `CsvColumn`. `services/exportColumns.ts` declares one column
 * list per dataset — a header and a way to read the value from a row — and
 * that list is deliberately format-agnostic: it says what leaves the system,
 * not how the file that carries it is encoded. Declaring a second,
 * XLSX-flavoured column type would let the two formats publish different
 * fields for the same dataset without anyone deciding that on purpose.
 *
 * WHY IT REUSES THE CSV FORMULA-INJECTION GUARD. `csvField`'s defense against
 * `=HYPERLINK(...)` and `=cmd|...` matters MORE here, not less: a CSV needs an
 * import step before a formula would run, while a `.xlsx` file is evaluated
 * the moment it opens. `defuseFormula` (in `utils/csv.ts`) is the guard itself,
 * factored out so both writers apply the identical rule rather than two rules
 * that happen to agree today.
 *
 * WHY TYPES ARE PRESERVED HERE AND NOT IN CSV. A CSV cell is text regardless
 * of what produced it; an XLSX cell has a type, and a number or a date written
 * as a genuine number or date cell is what makes the file usable for a pivot
 * table or a SUM formula — the strongest argument in the issue for building
 * this at all. Only string values go through the formula guard: a number or a
 * `Date` cell is never evaluated as a formula by a spreadsheet application, so
 * defusing it would just misrepresent the data.
 */

import ExcelJS from 'exceljs';
import { CsvColumn, defuseFormula } from './csv';

/** Excel forbids these characters in a worksheet name, and caps it at 31. */
const SHEET_NAME_INVALID = /[\\/?*[\]:]/g;

const sheetTitle = (name: string): string => {
  const cleaned = name.replace(SHEET_NAME_INVALID, ' ').trim();
  return (cleaned || 'Export').slice(0, 31);
};

/**
 * A cell value ready to hand to `exceljs`: numbers, booleans and dates keep
 * their type, `null`/`undefined` become an empty cell, and everything else is
 * stringified and run through the shared formula guard.
 */
const xlsxCellValue = (value: unknown): string | number | boolean | Date | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return defuseFormula(text);
};

/**
 * Serializes rows as an XLSX workbook with one sheet, one column per declared
 * column and a bold header row.
 *
 * Returns a `Buffer` rather than writing a stream: every export in this system
 * is already bounded to a size the response buffer holds comfortably (see
 * `utils/csv.ts`'s "WHY NOT STREAMING"), and a buffer keeps `ExportService`'s
 * audit-then-send sequencing identical between formats.
 */
export const toXlsxBuffer = async <T>(
  rows: readonly T[],
  columns: readonly CsvColumn<T>[],
  sheetName = 'Export'
): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetTitle(sheetName));

  sheet.columns = columns.map((column) => ({ header: column.header, key: column.header }));
  for (const row of rows) {
    sheet.addRow(columns.map((column) => xlsxCellValue(column.value(row))));
  }
  sheet.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
};
