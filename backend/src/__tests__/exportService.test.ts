/**
 * `ExportService` — the one place a dataset leaves the system as a file.
 *
 * The assertions that matter here are not about CSV or XLSX specifically.
 * They are about the audit record: an export copies data out of the system's
 * access controls entirely, and once the file exists no later permission
 * change reaches it. The log is the only thing that makes that reviewable,
 * which is why "it was written" and "it says which rows" are tested as hard
 * as the response body — for both formats, since `send` is the one method
 * both go through.
 *
 * @author Luca Ostinelli
 */

import ExcelJS from 'exceljs';
import { ExportService, ExportResponse } from '../services/ExportService';
import { CSV_BOM } from '../utils/csv';

export {};

interface Row {
  id: number;
  name: string;
}

const columns = [
  { header: 'ID', value: (r: Row) => r.id },
  { header: 'Name', value: (r: Row) => r.name },
];

const makeRes = () => {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: jest.fn((name: string, value: string) => {
      headers[name] = value;
    }),
    send: jest.fn(),
  };
  return { res: res as unknown as ExportResponse & typeof res, headers };
};

const makeAudit = () => ({ write: jest.fn().mockResolvedValue(undefined) });

const readXlsxRows = async (buffer: Buffer): Promise<unknown[][]> => {
  const workbook = new ExcelJS.Workbook();
  // See `xlsx.util.test.ts` for why this cast is needed: `exceljs`'s declared
  // `Buffer` type resolves against a different `@types/node` copy than this
  // package's.
  await workbook.xlsx.load(buffer as never);
  const sheet = workbook.worksheets[0];
  const rows: unknown[][] = [];
  sheet.eachRow((row) => rows.push(row.values as unknown[]));
  return rows;
};

describe('ExportService.send (CSV, the default)', () => {
  it('sends the rows as a CSV attachment', async () => {
    const { res, headers } = makeRes();
    const audit = makeAudit();
    await new ExportService(audit as never).send(res, {
      actorId: 7,
      dataset: 'employees',
      rows: [{ id: 1, name: 'Rossi' }],
      columns,
    });

    expect(headers['Content-Type']).toBe('text/csv; charset=utf-8');
    expect(headers['Content-Disposition']).toMatch(/^attachment; filename="employees_\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.send).toHaveBeenCalledWith(`${CSV_BOM}ID,Name\r\n1,Rossi`);
  });

  it('records who exported what, and with which filters', async () => {
    const audit = makeAudit();
    const { res } = makeRes();
    await new ExportService(audit as never).send(res, {
      actorId: 7,
      dataset: 'time-off',
      rows: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }],
      columns,
      filters: { status: 'approved', userId: 3 },
    });

    const entry = audit.write.mock.calls[0][0];
    expect(entry).toMatchObject({ actorId: 7, action: 'export', entityType: 'time-off' });
    // "Exported 412 rows" does not answer the question an investigation asks,
    // which is *which* 412. The filters are what make it reproducible.
    expect(entry.after).toEqual({ format: 'csv', rowCount: 2, filters: { status: 'approved', userId: 3 } });
  });

  it('records the export before sending it', async () => {
    // If the send then fails, the log over-reports. That is the right direction
    // to be wrong in: a missing record of a delivered file is a hole in the
    // trail, while a record of an undelivered one is a question with an answer.
    const order: string[] = [];
    const audit = { write: jest.fn(async () => { order.push('audit'); }) };
    const res = {
      setHeader: jest.fn(),
      send: jest.fn(() => { order.push('send'); }),
    } as unknown as ExportResponse;

    await new ExportService(audit as never).send(res, {
      actorId: 1,
      dataset: 'shifts',
      rows: [],
      columns,
    });

    expect(order).toEqual(['audit', 'send']);
  });

  it('still sends a header-only file when nothing matched', async () => {
    const { res } = makeRes();
    await new ExportService(makeAudit() as never).send(res, {
      actorId: 1,
      dataset: 'shifts',
      rows: [],
      columns,
    });
    expect(res.send).toHaveBeenCalledWith(`${CSV_BOM}ID,Name`);
  });

  it('records an empty filter set rather than omitting the field', async () => {
    const audit = makeAudit();
    const { res } = makeRes();
    await new ExportService(audit as never).send(res, {
      actorId: 1,
      dataset: 'shifts',
      rows: [],
      columns,
    });
    // An absent `filters` and "no filters were applied" are different claims,
    // and the second is the one an unfiltered export makes.
    expect(audit.write.mock.calls[0][0].after.filters).toEqual({});
  });

  it('never lets caller text reach the Content-Disposition header', async () => {
    const { res, headers } = makeRes();
    await new ExportService(makeAudit() as never).send(res, {
      actorId: 1,
      dataset: 'fairness "schedule"\r\nX-Injected: 1',
      rows: [],
      columns,
    });
    const header = headers['Content-Disposition'];
    // No CR, no LF and no stray quote: those are the three characters that end
    // a header value early and start a new one.
    expect(header).not.toMatch(/[\r\n]/);
    expect(header.match(/"/g)).toHaveLength(2);
    expect(header).toMatch(/^attachment; filename="[a-z0-9-]+_\d{4}-\d{2}-\d{2}\.csv"$/);
  });

  it('defaults to csv when no format is given', async () => {
    const { res, headers } = makeRes();
    await new ExportService(makeAudit() as never).send(res, {
      actorId: 1,
      dataset: 'shifts',
      rows: [],
      columns,
    });
    expect(headers['Content-Type']).toBe('text/csv; charset=utf-8');
  });
});

describe('ExportService.send (XLSX)', () => {
  it('sends the rows as an XLSX attachment with the OOXML content type', async () => {
    const { res, headers } = makeRes();
    const audit = makeAudit();
    await new ExportService(audit as never).send(res, {
      actorId: 7,
      dataset: 'employees',
      rows: [{ id: 1, name: 'Rossi' }],
      columns,
      format: 'xlsx',
    });

    expect(headers['Content-Type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(headers['Content-Disposition']).toMatch(/^attachment; filename="employees_\d{4}-\d{2}-\d{2}\.xlsx"$/);
    expect(res.send).toHaveBeenCalledTimes(1);
    const buffer = res.send.mock.calls[0][0] as Buffer;
    expect(Buffer.isBuffer(buffer)).toBe(true);

    const rows = await readXlsxRows(buffer);
    expect(rows[0]).toEqual(expect.arrayContaining(['ID', 'Name']));
    expect(rows[1]).toEqual(expect.arrayContaining([1, 'Rossi']));
  });

  it('records the format actually sent, not the default', async () => {
    const audit = makeAudit();
    const { res } = makeRes();
    await new ExportService(audit as never).send(res, {
      actorId: 7,
      dataset: 'shifts',
      rows: [{ id: 1, name: 'a' }],
      columns,
      format: 'xlsx',
    });

    expect(audit.write.mock.calls[0][0].after).toMatchObject({ format: 'xlsx', rowCount: 1 });
  });

  it('records the export before sending it, same as CSV', async () => {
    const order: string[] = [];
    const audit = { write: jest.fn(async () => { order.push('audit'); }) };
    const res = {
      setHeader: jest.fn(),
      send: jest.fn(() => { order.push('send'); }),
    } as unknown as ExportResponse;

    await new ExportService(audit as never).send(res, {
      actorId: 1,
      dataset: 'shifts',
      rows: [],
      columns,
      format: 'xlsx',
    });

    expect(order).toEqual(['audit', 'send']);
  });
});
