/**
 * The single way a dataset leaves this system as a file.
 *
 * WHY A SERVICE AND NOT A HELPER FUNCTION. Two obligations attach to every
 * export, and both are the kind that get forgotten one endpoint at a time:
 *
 *  - it must be AUDITED. An export copies data out of the system's access
 *    controls entirely — once a manager has the file, no later permission change
 *    reaches it. The record of who took what, and with which filters, is the
 *    only thing that makes that reviewable, and it is the record an auditor asks
 *    for first. The audit write happens HERE, so an export that skipped it would
 *    have to be written by deliberately not using this class.
 *
 *  - it must respect the caller's scope. That is not enforced here, because it
 *    cannot be: scope lives in the query the route already ran. What this class
 *    enforces is that the rows it receives are the rows the route's own listing
 *    call returned — every export endpoint calls the same service method as its
 *    JSON sibling with the same filters, minus pagination. An export that built
 *    its own query would be a second, unreviewed authorization path.
 *
 * WHY THE FILTERS ARE RECORDED, NOT JUST THE ROW COUNT. "Exported 412 rows" does
 * not answer the question an investigation asks, which is *which* 412. The
 * filters are what make the export reproducible.
 *
 * WHY THE AUDIT WRITE IS AWAITED AND ALLOWED TO FAIL. `write` is fire-and-forget
 * by default and stays that way: refusing a legitimate export because the audit
 * table is briefly unavailable would make reporting depend on the availability
 * of its own bookkeeping. This is a read, not a state change — the asymmetry is
 * deliberate, and the same call is available with `throwOnFailure` if a
 * deployment decides otherwise.
 *
 * WHY ONE METHOD FOR BOTH FORMATS. `sendCsv` and a hypothetical `sendXlsx`
 * would duplicate every line of this class except the serializer and the two
 * response headers — the audited-rows contract, the filename rule and the
 * before/after ordering are not format-specific and must not be given a
 * second chance to disagree between formats. `format` defaults to `'csv'` so
 * the seven call sites that predate XLSX support keep behaving exactly as
 * they did without passing anything new.
 *
 * @author Luca Ostinelli
 */

import { AuditLogService } from './AuditLogService';
import { CsvColumn, csvFilename, exportFilename, toCsv } from '../utils/csv';
import { toXlsxBuffer } from '../utils/xlsx';

export type ExportFormat = 'csv' | 'xlsx';

/**
 * The minimum of `express.Response` this needs, so the serialization layer does
 * not drag a web framework into anything that wants to test it.
 */
export interface ExportResponse {
  setHeader(name: string, value: string): void;
  send(body: string | Buffer): unknown;
}

export interface ExportRequest<T> {
  /** Who is taking the data. Null only if an unauthenticated path ever exports. */
  actorId: number | null;
  /** Stable dataset name — the audit action suffix and the filename base. */
  dataset: string;
  rows: readonly T[];
  columns: readonly CsvColumn<T>[];
  /** The filters that produced these rows, recorded so the export is reproducible. */
  filters?: Record<string, unknown>;
  /** Defaults to `'csv'`. */
  format?: ExportFormat;
}

const CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export class ExportService {
  private readonly audit: AuditLogService;

  constructor(audit: AuditLogService) {
    this.audit = audit;
  }

  /**
   * Serializes the rows in the requested format, records the export, and
   * writes the response.
   *
   * The audit entry is written BEFORE the body is sent. If the send then fails,
   * the log over-reports — an export recorded that the caller may not have
   * received. That is the right direction to be wrong in: a missing record of a
   * delivered file is a hole in the audit trail, while a record of an
   * undelivered one is a question someone can answer.
   */
  async send<T>(res: ExportResponse, request: ExportRequest<T>): Promise<void> {
    const { actorId, dataset, rows, columns, filters, format = 'csv' } = request;
    const filename =
      format === 'xlsx' ? exportFilename(dataset, 'xlsx') : csvFilename(dataset);

    await this.audit.write({
      actorId,
      action: 'export',
      entityType: dataset,
      description: `Exported ${rows.length} row(s) of ${dataset} as ${format.toUpperCase()}`,
      after: { format, rowCount: rows.length, filters: filters ?? {} },
    });

    res.setHeader('Content-Type', CONTENT_TYPES[format]);
    // The filename is built by `csvFilename`/`exportFilename`, which slugify —
    // so no caller input reaches this header unescaped.
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    if (format === 'xlsx') {
      res.send(await toXlsxBuffer(rows, columns, dataset));
      return;
    }
    res.send(toCsv(rows, columns));
  }
}
