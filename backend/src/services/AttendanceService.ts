/**
 * Attendance tracking (clock-in / clock-out).
 *
 * Workflow:
 *   1. Employee clocks themselves in — creates a `pending` `attendance_records`
 *      row. At most one open (no clock_out) record per user at a time.
 *   2. Employee clocks themselves out on their own open record.
 *   3. A reviewer (`attendance.approve`) approves or rejects the completed
 *      punch. Only approved records count toward the actual-cost estimate.
 *
 * Punches are free-standing: they are not required to reference a planned
 * shift. `shift_assignment_id` is set on a best-effort basis at clock-in time
 * when exactly one assignment for that user/day exists; reconciliation
 * against the plan otherwise happens read-side in `getCostEstimate`.
 *
 * The service is the single writer to `attendance_records`. Routes are thin.
 *
 * @author Luca Ostinelli
 */

import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors';
import { logger } from '../config/logger';
import { AuditLogService } from './AuditLogService';

type AttendanceStatus = 'pending' | 'approved' | 'rejected';

interface AttendanceRecord {
  id: number;
  userId: number;
  shiftAssignmentId: number | null;
  clockIn: string;
  clockOut: string | null;
  status: AttendanceStatus;
  reviewerId: number | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ListAttendanceFilters {
  userId?: number;
  status?: AttendanceStatus;
  rangeStart?: string;
  rangeEnd?: string;
}

interface CostEstimateInput {
  startDate: string;
  endDate: string;
  departmentId?: number;
}

interface CostEstimate {
  startDate: string;
  endDate: string;
  departmentId: number | null;
  plannedHours: number;
  plannedCost: number;
  actualHours: number;
  actualCost: number;
}

const HOURS_EXPR = `
  CASE
    WHEN s.end_time > s.start_time THEN TIMESTAMPDIFF(MINUTE, s.start_time, s.end_time) / 60
    ELSE (TIMESTAMPDIFF(MINUTE, s.start_time, '24:00:00') + TIMESTAMPDIFF(MINUTE, '00:00:00', s.end_time)) / 60
  END
`;

const mapRow = (row: RowDataPacket): AttendanceRecord => ({
  id: row.id as number,
  userId: row.user_id as number,
  shiftAssignmentId: (row.shift_assignment_id as number | null) ?? null,
  clockIn: row.clock_in as string,
  clockOut: (row.clock_out as string | null) ?? null,
  status: row.status as AttendanceStatus,
  reviewerId: (row.reviewer_id as number | null) ?? null,
  reviewedAt: (row.reviewed_at as string | null) ?? null,
  reviewNotes: (row.review_notes as string | null) ?? null,
  notes: (row.notes as string | null) ?? null,
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
});

export class AttendanceService {
  private audit: AuditLogService;
  constructor(private pool: Pool) {
    this.audit = new AuditLogService(pool);
  }

  async getById(id: number): Promise<AttendanceRecord | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM attendance_records WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows.length === 0 ? null : mapRow(rows[0]);
  }

