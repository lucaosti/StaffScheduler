/**
 * Audit log service.
 *
 * Provides both read (list / getById) and write (write) operations over the
 * `audit_logs` table. Every sensitive mutation in the application should call
 * `AuditLogService.write` to record a structured audit entry, optionally with:
 *   - before/after JSON snapshots of the affected entity
 *   - a free-text justification supplied by the actor
 *   - an `onBehalfOfUserId` for proxy / approval-workflow actions
 *
 * `ip_address`, `user_agent`, and `request_id` are populated automatically
 * from the AsyncLocalStorage request context when `requestId` middleware is
 * active, so callers do not need to pass them explicitly.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { ValidationUtils } from '../utils';
import { logger } from '../config/logger';
import { ValidationError } from '../errors';
import { getRequestId, getRequestIp, getRequestUserAgent } from '../middleware/requestContext';
import { CsvColumn, toCsv } from '../utils/csv';

/**
 * Hard ceiling on a single audit export. Sized so a full export still fits
 * comfortably in memory; beyond it the caller must narrow the range (see
 * exportAll for why this refuses instead of truncating).
 */
const EXPORT_MAX_ROWS = 100_000;

export interface AuditLogEntry {
  id: number;
  userId: number | null;
  onBehalfOfUserId: number | null;
  action: string;
  entityType: string | null;
  entityId: number | null;
  description: string | null;
  justification: string | null;
  beforeSnapshot?: Record<string, unknown> | null;
  afterSnapshot?: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: string;
}

export interface WriteAuditLogInput {
  actorId: number | null;
  /** When the action was performed on behalf of another user (proxy / approval). */
  onBehalfOfUserId?: number | null;
  action: string;
  entityType?: string;
  entityId?: number | null;
  description?: string;
  /** Optional free-text reason provided by the actor at the time of the action. */
  justification?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  /**
   * When true, the write() method throws on DB failure instead of swallowing the
   * error. Use for high-compliance actions where a missing audit record must stop
   * the operation. Default: false (fire-and-forget, never blocks the caller).
   */
  throwOnFailure?: boolean;
}

export interface AuditLogFilters {
  userId?: number;
  onBehalfOfUserId?: number;
  action?: string;
  entityType?: string;
  entityId?: number;
  fromDate?: string;
  toDate?: string;
  requestId?: string;
  /** Max rows to return; clamped to [1, 500]. Default 100. */
  limit?: number;
  /** Offset into the ordered result set. Default 0. */
  offset?: number;
}

interface AuditLogPage {
  total: number;
  items: AuditLogEntry[];
}

/** Null on absence or corruption: an unreadable snapshot is not a snapshot. */
const parseJson = (raw: unknown): Record<string, unknown> | null =>
  ValidationUtils.parseJsonColumn<Record<string, unknown> | null>(raw, null, 'audit_logs snapshot');

const mapRow = (row: RowDataPacket): AuditLogEntry => ({
  id: row.id as number,
  userId: (row.user_id as number | null) ?? null,
  onBehalfOfUserId: (row.on_behalf_of_user_id as number | null) ?? null,
  action: row.action as string,
  entityType: (row.entity_type as string | null) ?? null,
  entityId: (row.entity_id as number | null) ?? null,
  description: (row.description as string | null) ?? null,
  justification: (row.justification as string | null) ?? null,
  beforeSnapshot: parseJson(row.before_snapshot),
  afterSnapshot: parseJson(row.after_snapshot),
  ipAddress: (row.ip_address as string | null) ?? null,
  userAgent: (row.user_agent as string | null) ?? null,
  requestId: (row.request_id as string | null) ?? null,
  createdAt: row.created_at as string,
});

const clampLimit = (raw: number | undefined): number => {
  if (raw === undefined || Number.isNaN(raw)) return 100;
  return Math.max(1, Math.min(500, Math.trunc(raw)));
};

const clampOffset = (raw: number | undefined): number => {
  if (raw === undefined || Number.isNaN(raw) || raw < 0) return 0;
  return Math.trunc(raw);
};

export class AuditLogService {
  // list/getById/exportAll are read-only and go through readPool (a replica
  // when #323 configures one, otherwise the same pool as always — see
  // config/database.ts's createReadPool); write() always uses the primary
  // pool, since a replica lags and this is the one method that mutates.
  constructor(private pool: Pool, private readPool: Pool = pool) {}

