/**
 * On-call (reperibilità) service (F21).
 *
 * On-call periods are modelled alongside shifts. A regular shift means
 * active duty; an on-call period means "be reachable, come in if paged".
 * Each period needs `min_staff..max_staff` users available; assignments
 * are tracked separately so a user can be on-call for one window while
 * actively working a different shift in another, as long as the F19
 * compliance engine accepts the combined load.
 *
 * @author Luca Ostinelli
 */

import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { logger } from '../config/logger';

export type OnCallStatus = 'open' | 'assigned' | 'cancelled';
export type OnCallAssignmentStatus = 'pending' | 'confirmed' | 'cancelled';

export interface OnCallPeriod {
  id: number;
  scheduleId: number | null;
  departmentId: number;
  departmentName?: string;
  date: string;
  startTime: string;
  endTime: string;
  minStaff: number;
  maxStaff: number;
  notes: string | null;
  status: OnCallStatus;
  assignedCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOnCallPeriodInput {
  scheduleId?: number | null;
  departmentId: number;
  date: string;
  startTime: string;
  endTime: string;
  minStaff?: number;
  maxStaff?: number;
  notes?: string;
}

export interface UpdateOnCallPeriodInput {
  date?: string;
  startTime?: string;
  endTime?: string;
  minStaff?: number;
  maxStaff?: number;
  notes?: string | null;
  status?: OnCallStatus;
}

export interface OnCallAssignment {
  id: number;
  periodId: number;
  userId: number;
  status: OnCallAssignmentStatus;
  assignedAt: string;
  assignedBy: number | null;
  notes: string | null;
}

const mapPeriod = (row: RowDataPacket): OnCallPeriod => ({
  id: row.id as number,
  scheduleId: (row.schedule_id as number | null) ?? null,
  departmentId: row.department_id as number,
  departmentName: (row.department_name as string | undefined) ?? undefined,
  date:
    typeof row.date === 'string'
      ? row.date
      : new Date(row.date as Date).toISOString().slice(0, 10),
  startTime: row.start_time as string,
  endTime: row.end_time as string,
  minStaff: row.min_staff as number,
  maxStaff: row.max_staff as number,
  notes: (row.notes as string | null) ?? null,
  status: row.status as OnCallStatus,
  assignedCount: (row.assigned_count as number | null) ?? 0,
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
});

const mapAssignment = (row: RowDataPacket): OnCallAssignment => ({
  id: row.id as number,
  periodId: row.period_id as number,
  userId: row.user_id as number,
  status: row.status as OnCallAssignmentStatus,
  assignedAt: row.assigned_at as string,
  assignedBy: (row.assigned_by as number | null) ?? null,
  notes: (row.notes as string | null) ?? null,
});

export class OnCallService {
  constructor(private pool: Pool) {}

  /**
   * Validates time inputs and creates a new on-call period. The
   * `min_staff <= max_staff` check is enforced here rather than at the DB
   * level so the error message is friendly.
   */
  async createPeriod(input: CreateOnCallPeriodInput): Promise<OnCallPeriod> {
    const minStaff = input.minStaff ?? 1;
    const maxStaff = input.maxStaff ?? Math.max(2, minStaff);
    if (minStaff < 1) throw new Error('minStaff must be >= 1');
    if (maxStaff < minStaff) throw new Error('maxStaff must be >= minStaff');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('Invalid date');
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(input.startTime)) throw new Error('Invalid startTime');
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(input.endTime)) throw new Error('Invalid endTime');

