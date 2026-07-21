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
 * Engine selection (OPTIMIZATION_ENGINE):
 *   - 'or-tools' (DEFAULT): route through the Python OR-Tools CP-SAT solver —
 *     the most optimal engine. If Python is unavailable or times out it still
 *     produces a schedule via the greedy solver, but that fallback is never
 *     silent: the result reports engine='greedy' with degraded=true and a
 *     reason, and a warning is logged. The optimum is always attempted first.
 *   - 'greedy' (a.k.a. legacy 'javascript'): explicit DRAFT mode — the fast
 *     best-effort greedy pass, chosen deliberately. Reports engine='greedy'
 *     with degraded=false so callers can tell an intentional draft from a
 *     degraded fallback.
 *
 * Because both engines are held to one shared constraint definition (see
 * optimization/constraintValidator.ts and the optimizer.parity.test.ts suite),
 * either engine's output respects the same hard rules; they differ only in how
 * close to optimal the coverage/fairness is.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket } from 'mysql2/promise';
import { NotFoundError } from '../errors';
import { ScheduleOptimizer } from '../optimization/ScheduleOptimizerORTools';
import { logger } from '../config/logger';
import { DateUtils } from '../utils';
import { config } from '../config';

interface AutoScheduleResult {
  scheduleId: number;
  assignmentsCreated: number;
  totalShifts: number;
  coveragePercentage: number;
  status: string;
  /** The engine that actually produced this schedule. */
  engine: 'or-tools' | 'greedy';
  /**
   * True when the optimal engine (or-tools) was requested but the run fell back
   * to greedy (Python unavailable/timed out, or the solver errored). Always
   * false for an intentionally-selected greedy draft. Lets the UI flag "this is
   * a draft, not the optimum" clearly rather than silently.
   */
  degraded: boolean;
  /** Why the run degraded, when it did (for logs and the UI banner). */
  degradedReason?: string;
}

const formatDate = (raw: unknown): string =>
  typeof raw === 'string' ? raw : DateUtils.fromMySQLDate(raw as Date);

export class AutoScheduleService {
  constructor(private pool: Pool) {}

  async generate(scheduleId: number, createdBy: number): Promise<AutoScheduleResult> {
    // 1. Schedule and its shifts.
    const [schedRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id, department_id, start_date, end_date FROM schedules WHERE id = ? LIMIT 1`,
      [scheduleId]
    );
    if (schedRows.length === 0) throw new NotFoundError('Schedule not found');
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
        engine: config.optimization.engine === 'or-tools' ? 'or-tools' : 'greedy',
        degraded: false,
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
        dates.push(DateUtils.fromMySQLDate(d));
      }
      const userId = row.user_id as number;
      const existing = unavailableByUser.get(userId) || [];
      unavailableByUser.set(userId, [...existing, ...dates]);
    }

    // Assignments this employee already holds on *other* schedules, within
    // reach of this one's rolling-window checks (±14 days, matching
    // ComplianceEngine.evaluateAssignmentCompliance's own lookback/lookahead).
    // Without this, back-to-back schedule periods are optimized in total
    // isolation from each other — each can look individually compliant while
    // an employee assigned late in period N and early in period N+1 quietly
    // busts max-consecutive-days/max-weekly-hours across the boundary.
    const [externalRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT sa.user_id, s.date, s.start_time, s.end_time
         FROM shift_assignments sa
         JOIN shifts s ON s.id = sa.shift_id
        WHERE s.schedule_id != ?
          AND sa.status IN ('pending', 'confirmed')
          AND sa.user_id IN (SELECT user_id FROM user_departments WHERE department_id = ?)
          AND s.date BETWEEN DATE_SUB(?, INTERVAL 14 DAY) AND DATE_ADD(?, INTERVAL 14 DAY)`,
      [scheduleId, schedule.department_id, schedule.start_date, schedule.end_date]
    );
    const externalAssignmentsByUser = new Map<number, Array<{ date: string; start_time: string; end_time: string }>>();
    for (const row of externalRows) {
      const userId = row.user_id as number;
      const list = externalAssignmentsByUser.get(userId) ?? [];
      list.push({ date: formatDate(row.date), start_time: row.start_time as string, end_time: row.end_time as string });
      externalAssignmentsByUser.set(userId, list);
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
        existing_assignments: externalAssignmentsByUser.get(e.id as number) ?? [],
      })),
      preferences: [],
      constraints: {
        max_hours_per_week: 40,
        max_consecutive_days: 5,
        min_hours_between_shifts: 8,
      },
    };

    // Engine selection. Default 'or-tools' attempts the optimum first; any
    // fall back to greedy is surfaced (engine/degraded), never silent. An
    // explicit 'greedy'/'javascript' selection is an intentional draft and
    // skips the child-process round-trip entirely.
    let engine: 'or-tools' | 'greedy';
    let degraded = false;
    let degradedReason: string | undefined;
    let assignments;

    if (config.optimization.engine === 'or-tools') {
      const result = await optimizer.optimize(problem as never);
      assignments = result.assignments;
      if (result.status === 'GREEDY_FALLBACK' || result.status === 'ERROR') {
        // optimize() already ran the greedy fallback internally; make that
        // visible instead of pretending or-tools produced the schedule.
        engine = 'greedy';
        degraded = true;
        degradedReason =
          result.error ?? 'OR-Tools solver was unavailable; used the greedy fallback';
        logger.warn(
          `Optimization for schedule=${scheduleId} requested or-tools but degraded to greedy: ${degradedReason}`
        );
      } else {
        engine = 'or-tools';
      }
    } else {
      // Explicit draft mode — greedy chosen on purpose, not a degradation.
      assignments = await optimizer.generateGreedySchedule(problem as never);
      engine = 'greedy';
      logger.info(`Optimization for schedule=${scheduleId} using greedy draft engine (explicit)`);
    }

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
      engine,
      degraded,
      degradedReason,
    };
  }
}
