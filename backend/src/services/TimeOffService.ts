/**
 * Time-off / leave management (F02).
 *
 * Workflow:
 *   1. Employee creates a `time_off_requests` row with status `pending`.
 *   2. Manager reviews. Approval inserts a row into `user_unavailability`
 *      and links it back via `unavailability_id`.
 *   3. Rejected and cancelled requests stay in the table for the audit trail
 *      but never produce an unavailability block.
 *
 * The service is the single writer to `time_off_requests`. Routes are thin.
 *
 * @author Luca Ostinelli
 */

import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { logger } from '../config/logger';

type TimeOffType = 'vacation' | 'sick' | 'personal' | 'other';
type TimeOffStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

interface TimeOffRequest {
  id: number;
  userId: number;
  startDate: string;
  endDate: string;
  type: TimeOffType;
  reason: string | null;
  status: TimeOffStatus;
  reviewerId: number | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  unavailabilityId: number | null;
  createdAt: string;
  updatedAt: string;
}

interface CreateTimeOffInput {
  userId: number;
  startDate: string;
  endDate: string;
  type?: TimeOffType;
  reason?: string;
}

interface ListTimeOffFilters {
  userId?: number;
  status?: TimeOffStatus;
  /** When set, only return requests overlapping this window. */
  rangeStart?: string;
  rangeEnd?: string;
}

const mapRow = (row: RowDataPacket): TimeOffRequest => ({
  id: row.id as number,
  userId: row.user_id as number,
  startDate:
    typeof row.start_date === 'string'
      ? row.start_date
      : new Date(row.start_date).toISOString().slice(0, 10),
  endDate:
    typeof row.end_date === 'string'
      ? row.end_date
      : new Date(row.end_date).toISOString().slice(0, 10),
  type: row.type as TimeOffType,
  reason: (row.reason as string) ?? null,
  status: row.status as TimeOffStatus,
  reviewerId: (row.reviewer_id as number | null) ?? null,
  reviewedAt: (row.reviewed_at as string | null) ?? null,
  reviewNotes: (row.review_notes as string | null) ?? null,
  unavailabilityId: (row.unavailability_id as number | null) ?? null,
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
});

export class TimeOffService {
  constructor(private pool: Pool) {}

  /** Creates a new pending request. Range is validated; reason is optional. */
  async create(input: CreateTimeOffInput): Promise<TimeOffRequest> {
    if (!input.startDate || !input.endDate) {
      throw new Error('startDate and endDate are required');
    }
    if (input.endDate < input.startDate) {
      throw new Error('endDate must be on or after startDate');
    }

    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO time_off_requests (user_id, start_date, end_date, type, reason, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [
        input.userId,
        input.startDate,
        input.endDate,
        input.type ?? 'vacation',
        input.reason ?? null,
      ]
    );
    const created = await this.getById(result.insertId);
    if (!created) throw new Error('Failed to retrieve created time-off request');
    logger.info(`Time-off request created: id=${created.id} user=${input.userId}`);
    return created;
  }

  async getById(id: number): Promise<TimeOffRequest | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM time_off_requests WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows.length === 0 ? null : mapRow(rows[0]);
  }

  async list(filters: ListTimeOffFilters = {}): Promise<TimeOffRequest[]> {
    const conditions: string[] = [];
    const params: Array<string | number> = [];

    if (filters.userId !== undefined) {
      conditions.push('user_id = ?');
      params.push(filters.userId);
    }
    if (filters.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    }
    if (filters.rangeStart && filters.rangeEnd) {
      conditions.push('start_date <= ? AND end_date >= ?');
      params.push(filters.rangeEnd, filters.rangeStart);
    }

    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM time_off_requests${where} ORDER BY start_date DESC`,
      params
    );
    return rows.map(mapRow);
  }

  /**
   * Approves a pending request. Atomic: the unavailability row and the
   * status update happen in the same transaction, and the request links
   * to the unavailability row it produced.
   */
  async approve(
    id: number,
    reviewerId: number,
    notes: string | null = null
  ): Promise<TimeOffRequest> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

      const [rows] = await conn.execute<RowDataPacket[]>(
        `SELECT * FROM time_off_requests WHERE id = ? FOR UPDATE`,
        [id]
      );
      if (rows.length === 0) throw new Error('Time-off request not found');
      const current = mapRow(rows[0]);
      if (current.status !== 'pending') {
        throw new Error(`Cannot approve request in status '${current.status}'`);
      }

      const [unavailRes] = await conn.execute<ResultSetHeader>(
        `INSERT INTO user_unavailability (user_id, start_date, end_date, reason)
         VALUES (?, ?, ?, ?)`,
        [
          current.userId,
          current.startDate,
          current.endDate,
          `[time-off-request:${id}] ${current.reason ?? current.type}`,
        ]
      );

      await conn.execute(
        `UPDATE time_off_requests
            SET status = 'approved',
                reviewer_id = ?,
                reviewed_at = CURRENT_TIMESTAMP,
                review_notes = ?,
                unavailability_id = ?
          WHERE id = ?`,
        [reviewerId, notes, unavailRes.insertId, id]
      );

      await conn.commit();
      logger.info(`Time-off request approved: id=${id} reviewer=${reviewerId}`);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    const refreshed = await this.getById(id);
    if (!refreshed) throw new Error('Failed to retrieve approved request');
    return refreshed;
  }

  async reject(
    id: number,
    reviewerId: number,
    notes: string | null = null
  ): Promise<TimeOffRequest> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE time_off_requests
          SET status = 'rejected',
              reviewer_id = ?,
              reviewed_at = CURRENT_TIMESTAMP,
              review_notes = ?
        WHERE id = ? AND status = 'pending'`,
      [reviewerId, notes, id]
    );
    if (result.affectedRows === 0) {
      const existing = await this.getById(id);
      if (!existing) throw new Error('Time-off request not found');
      throw new Error(`Cannot reject request in status '${existing.status}'`);
    }
    logger.info(`Time-off request rejected: id=${id} reviewer=${reviewerId}`);
    const refreshed = await this.getById(id);
    if (!refreshed) throw new Error('Failed to retrieve rejected request');
    return refreshed;
  }

  /**
   * Cancellation by the requesting user. Only allowed while still pending,
   * to avoid unilaterally undoing an already-approved time off (which would
   * orphan the unavailability row).
   */
  async cancel(id: number, requesterId: number): Promise<TimeOffRequest> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE time_off_requests
          SET status = 'cancelled'
        WHERE id = ? AND user_id = ? AND status = 'pending'`,
      [id, requesterId]
    );
    if (result.affectedRows === 0) {
      const existing = await this.getById(id);
      if (!existing) throw new Error('Time-off request not found');
      if (existing.userId !== requesterId) throw new Error('Forbidden');
      throw new Error(`Cannot cancel request in status '${existing.status}'`);
    }
    logger.info(`Time-off request cancelled: id=${id} user=${requesterId}`);
    const refreshed = await this.getById(id);
    if (!refreshed) throw new Error('Failed to retrieve cancelled request');
    return refreshed;
  }
}
