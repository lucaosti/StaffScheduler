/**
 * Audit log query service (F10).
 *
 * Read-only over the existing `audit_logs` table. The table is written
 * elsewhere (auth events, schedule lifecycle, etc.); this service only
 * surfaces it for the audit log viewer UI.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket } from 'mysql2/promise';

export interface AuditLogEntry {
  id: number;
  userId: number | null;
  action: string;
  entityType: string | null;
  entityId: number | null;
  description: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface AuditLogFilters {
  userId?: number;
  action?: string;
  entityType?: string;
  entityId?: number;
  fromDate?: string;
  toDate?: string;
  /** Max rows to return; clamped to [1, 500]. Default 100. */
  limit?: number;
  /** Offset into the ordered result set. Default 0. */
  offset?: number;
}

export interface AuditLogPage {
  total: number;
  items: AuditLogEntry[];
}

const mapRow = (row: RowDataPacket): AuditLogEntry => ({
  id: row.id as number,
  userId: (row.user_id as number | null) ?? null,
  action: row.action as string,
  entityType: (row.entity_type as string | null) ?? null,
  entityId: (row.entity_id as number | null) ?? null,
  description: (row.description as string | null) ?? null,
  ipAddress: (row.ip_address as string | null) ?? null,
  userAgent: (row.user_agent as string | null) ?? null,
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
  constructor(private pool: Pool) {}

  async list(filters: AuditLogFilters = {}): Promise<AuditLogPage> {
    const conditions: string[] = [];
    const params: Array<string | number> = [];

    if (filters.userId !== undefined) {
      conditions.push('user_id = ?');
      params.push(filters.userId);
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
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';

    const [countRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM audit_logs${where}`,
      params
    );
    const total = (countRows[0] as { c: number }).c;

    const limit = clampLimit(filters.limit);
    const offset = clampOffset(filters.offset);
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM audit_logs${where}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    return { total, items: rows.map(mapRow) };
  }

  async getById(id: number): Promise<AuditLogEntry | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM audit_logs WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows.length === 0 ? null : mapRow(rows[0]);
  }
}
