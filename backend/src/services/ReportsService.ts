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

interface HoursWorkedRow {
  userId: number;
  fullName: string;
  hours: number;
}

interface CostByDepartmentRow {
  departmentId: number;
  departmentName: string;
  hours: number;
  cost: number;
}

interface FairnessReport {
  scheduleId: number;
  perUser: HoursWorkedRow[];
  stats: { count: number; min: number; max: number; mean: number; stddev: number };
}

const HOURS_EXPR = `
  CASE
    WHEN s.end_time > s.start_time THEN TIMESTAMPDIFF(MINUTE, s.start_time, s.end_time) / 60
    ELSE (TIMESTAMPDIFF(MINUTE, s.start_time, '24:00:00') + TIMESTAMPDIFF(MINUTE, '00:00:00', s.end_time)) / 60
  END
`;

export class ReportsService {
  constructor(private pool: Pool) {}

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
    const [rows] = await this.pool.execute<RowDataPacket[]>(
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
    const [rows] = await this.pool.execute<RowDataPacket[]>(
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
    const [rows] = await this.pool.execute<RowDataPacket[]>(
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
}
