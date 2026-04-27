/**
 * Auto-schedule orchestrator (F09).
 *
 * Glues the optimization engine to the database. Steps:
 *
 *   1. Load the schedule and the open/empty shifts inside it.
 *   2. Load active users in the schedule's department, with their skills
 *      and unavailability blocks.
 *   3. Build an OptimizationProblem, call ScheduleOptimizer.
 *   4. Persist resulting assignments inside a single transaction.
 *
 * Today we use the greedy fallback (no Python required); the OR-Tools
 * path is opt-in via OPTIMIZATION_ENGINE=or-tools.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket } from 'mysql2/promise';
import { ScheduleOptimizer } from '../optimization/ScheduleOptimizerORTools';
import { logger } from '../config/logger';

interface AutoScheduleResult {
  scheduleId: number;
  assignmentsCreated: number;
  totalShifts: number;
  coveragePercentage: number;
  status: string;
}

const formatDate = (raw: unknown): string =>
  typeof raw === 'string' ? raw : new Date(raw as Date).toISOString().slice(0, 10);

export class AutoScheduleService {
  constructor(private pool: Pool) {}

  async generate(scheduleId: number, createdBy: number): Promise<AutoScheduleResult> {
    // 1. Schedule and its shifts.
    const [schedRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id, department_id, start_date, end_date FROM schedules WHERE id = ? LIMIT 1`,
      [scheduleId]
    );
    if (schedRows.length === 0) throw new Error('Schedule not found');
    const schedule = schedRows[0];

    const [shiftRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT s.id, s.date, s.start_time, s.end_time, s.min_staff, s.max_staff,
              s.department_id,
              GROUP_CONCAT(DISTINCT sk.name) AS skill_names
         FROM shifts s
         LEFT JOIN shift_skills ss ON s.id = ss.shift_id
         LEFT JOIN skills sk ON ss.skill_id = sk.id
        WHERE s.schedule_id = ?
        GROUP BY s.id`,
      [scheduleId]
    );
    if (shiftRows.length === 0) {
      return {
        scheduleId,
        assignmentsCreated: 0,
        totalShifts: 0,
        coveragePercentage: 0,
        status: 'EMPTY',
      };
    }

    // 2. Employees in the department.
    const [empRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT u.id,
              GROUP_CONCAT(DISTINCT sk.name) AS skill_names,
              COALESCE(up.max_hours_per_week, 40) AS max_hours_per_week,
              COALESCE(up.min_hours_per_week, 0)  AS min_hours_per_week,
              COALESCE(up.max_consecutive_days, 5) AS max_consecutive_days
         FROM users u
         JOIN user_departments ud ON u.id = ud.user_id
         LEFT JOIN user_skills us ON u.id = us.user_id
         LEFT JOIN skills sk ON us.skill_id = sk.id
         LEFT JOIN user_preferences up ON up.user_id = u.id
        WHERE ud.department_id = ? AND u.is_active = 1
        GROUP BY u.id`,
      [schedule.department_id]
    );

    const [unavailRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT user_id, start_date, end_date FROM user_unavailability WHERE user_id IN (
         SELECT user_id FROM user_departments WHERE department_id = ?
       )`,
      [schedule.department_id]
    );
    const unavailableByUser = new Map<number, string[]>();
    for (const row of unavailRows) {
      const dates: string[] = [];
      const start = new Date(row.start_date as Date);
      const end = new Date(row.end_date as Date);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        dates.push(d.toISOString().slice(0, 10));
      }
      const userId = row.user_id as number;
      const existing = unavailableByUser.get(userId) || [];
      unavailableByUser.set(userId, [...existing, ...dates]);
    }

    // 3. Build problem and run greedy.
    const optimizer = new ScheduleOptimizer();
    const problem = {
      shifts: shiftRows.map((s) => ({
        id: String(s.id),
        date: formatDate(s.date),
        start_time: s.start_time as string,
        end_time: s.end_time as string,
        min_staff: s.min_staff as number,
        max_staff: s.max_staff as number,
        required_skills: (s.skill_names as string | null)?.split(',').filter(Boolean) ?? [],
        priority: 1,
      })),
      employees: empRows.map((e) => ({
        id: String(e.id),
        max_hours_per_week: e.max_hours_per_week as number,
        min_hours_per_week: e.min_hours_per_week as number,
        max_consecutive_days: e.max_consecutive_days as number,
        skills: (e.skill_names as string | null)?.split(',').filter(Boolean) ?? [],
        unavailable_dates: unavailableByUser.get(e.id as number) ?? [],
      })),
      preferences: [],
      constraints: {
        max_hours_per_week: 40,
        max_consecutive_days: 5,
        min_hours_between_shifts: 8,
      },
    };

    const assignments = await optimizer.generateGreedySchedule(problem as never);

    // 4. Persist assignments.
    const conn = await this.pool.getConnection();
    let inserted = 0;
    try {
      await conn.beginTransaction();
      for (const a of assignments) {
        await conn.execute(
          `INSERT IGNORE INTO shift_assignments (shift_id, user_id, status, assigned_by)
           VALUES (?, ?, 'pending', ?)`,
          [Number(a.shiftId), Number(a.employeeId), createdBy]
        );
        inserted++;
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    const totalShifts = shiftRows.length;
    const coverage =
      totalShifts > 0 ? Math.min(100, Math.round((inserted / totalShifts) * 100)) : 0;
    logger.info(
      `Auto-schedule done for schedule=${scheduleId}: ${inserted}/${totalShifts} (${coverage}%)`
    );
    return {
      scheduleId,
      assignmentsCreated: inserted,
      totalShifts,
      coveragePercentage: coverage,
      status: 'OK',
    };
  }
}
