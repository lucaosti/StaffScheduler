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
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { logger } from '../config/logger';
import { AuditLogService } from './AuditLogService';
import { GeofenceService } from './GeofenceService';
import type { GeoPoint } from '../utils/geo';
import { SHIFT_ABS_END_SQL } from '../utils/sql';

type AttendanceStatus = 'pending' | 'approved' | 'rejected';

interface AttendanceRecord {
  id: number;
  userId: number;
  shiftAssignmentId: number | null;
  clockIn: string;
  clockOut: string | null;
  latitude: number | null;
  longitude: number | null;
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

export type AttendanceAnomalyType =
  | 'late_clock_in'
  | 'missing_clock_out'
  | 'early_clock_out'
  | 'unmatched_punch';

/**
 * One flagged pattern on one punch. References the underlying record rather
 * than existing only as a computed dashboard figure, so a later
 * payroll-authorization step can act on the exact punch — reconcile it
 * against what was expected, or approve it for payment — instead of
 * re-deriving which record an aggregate number came from.
 */
export interface AttendanceAnomaly {
  attendanceRecordId: number;
  userId: number;
  type: AttendanceAnomalyType;
  /** Minutes past the configured grace threshold; null where a minute figure does not apply. */
  minutes: number | null;
  clockIn: string;
  clockOut: string | null;
}

interface AttendanceAnomalyThresholds {
  lateClockInGraceMinutes: number;
  earlyClockOutGraceMinutes: number;
}

/**
 * This system prefers configurable thresholds over hardcoded ones elsewhere
 * (contracts, policies, approval workflows), so a bare "10 minutes late" is
 * the wrong default to hardcode without an escape hatch — these are read from
 * `system_settings` (category `attendance`) with these as the fallback when
 * an organization has not set its own.
 */
const DEFAULT_ANOMALY_THRESHOLDS: AttendanceAnomalyThresholds = {
  lateClockInGraceMinutes: 10,
  earlyClockOutGraceMinutes: 10,
};

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
  latitude: row.latitude != null ? Number(row.latitude) : null,
  longitude: row.longitude != null ? Number(row.longitude) : null,
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
  private geofence: GeofenceService;
  constructor(private pool: Pool) {
    this.audit = new AuditLogService(pool);
    this.geofence = new GeofenceService(pool);
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

  async clockIn(userId: number, notes: string | null = null, location: GeoPoint | null = null): Promise<AttendanceRecord> {
    const [open] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id FROM attendance_records WHERE user_id = ? AND clock_out IS NULL LIMIT 1`,
      [userId]
    );
    if (open.length > 0) {
      throw new ConflictError('An open attendance record already exists for this user');
    }

    // Enforcement is per-caller: `required` is false (and this is a no-op)
    // unless at least one of the caller's departments has an active fence —
    // see GeofenceService.isCallerWithinAllowedGeofence.
    const geoCheck = await this.geofence.isCallerWithinAllowedGeofence(userId, location);
    if (geoCheck.required && !geoCheck.allowed) {
      await this.audit.write({
        actorId: userId,
        action: 'attendance.clock_in_rejected_geofence',
        entityType: 'attendance_record',
        entityId: userId,
        description: location
          ? 'Clock-in rejected: outside every geofence configured for this user\'s departments'
          : 'Clock-in rejected: a geofence is configured but no location was provided',
        after: location ? { latitude: location.lat, longitude: location.lng } : {},
      });
      throw new ValidationError('Clock-in location is outside the allowed area for your department.');
    }

    const shiftAssignmentId = await this.findTodaysAssignment(userId);
    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO attendance_records (user_id, shift_assignment_id, clock_in, latitude, longitude, notes, status)
       VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?, 'pending')`,
      [userId, shiftAssignmentId, location?.lat ?? null, location?.lng ?? null, notes]
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

  /**
   * Clock in if the user has no open record, clock out if they do. Exists for
   * the kiosk flow (#309): a shared tablet identifies a person by employee id
   * and has no notion of "which button to show" the way a self-service caller
   * does from their own page state, so the toggle decision has to be made
   * server-side, atomically with the same query clockIn already runs to
   * detect this case.
   */
  async punch(userId: number): Promise<{ action: 'clocked_in' | 'clocked_out'; record: AttendanceRecord }> {
    const [open] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id FROM attendance_records WHERE user_id = ? AND clock_out IS NULL LIMIT 1`,
      [userId]
    );
    if (open.length > 0) {
      const record = await this.clockOut(userId, open[0].id as number);
      return { action: 'clocked_out', record };
    }
    const record = await this.clockIn(userId);
    return { action: 'clocked_in', record };
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

  private async resolveAnomalyThresholds(): Promise<AttendanceAnomalyThresholds> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT \`key\`, value FROM system_settings
        WHERE category = 'attendance'
          AND \`key\` IN ('late_clock_in_grace_minutes', 'early_clock_out_grace_minutes')`
    );
    const settings: Record<string, string> = {};
    for (const row of rows) settings[row.key as string] = row.value as string;
    return {
      lateClockInGraceMinutes:
        Number(settings.late_clock_in_grace_minutes) ||
        DEFAULT_ANOMALY_THRESHOLDS.lateClockInGraceMinutes,
      earlyClockOutGraceMinutes:
        Number(settings.early_clock_out_grace_minutes) ||
        DEFAULT_ANOMALY_THRESHOLDS.earlyClockOutGraceMinutes,
    };
  }

  /**
   * Flags every anomalous punch in a range: a late clock-in, a clock-out
   * still open well past the shift's end, an early clock-out, or a punch
   * with no matching assignment at all. All four in one pass, per the
   * product decision to record everything rather than guess which pattern
   * matters most before a reconciliation/authorization step exists to judge.
   *
   * Computed at query time, not persisted: nothing here is at risk of being
   * lost the way an unrecorded compliance violation was (see
   * `ComplianceEngine`'s `compliance_violations` table) — `attendance_records`
   * and `shifts` already hold everything an anomaly is derived from, so a
   * second table would only be a cache of a query, not a record of a fact
   * that would otherwise vanish.
   *
   * The arithmetic runs in SQL, not JavaScript: `TIMESTAMPDIFF` avoids ever
   * having to parse a MySQL DATETIME string back into a `Date` and guess its
   * timezone, the same reasoning `SHIFT_HOURS_SQL`/`SHIFT_ABS_END_SQL` exist
   * for elsewhere in this codebase.
   *
   * One row per anomaly, not per punch — the same "one row per broken rule"
   * shape `compliance_violations` uses, since a single punch can be both
   * late AND leave early.
   */
  async detectAnomalies(rangeStart: string, rangeEnd: string): Promise<AttendanceAnomaly[]> {
    const thresholds = await this.resolveAnomalyThresholds();

    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT ar.id, ar.user_id, ar.clock_in, ar.clock_out, ar.shift_assignment_id,
              TIMESTAMPDIFF(MINUTE, TIMESTAMP(s.date, s.start_time), ar.clock_in) AS late_minutes,
              CASE WHEN ar.clock_out IS NOT NULL
                   THEN TIMESTAMPDIFF(MINUTE, ar.clock_out, ${SHIFT_ABS_END_SQL})
                   ELSE NULL END AS early_minutes,
              CASE WHEN ar.clock_out IS NULL
                   THEN TIMESTAMPDIFF(MINUTE, ${SHIFT_ABS_END_SQL}, NOW())
                   ELSE NULL END AS overdue_minutes
         FROM attendance_records ar
         LEFT JOIN shift_assignments sa ON sa.id = ar.shift_assignment_id
         LEFT JOIN shifts s ON s.id = sa.shift_id
        WHERE DATE(ar.clock_in) BETWEEN ? AND ?`,
      [rangeStart, rangeEnd]
    );

    const anomalies: AttendanceAnomaly[] = [];
    for (const row of rows) {
      const attendanceRecordId = row.id as number;
      const userId = row.user_id as number;
      const clockIn = row.clock_in as string;
      const clockOut = (row.clock_out as string | null) ?? null;

      // No linked assignment at all — every other comparison needs one, so
      // this is the one anomaly type that stands alone rather than combining
      // with the others.
      if (row.shift_assignment_id == null) {
        anomalies.push({ attendanceRecordId, userId, type: 'unmatched_punch', minutes: null, clockIn, clockOut });
        continue;
      }

      const lateMinutes = row.late_minutes != null ? Number(row.late_minutes) : null;
      if (lateMinutes !== null && lateMinutes > thresholds.lateClockInGraceMinutes) {
        anomalies.push({ attendanceRecordId, userId, type: 'late_clock_in', minutes: lateMinutes, clockIn, clockOut });
      }

      if (clockOut === null) {
        const overdueMinutes = row.overdue_minutes != null ? Number(row.overdue_minutes) : null;
        if (overdueMinutes !== null && overdueMinutes > thresholds.earlyClockOutGraceMinutes) {
          anomalies.push({ attendanceRecordId, userId, type: 'missing_clock_out', minutes: null, clockIn, clockOut });
        }
        continue; // nothing to compare for "early" without a clock-out
      }

      const earlyMinutes = row.early_minutes != null ? Number(row.early_minutes) : null;
      if (earlyMinutes !== null && earlyMinutes > thresholds.earlyClockOutGraceMinutes) {
        anomalies.push({ attendanceRecordId, userId, type: 'early_clock_out', minutes: earlyMinutes, clockIn, clockOut });
      }
    }

    return anomalies;
  }
}