  async list(filters: AuditLogFilters = {}): Promise<AuditLogPage> {
    const conditions: string[] = [];
    const params: Array<string | number> = [];

    if (filters.userId !== undefined) {
      conditions.push('user_id = ?');
      params.push(filters.userId);
    }
    if (filters.onBehalfOfUserId !== undefined) {
      conditions.push('on_behalf_of_user_id = ?');
      params.push(filters.onBehalfOfUserId);
    }
    if (filters.action) {
      conditions.push('action = ?');
      params.push(filters.action);
    }
    if (filters.entityType) {
      conditions.push('entity_type = ?');
      params.push(filters.entityType);
    }
    if (filters.entityId !== undefined) {
      conditions.push('entity_id = ?');
      params.push(filters.entityId);
    }
    if (filters.fromDate) {
      conditions.push('created_at >= ?');
      params.push(filters.fromDate);
    }
    if (filters.toDate) {
      conditions.push('created_at <= ?');
      params.push(filters.toDate);
    }
    if (filters.requestId) {
      conditions.push('request_id = ?');
      params.push(filters.requestId);
    }
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';

    const [countRows] = await this.readPool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM audit_logs${where}`,
      params
    );
    const total = (countRows[0] as { c: number }).c;

    // Inlined rather than bound: MySQL's binary prepared-statement protocol
    // rejects placeholders for LIMIT/OFFSET, so `execute()` failed every call
    // with ER_WRONG_ARGUMENTS — GET /api/audit-logs returned 500 unconditionally.
    // Both values are clamped integers, never caller-supplied text, which is
    // the same reasoning the export query and OutboxWorker already rely on.
    const limit = clampLimit(filters.limit);
    const offset = clampOffset(filters.offset);
    const [rows] = await this.readPool.execute<RowDataPacket[]>(
      `SELECT * FROM audit_logs${where}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    return { total, items: rows.map(mapRow) };
  }

