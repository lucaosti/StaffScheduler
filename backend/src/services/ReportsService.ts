/**
 * Reports module (F08).
 *
 * Three primitives that the UI builds dashboards on top of:
 *   - hoursWorkedByUser: pending+confirmed hours per user in a window,
 *     optionally scoped to a department.
 *   - costByDepartment: hours × hourly_rate aggregated per department.
 *   - fairnessForSchedule: distribution metrics (min, max, mean, stddev)
 *     of hours per assigned user inside a single schedule, plus the raw
 *     per-user breakdown.
 *
 * Hours are computed from start_time/end_time accounting for overnight
 * wrap (end <= start means the shift crosses midnight).
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket } from 'mysql2/promise';
import { SHIFT_HOURS_SQL } from '../utils/sql';

export interface HoursWorkedRow {
  userId: number;
  fullName: string;
  hours: number;
}

export interface CostByDepartmentRow {
  departmentId: number;
  departmentName: string;
  hours: number;
  cost: number;
}

export interface FairnessReport {
  scheduleId: number;
  perUser: HoursWorkedRow[];
  stats: { count: number; min: number; max: number; mean: number; stddev: number };
}

/** One rule code's violation count on one day, within a requested range. */
export interface ComplianceViolationTrendRow {
  date: string;
  code: string;
  count: number;
}

/**
 * Shift duration in hours. Was a local CASE expression that split an overnight
 * shift into "until midnight" plus "after midnight"; identical in result to
 * SHIFT_HOURS_SQL, but a second spelling of the same rule. The two dashboard
 * aggregates had a THIRD spelling which got it wrong — same-date TIMESTAMPDIFF,
 * yielding negative hours for a night shift — so the definitions are now one.
 */
const HOURS_EXPR = SHIFT_HOURS_SQL;

export class ReportsService {
  // Entirely read-only, so it takes a single pool — the caller passes the
  // read pool (a replica when #323 configures one, otherwise the same pool
  // as always; see config/database.ts's createReadPool).
  constructor(private readPool: Pool) {}

  async hoursWorkedByUser(
    rangeStart: string,
    rangeEnd: string,
    departmentId?: number
  ): Promise<HoursWorkedRow[]> {
    const conditions: string[] = [
      'sa.status IN (\'pending\', \'confirmed\', \'completed\')',
      's.date BETWEEN ? AND ?',
    ];
    const params: Array<string | number> = [rangeStart, rangeEnd];
    if (departmentId !== undefined) {
      conditions.push('s.department_id = ?');
      params.push(departmentId);
    }
    const [rows] = await this.readPool.execute<RowDataPacket[]>(
      `SELECT u.id AS user_id,
              CONCAT(u.first_name, ' ', u.last_name) AS full_name,
              COALESCE(SUM(${HOURS_EXPR}), 0) AS hours
         FROM users u
         JOIN shift_assignments sa ON sa.user_id = u.id
         JOIN shifts s ON sa.shift_id = s.id
        WHERE ${conditions.join(' AND ')}
        GROUP BY u.id, full_name
        ORDER BY hours DESC`,
      params
    );
    return rows.map((r: any) => ({
      userId: r.user_id,
      fullName: r.full_name,
      hours: Number(r.hours) || 0,
    }));
  }

  async costByDepartment(
    rangeStart: string,
    rangeEnd: string
  ): Promise<CostByDepartmentRow[]> {
    const [rows] = await this.readPool.execute<RowDataPacket[]>(
      `SELECT d.id AS department_id, d.name AS department_name,
              COALESCE(SUM(${HOURS_EXPR}), 0) AS hours,
              COALESCE(SUM(${HOURS_EXPR} * COALESCE(u.hourly_rate, 0)), 0) AS cost
         FROM departments d
         LEFT JOIN shifts s ON s.department_id = d.id AND s.date BETWEEN ? AND ?
         LEFT JOIN shift_assignments sa ON sa.shift_id = s.id
              AND sa.status IN ('pending', 'confirmed', 'completed')
         LEFT JOIN users u ON sa.user_id = u.id
        GROUP BY d.id, d.name
        ORDER BY cost DESC`,
      [rangeStart, rangeEnd]
    );
    return rows.map((r: any) => ({
      departmentId: r.department_id,
      departmentName: r.department_name,
      hours: Number(r.hours) || 0,
      cost: Number(r.cost) || 0,
    }));
  }

  async fairnessForSchedule(scheduleId: number): Promise<FairnessReport> {
    const [rows] = await this.readPool.execute<RowDataPacket[]>(
      `SELECT u.id AS user_id,
              CONCAT(u.first_name, ' ', u.last_name) AS full_name,
              SUM(${HOURS_EXPR}) AS hours
         FROM users u
         JOIN shift_assignments sa ON sa.user_id = u.id
         JOIN shifts s ON sa.shift_id = s.id
        WHERE s.schedule_id = ?
          AND sa.status IN ('pending', 'confirmed', 'completed')
        GROUP BY u.id, full_name
        ORDER BY hours DESC`,
      [scheduleId]
    );
    const perUser = rows.map((r: any) => ({
      userId: r.user_id,
      fullName: r.full_name,
      hours: Number(r.hours) || 0,
    }));

    const hours = perUser.map((r) => r.hours);
    const count = hours.length;
    if (count === 0) {
      return { scheduleId, perUser, stats: { count: 0, min: 0, max: 0, mean: 0, stddev: 0 } };
    }
    const min = Math.min(...hours);
    const max = Math.max(...hours);
    const mean = hours.reduce((acc, h) => acc + h, 0) / count;
    const variance = hours.reduce((acc, h) => acc + (h - mean) ** 2, 0) / count;
    const stddev = Math.sqrt(variance);

    return { scheduleId, perUser, stats: { count, min, max, mean, stddev } };
  }

  /**
   * Compliance violations detected in a range, grouped by day and rule code.
   *
   * The granularity is deliberately day + code, not a single running total:
   * a planner reading a trend needs to see WHICH rule is recurring and WHEN,
   * not just that violations happened. `detected_at` is a TIMESTAMP; `DATE()`
   * buckets it to a calendar day in whatever timezone the connection uses
   * (UTC, per this codebase's convention).
   */
  async complianceViolationsTrend(
    rangeStart: string,
    rangeEnd: string
  ): Promise<ComplianceViolationTrendRow[]> {
    const [rows] = await this.readPool.execute<RowDataPacket[]>(
      `SELECT DATE(detected_at) AS date, code, COUNT(*) AS count
         FROM compliance_violations
        WHERE detected_at >= ? AND detected_at < DATE_ADD(?, INTERVAL 1 DAY)
        GROUP BY DATE(detected_at), code
        ORDER BY date ASC, code ASC`,
      [rangeStart, rangeEnd]
    );
    return rows.map((r: any) => ({
      date: typeof r.date === 'string' ? r.date : new Date(r.date).toISOString().slice(0, 10),
      code: r.code,
      count: Number(r.count) || 0,
    }));
  }
}