  /** Best-effort link to today's shift assignment, only when unambiguous. */
  private async findTodaysAssignment(userId: number): Promise<number | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT sa.id
         FROM shift_assignments sa
         JOIN shifts s ON s.id = sa.shift_id
        WHERE sa.user_id = ? AND s.date = CURDATE()
          AND sa.status IN ('pending', 'confirmed')`,
      [userId]
    );
    return rows.length === 1 ? (rows[0].id as number) : null;
  }

  async clockIn(userId: number, notes: string | null = null): Promise<AttendanceRecord> {
    const [open] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id FROM attendance_records WHERE user_id = ? AND clock_out IS NULL LIMIT 1`,
      [userId]
    );
    if (open.length > 0) {
      throw new ConflictError('An open attendance record already exists for this user');
    }

    const shiftAssignmentId = await this.findTodaysAssignment(userId);
    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO attendance_records (user_id, shift_assignment_id, clock_in, notes, status)
       VALUES (?, ?, CURRENT_TIMESTAMP, ?, 'pending')`,
      [userId, shiftAssignmentId, notes]
    );
    const created = await this.getById(result.insertId);
    if (!created) throw new Error('Failed to retrieve created attendance record');
    logger.info(`Attendance clock-in: id=${created.id} user=${userId}`);
    await this.audit.write({
      actorId: userId,
      action: 'attendance.clock_in',
      entityType: 'attendance_record',
      entityId: created.id,
      description: 'Clocked in',
      after: { id: created.id, clockIn: created.clockIn, shiftAssignmentId: created.shiftAssignmentId },
    });
    return created;
  }

  async clockOut(userId: number, id: number, notes: string | null = null): Promise<AttendanceRecord> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE attendance_records
          SET clock_out = CURRENT_TIMESTAMP,
              notes = COALESCE(?, notes)
        WHERE id = ? AND user_id = ? AND clock_out IS NULL`,
      [notes, id, userId]
    );
    if (result.affectedRows === 0) {
      const existing = await this.getById(id);
      if (!existing) throw new NotFoundError('Attendance record not found');
      if (existing.userId !== userId) throw new ForbiddenError('Forbidden');
      throw new ConflictError('Attendance record is already clocked out');
    }
    const refreshed = await this.getById(id);
    if (!refreshed) throw new Error('Failed to retrieve clocked-out record');
    logger.info(`Attendance clock-out: id=${id} user=${userId}`);
    await this.audit.write({
      actorId: userId,
      action: 'attendance.clock_out',
      entityType: 'attendance_record',
      entityId: id,
      description: 'Clocked out',
      after: { clockOut: refreshed.clockOut },
    });
    return refreshed;
  }

  async list(filters: ListAttendanceFilters = {}): Promise<AttendanceRecord[]> {
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
      conditions.push('DATE(clock_in) BETWEEN ? AND ?');
      params.push(filters.rangeStart, filters.rangeEnd);
    }

    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM attendance_records${where} ORDER BY clock_in DESC LIMIT 500`,
      params
    );
    return rows.map(mapRow);
  }

  async approve(id: number, reviewerId: number, notes: string | null = null): Promise<AttendanceRecord> {
    // Separation of duties: a reviewer with attendance.approve still cannot
    // approve their own clock-in/out, so hours can't be self-certified.
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE attendance_records
          SET status = 'approved',
              reviewer_id = ?,
              reviewed_at = CURRENT_TIMESTAMP,
              review_notes = ?
        WHERE id = ? AND status = 'pending' AND clock_out IS NOT NULL AND user_id != ?`,
      [reviewerId, notes, id, reviewerId]
    );
    if (result.affectedRows === 0) {
      const existing = await this.getById(id);
      if (!existing) throw new NotFoundError('Attendance record not found');
      if (existing.userId === reviewerId) throw new ForbiddenError('Forbidden: cannot approve your own attendance record');
      if (existing.clockOut === null) throw new ConflictError('Cannot approve a record that is still clocked in');
      throw new ConflictError(`Cannot approve record in status '${existing.status}'`);
    }
    logger.info(`Attendance record approved: id=${id} reviewer=${reviewerId}`);
    const refreshed = await this.getById(id);
    if (!refreshed) throw new Error('Failed to retrieve approved record');
    await this.audit.write({
      actorId: reviewerId,
      action: 'attendance.approve',
      entityType: 'attendance_record',
      entityId: id,
      description: 'Attendance record approved',
      justification: notes ?? null,
      after: { status: 'approved', reviewerId },
    });
    return refreshed;
  }

  async reject(id: number, reviewerId: number, notes: string | null = null): Promise<AttendanceRecord> {
    // Same separation-of-duties rule as approve(): no self-review.
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE attendance_records
          SET status = 'rejected',
              reviewer_id = ?,
              reviewed_at = CURRENT_TIMESTAMP,
              review_notes = ?
        WHERE id = ? AND status = 'pending' AND user_id != ?`,
      [reviewerId, notes, id, reviewerId]
    );
    if (result.affectedRows === 0) {
      const existing = await this.getById(id);
      if (!existing) throw new NotFoundError('Attendance record not found');
      if (existing.userId === reviewerId) throw new ForbiddenError('Forbidden: cannot reject your own attendance record');
      throw new ConflictError(`Cannot reject record in status '${existing.status}'`);
    }
    logger.info(`Attendance record rejected: id=${id} reviewer=${reviewerId}`);
    const refreshed = await this.getById(id);
    if (!refreshed) throw new Error('Failed to retrieve rejected record');
    await this.audit.write({
      actorId: reviewerId,
      action: 'attendance.reject',
      entityType: 'attendance_record',
      entityId: id,
      description: 'Attendance record rejected',
      justification: notes ?? null,
      after: { status: 'rejected', reviewerId },
    });
    return refreshed;
  }

  /**
   * Planned cost (from the schedule, same computation as
   * `ReportsService.costByDepartment`) versus actual cost (from approved
   * attendance punches), both priced at `users.hourly_rate`.
   */
  async getCostEstimate(input: CostEstimateInput): Promise<CostEstimate> {
    const deptCondition = input.departmentId !== undefined ? 'AND s.department_id = ?' : '';
    const plannedParams: Array<string | number> = [input.startDate, input.endDate];
    if (input.departmentId !== undefined) plannedParams.push(input.departmentId);

    const [plannedRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(${HOURS_EXPR}), 0) AS hours,
              COALESCE(SUM(${HOURS_EXPR} * COALESCE(u.hourly_rate, 0)), 0) AS cost
         FROM shift_assignments sa
         JOIN shifts s ON s.id = sa.shift_id
         JOIN users u ON u.id = sa.user_id
        WHERE s.date BETWEEN ? AND ?
          AND sa.status IN ('pending', 'confirmed', 'completed')
          ${deptCondition}`,
      plannedParams
    );

    const actualDeptCondition =
      input.departmentId !== undefined
        ? 'AND EXISTS (SELECT 1 FROM shift_assignments sa2 JOIN shifts s2 ON s2.id = sa2.shift_id WHERE sa2.id = ar.shift_assignment_id AND s2.department_id = ?)'
        : '';
    const actualParams: Array<string | number> = [input.startDate, input.endDate];
    if (input.departmentId !== undefined) actualParams.push(input.departmentId);

    const [actualRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(TIMESTAMPDIFF(MINUTE, ar.clock_in, ar.clock_out) / 60), 0) AS hours,
              COALESCE(SUM(TIMESTAMPDIFF(MINUTE, ar.clock_in, ar.clock_out) / 60 * COALESCE(u.hourly_rate, 0)), 0) AS cost
         FROM attendance_records ar
         JOIN users u ON u.id = ar.user_id
        WHERE ar.status = 'approved'
          AND ar.clock_out IS NOT NULL
          AND DATE(ar.clock_in) BETWEEN ? AND ?
          ${actualDeptCondition}`,
      actualParams
    );

    return {
      startDate: input.startDate,
      endDate: input.endDate,
      departmentId: input.departmentId ?? null,
      plannedHours: Number(plannedRows[0].hours) || 0,
      plannedCost: Number(plannedRows[0].cost) || 0,
      actualHours: Number(actualRows[0].hours) || 0,
      actualCost: Number(actualRows[0].cost) || 0,
    };
  }
}