  async getById(id: number): Promise<AuditLogEntry | null> {
    const [rows] = await this.readPool.execute<RowDataPacket[]>(
      `SELECT * FROM audit_logs WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows.length === 0 ? null : mapRow(rows[0]);
  }

  /**
   * Exports the audit log entries matching the given filters, ordered by
   * created_at ASC so the chronological record is preserved.
   *
   * WHY THIS IS BOUNDED, AND WHY IT REFUSES RATHER THAN TRUNCATES: this used to
   * run an unlimited `SELECT *` and materialise every row, warning only *after*
   * 50k rows had already been loaded — so it reported the problem instead of
   * preventing it. `audit_logs` is append-only and grows with every sensitive
   * mutation, so one unscoped export could exhaust the heap and take the process
   * down.
   *
   * The obvious alternative — silently capping the result — is worse than the
   * bug for this table: an audit export is a compliance artefact, and returning
   * a partial one that *looks* complete is a correctness failure. So the query
   * fetches one row past the cap purely to detect overflow and throws a
   * ValidationError telling the caller to narrow the range. Callers get either
   * a complete export or a clear, actionable refusal — never a quiet half-truth.
   *
   * @param filters Same filter options as list(), but limit/offset are ignored.
   * @throws ValidationError when the result would exceed EXPORT_MAX_ROWS.
   */
  async exportAll(filters: Omit<AuditLogFilters, 'limit' | 'offset'> = {}): Promise<AuditLogEntry[]> {
    const conditions: string[] = [];
    const params: Array<string | number> = [];

    if (filters.userId !== undefined) { conditions.push('user_id = ?'); params.push(filters.userId); }
    if (filters.onBehalfOfUserId !== undefined) { conditions.push('on_behalf_of_user_id = ?'); params.push(filters.onBehalfOfUserId); }
    if (filters.action) { conditions.push('action = ?'); params.push(filters.action); }
    if (filters.entityType) { conditions.push('entity_type = ?'); params.push(filters.entityType); }
    if (filters.entityId !== undefined) { conditions.push('entity_id = ?'); params.push(filters.entityId); }
    if (filters.fromDate) { conditions.push('created_at >= ?'); params.push(filters.fromDate); }
    if (filters.toDate) { conditions.push('created_at <= ?'); params.push(filters.toDate); }
    if (filters.requestId) { conditions.push('request_id = ?'); params.push(filters.requestId); }

    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    // Fetch one row beyond the cap: its presence is the overflow signal, and it
    // costs one row rather than a second COUNT(*) pass over the table.
    const [rows] = await this.readPool.execute<RowDataPacket[]>(
      `SELECT * FROM audit_logs${where} ORDER BY created_at ASC LIMIT ${EXPORT_MAX_ROWS + 1}`,
      params
    );
    if (rows.length > EXPORT_MAX_ROWS) {
      logger.warn('audit export refused: result exceeds the export cap', {
        cap: EXPORT_MAX_ROWS,
      });
      throw new ValidationError(
        `Export matches more than ${EXPORT_MAX_ROWS} entries. Narrow the range with fromDate/toDate or additional filters, then export again.`
      );
    }
    return (rows as RowDataPacket[]).map(mapRow);
  }

  /**
   * Serialises an array of audit log entries to CSV. Includes a header row.
   * Snapshot fields are rendered as compact JSON strings.
   */
  /**
   * The audit log's own CSV columns.
   *
   * WHY THIS BECAME COLUMNS RATHER THAN A SERIALIZER. This method used to build
   * the CSV itself, and it was the only export in the system, so its quoting was
   * the system's quoting. It lacked a BOM (Excel mangled every accented name)
   * and a formula guard (a `description` is partly free text). Both are now the
   * shared serializer's business; what stays here is the column list, which is
   * genuinely this dataset's own — snapshots included, which is why `csvField`
   * JSON-encodes objects at all.
   */
  static readonly csvColumns: readonly CsvColumn<AuditLogEntry>[] = [
    { header: 'id', value: (e) => e.id },
    { header: 'created_at', value: (e) => e.createdAt },
    { header: 'user_id', value: (e) => e.userId },
    { header: 'on_behalf_of_user_id', value: (e) => e.onBehalfOfUserId },
    { header: 'action', value: (e) => e.action },
    { header: 'entity_type', value: (e) => e.entityType },
    { header: 'entity_id', value: (e) => e.entityId },
    { header: 'description', value: (e) => e.description },
    { header: 'justification', value: (e) => e.justification },
    { header: 'ip_address', value: (e) => e.ipAddress },
    { header: 'user_agent', value: (e) => e.userAgent },
    { header: 'request_id', value: (e) => e.requestId },
    { header: 'before_snapshot', value: (e) => e.beforeSnapshot },
    { header: 'after_snapshot', value: (e) => e.afterSnapshot },
  ];

  /**
   * Kept as a named entry point because the header names above are a published
   * contract — compliance tooling parses this file by column name — and a caller
   * should not have to know which column list belongs to which dataset.
   */
  static toCsv(entries: AuditLogEntry[]): string {
    return toCsv(entries, AuditLogService.csvColumns);
  }


  /**
   * Writes a single audit log entry. `ip_address`, `user_agent`, and
   * `request_id` are pulled automatically from the AsyncLocalStorage context
   * when a request is in flight.
   *
   * By default the write is fire-and-forget: errors are logged but never
   * propagated so audit failures never break the primary operation. Set
   * `throwOnFailure: true` for actions where a missing audit record must
   * abort the entire transaction.
   */
  async write(input: WriteAuditLogInput): Promise<void> {
    try {
      await this.pool.execute<ResultSetHeader>(
        `INSERT INTO audit_logs
           (user_id, on_behalf_of_user_id, action, entity_type, entity_id,
            description, justification, before_snapshot, after_snapshot,
            ip_address, user_agent, request_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.actorId,
          input.onBehalfOfUserId ?? null,
          input.action,
          input.entityType ?? null,
          input.entityId ?? null,
          input.description ?? null,
          input.justification ?? null,
          input.before != null ? JSON.stringify(input.before) : null,
          input.after != null ? JSON.stringify(input.after) : null,
          getRequestIp(),
          getRequestUserAgent(),
          getRequestId() ?? null,
        ]
      );
    } catch (err) {
      logger.error('Failed to write audit log', {
        action: input.action,
        actorId: input.actorId,
        entityType: input.entityType,
        entityId: input.entityId,
        error: err,
      });
      if (input.throwOnFailure) throw err;
    }
  }
}