    const [res] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO on_call_periods
            (schedule_id, department_id, date, start_time, end_time,
             min_staff, max_staff, notes, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
      [
        input.scheduleId ?? null,
        input.departmentId,
        input.date,
        input.startTime,
        input.endTime,
        minStaff,
        maxStaff,
        input.notes ?? null,
      ]
    );
    const created = await this.getPeriodById(res.insertId);
    if (!created) throw new Error('Failed to retrieve created on-call period');
    logger.info(`On-call period created: id=${created.id}`);
    return created;
  }

  async getPeriodById(id: number): Promise<OnCallPeriod | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT p.*, d.name AS department_name,
              COUNT(DISTINCT a.id) AS assigned_count
         FROM on_call_periods p
         LEFT JOIN departments d ON p.department_id = d.id
         LEFT JOIN on_call_assignments a ON a.period_id = p.id
              AND a.status IN ('pending', 'confirmed')
        WHERE p.id = ?
        GROUP BY p.id`,
      [id]
    );
    return rows.length === 0 ? null : mapPeriod(rows[0]);
  }

  async listPeriods(filters: {
    departmentId?: number;
    status?: OnCallStatus;
    rangeStart?: string;
    rangeEnd?: string;
  } = {}): Promise<OnCallPeriod[]> {
    const conditions: string[] = [];
    const params: Array<string | number> = [];
    if (filters.departmentId !== undefined) {
      conditions.push('p.department_id = ?');
      params.push(filters.departmentId);
    }
    if (filters.status) {
      conditions.push('p.status = ?');
      params.push(filters.status);
    }
    if (filters.rangeStart) {
      conditions.push('p.date >= ?');
      params.push(filters.rangeStart);
    }
    if (filters.rangeEnd) {
      conditions.push('p.date <= ?');
      params.push(filters.rangeEnd);
    }
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT p.*, d.name AS department_name,
              COUNT(DISTINCT a.id) AS assigned_count
         FROM on_call_periods p
         LEFT JOIN departments d ON p.department_id = d.id
         LEFT JOIN on_call_assignments a ON a.period_id = p.id
              AND a.status IN ('pending', 'confirmed')
         ${where}
        GROUP BY p.id
        ORDER BY p.date ASC, p.start_time ASC`,
      params
    );
    return rows.map(mapPeriod);
  }

  async updatePeriod(id: number, input: UpdateOnCallPeriodInput): Promise<OnCallPeriod> {
    const updates: string[] = [];
    const values: Array<string | number | null> = [];
    if (input.date !== undefined) { updates.push('date = ?'); values.push(input.date); }
    if (input.startTime !== undefined) { updates.push('start_time = ?'); values.push(input.startTime); }
    if (input.endTime !== undefined) { updates.push('end_time = ?'); values.push(input.endTime); }
    if (input.minStaff !== undefined) { updates.push('min_staff = ?'); values.push(input.minStaff); }
    if (input.maxStaff !== undefined) { updates.push('max_staff = ?'); values.push(input.maxStaff); }
    if (input.notes !== undefined) { updates.push('notes = ?'); values.push(input.notes); }
    if (input.status !== undefined) { updates.push('status = ?'); values.push(input.status); }

    if (updates.length === 0) {
      const existing = await this.getPeriodById(id);
      if (!existing) throw new Error('On-call period not found');
      return existing;
    }
    values.push(id);
    const [res] = await this.pool.execute<ResultSetHeader>(
      `UPDATE on_call_periods SET ${updates.join(', ')} WHERE id = ?`,
      values
    );
    if (res.affectedRows === 0) throw new Error('On-call period not found');
    const updated = await this.getPeriodById(id);
    if (!updated) throw new Error('On-call period not found after update');
    return updated;
  }

  async deletePeriod(id: number): Promise<boolean> {
    const [res] = await this.pool.execute<ResultSetHeader>(
      `DELETE FROM on_call_periods WHERE id = ?`,
      [id]
    );
    if (res.affectedRows === 0) throw new Error('On-call period not found');
    return true;
  }

  async assign(
    periodId: number,
    userId: number,
    assignedBy: number,
    notes: string | null = null
  ): Promise<OnCallAssignment> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

      const [periodRows] = await conn.execute<RowDataPacket[]>(
        `SELECT id, max_staff,
                (SELECT COUNT(*) FROM on_call_assignments
                  WHERE period_id = on_call_periods.id
                    AND status IN ('pending', 'confirmed')) AS assigned_count
           FROM on_call_periods WHERE id = ? FOR UPDATE`,
        [periodId]
      );
      if (periodRows.length === 0) throw new Error('On-call period not found');
      const period = periodRows[0];
      if ((period.assigned_count as number) >= (period.max_staff as number)) {
        throw new Error('On-call period is already at max capacity');
      }

      const [insRes] = await conn.execute<ResultSetHeader>(
        `INSERT INTO on_call_assignments (period_id, user_id, status, assigned_by, notes)
         VALUES (?, ?, 'pending', ?, ?)
         ON DUPLICATE KEY UPDATE status = VALUES(status), notes = VALUES(notes)`,
        [periodId, userId, assignedBy, notes]
      );

      // Promote period status to 'assigned' once we hit min_staff confirmed
      await conn.execute(
        `UPDATE on_call_periods
            SET status = CASE
              WHEN (SELECT COUNT(*) FROM on_call_assignments
                     WHERE period_id = on_call_periods.id
                       AND status IN ('pending','confirmed')) >= min_staff
              THEN 'assigned'
              ELSE status
            END
          WHERE id = ?`,
        [periodId]
      );

      await conn.commit();

      const [out] = await this.pool.execute<RowDataPacket[]>(
        `SELECT * FROM on_call_assignments WHERE id = ? OR (period_id = ? AND user_id = ?)
          ORDER BY id DESC LIMIT 1`,
        [insRes.insertId, periodId, userId]
      );
      logger.info(`On-call assignment: period=${periodId} user=${userId}`);
      return mapAssignment(out[0]);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async unassign(periodId: number, userId: number): Promise<boolean> {
    const [res] = await this.pool.execute<ResultSetHeader>(
      `DELETE FROM on_call_assignments WHERE period_id = ? AND user_id = ?`,
      [periodId, userId]
    );
    return res.affectedRows > 0;
  }

  async listAssignments(periodId: number): Promise<OnCallAssignment[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM on_call_assignments WHERE period_id = ? ORDER BY assigned_at`,
      [periodId]
    );
    return rows.map(mapAssignment);
  }

  async listForUser(
    userId: number,
    options: { rangeStart?: string; rangeEnd?: string } = {}
  ): Promise<Array<OnCallPeriod & { assignmentStatus: OnCallAssignmentStatus }>> {
    const conditions = ['a.user_id = ?'];
    const params: Array<string | number> = [userId];
    if (options.rangeStart) {
      conditions.push('p.date >= ?');
      params.push(options.rangeStart);
    }
    if (options.rangeEnd) {
      conditions.push('p.date <= ?');
      params.push(options.rangeEnd);
    }
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT p.*, d.name AS department_name, a.status AS a_status,
              COUNT(DISTINCT a2.id) AS assigned_count
         FROM on_call_assignments a
         JOIN on_call_periods p ON a.period_id = p.id
         LEFT JOIN departments d ON p.department_id = d.id
         LEFT JOIN on_call_assignments a2 ON a2.period_id = p.id
              AND a2.status IN ('pending', 'confirmed')
        WHERE ${conditions.join(' AND ')}
        GROUP BY p.id
        ORDER BY p.date ASC, p.start_time ASC`,
      params
    );
    return rows.map((r) => ({
      ...mapPeriod(r),
      assignmentStatus: r.a_status as OnCallAssignmentStatus,
    }));
  }
}
