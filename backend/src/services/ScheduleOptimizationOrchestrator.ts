import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { Schedule } from '../types';
import { logger } from '../config/logger';

export class ScheduleOptimizationOrchestrator {
  constructor(private pool: Pool) {}

  private async fetchScheduleById(id: number): Promise<Schedule | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT
        s.id, s.name, s.department_id, s.start_date, s.end_date,
        s.status, s.published_at, s.notes, s.created_at, s.updated_at,
        d.name as department_name,
        COUNT(DISTINCT sh.id) as total_shifts,
        COUNT(DISTINCT sa.id) as total_assignments
      FROM schedules s
      LEFT JOIN departments d ON s.department_id = d.id
      LEFT JOIN shifts sh ON s.id = sh.schedule_id
      LEFT JOIN shift_assignments sa ON sh.id = sa.shift_id AND sa.status IN ('pending', 'confirmed')
      WHERE s.id = ?
      GROUP BY s.id`,
      [id]
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      id: row.id,
      name: row.name,
      departmentId: row.department_id,
      departmentName: row.department_name,
      startDate: row.start_date,
      endDate: row.end_date,
      status: row.status,
      publishedAt: row.published_at,
      totalShifts: row.total_shifts || 0,
      totalAssignments: row.total_assignments || 0,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async getScheduleStatistics(id: number): Promise<{
    totalShifts: number;
    totalAssignments: number;
    fullyStaffedShifts: number;
    understaffedShifts: number;
    overstaffedShifts: number;
    emptyShifts: number;
    totalStaffNeeded: number;
    totalStaffAssigned: number;
    coveragePercentage: number;
  }> {
    try {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT
          COUNT(DISTINCT s.id) as total_shifts,
          COALESCE(SUM(s.min_staff), 0) as total_staff_needed,
          COUNT(DISTINCT sa.id) as total_assignments,
          SUM(CASE WHEN assigned_count >= s.min_staff THEN 1 ELSE 0 END) as fully_staffed,
          SUM(CASE WHEN assigned_count < s.min_staff AND assigned_count > 0 THEN 1 ELSE 0 END) as understaffed,
          SUM(CASE WHEN assigned_count > s.max_staff THEN 1 ELSE 0 END) as overstaffed,
          SUM(CASE WHEN assigned_count = 0 THEN 1 ELSE 0 END) as empty_shifts
        FROM shifts s
        LEFT JOIN shift_assignments sa ON s.id = sa.shift_id AND sa.status IN ('pending', 'confirmed')
        LEFT JOIN (
          SELECT shift_id, COUNT(*) as assigned_count
          FROM shift_assignments
          WHERE status IN ('pending', 'confirmed')
          GROUP BY shift_id
        ) ac ON s.id = ac.shift_id
        WHERE s.schedule_id = ?`,
        [id]
      );
      const stats = rows[0];
      const totalStaffNeeded = stats.total_staff_needed || 0;
      const totalAssignments = stats.total_assignments || 0;
      return {
        totalShifts: stats.total_shifts || 0,
        totalAssignments,
        fullyStaffedShifts: stats.fully_staffed || 0,
        understaffedShifts: stats.understaffed || 0,
        overstaffedShifts: stats.overstaffed || 0,
        emptyShifts: stats.empty_shifts || 0,
        totalStaffNeeded,
        totalStaffAssigned: totalAssignments,
        coveragePercentage: totalStaffNeeded > 0 ? Math.round((totalAssignments / totalStaffNeeded) * 100) : 0
      };
    } catch (error) {
      logger.error('Failed to get schedule statistics:', error);
      throw error;
    }
  }

  async getScheduleShifts(scheduleId: number): Promise<any[]> {
    try {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT
          s.id, s.date, s.start_time, s.end_time, s.min_staff, s.max_staff, s.status,
          s.department_id, d.name as department_name,
          COUNT(DISTINCT sa.id) as assigned_staff
        FROM shifts s
        LEFT JOIN departments d ON s.department_id = d.id
        LEFT JOIN shift_assignments sa ON s.id = sa.shift_id AND sa.status IN ('pending', 'confirmed')
        WHERE s.schedule_id = ?
        GROUP BY s.id
        ORDER BY s.date ASC, s.start_time ASC`,
        [scheduleId]
      );
      return rows.map((row: any) => ({
        id: row.id,
        date: row.date,
        startTime: row.start_time,
        endTime: row.end_time,
        minStaff: row.min_staff,
        maxStaff: row.max_staff,
        assignedStaff: row.assigned_staff || 0,
        status: row.status,
        departmentId: row.department_id,
        departmentName: row.department_name
      }));
    } catch (error) {
      logger.error('Failed to get schedule shifts:', error);
      throw error;
    }
  }

  async getSchedulesByUser(userId: number): Promise<Schedule[]> {
    try {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT
          s.id, s.name, s.department_id, s.start_date, s.end_date,
          s.status, s.published_at, s.notes, s.created_at, s.updated_at,
          d.name as department_name,
          COUNT(DISTINCT sh2.id) as total_shifts,
          COUNT(DISTINCT sa2.id) as total_assignments
        FROM schedules s
        LEFT JOIN departments d ON s.department_id = d.id
        LEFT JOIN shifts sh2 ON s.id = sh2.schedule_id
        LEFT JOIN shift_assignments sa2 ON sh2.id = sa2.shift_id AND sa2.status IN ('pending', 'confirmed')
        WHERE s.id IN (
          SELECT DISTINCT sh.schedule_id
          FROM shifts sh
          JOIN shift_assignments sa ON sh.id = sa.shift_id
          WHERE sa.user_id = ?
        )
        GROUP BY s.id
        ORDER BY s.start_date DESC`,
        [userId]
      );
      return rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        departmentId: row.department_id,
        departmentName: row.department_name,
        startDate: row.start_date,
        endDate: row.end_date,
        status: row.status,
        publishedAt: row.published_at,
        totalShifts: row.total_shifts || 0,
        totalAssignments: row.total_assignments || 0,
        notes: row.notes,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
    } catch (error) {
      logger.error('Failed to get schedules by user:', error);
      throw error;
    }
  }

  async getScheduleWithShifts(scheduleId: number): Promise<any> {
    try {
      const schedule = await this.fetchScheduleById(scheduleId);
      if (!schedule) return null;
      const shifts = await this.getScheduleShifts(scheduleId);
      return { ...schedule, shifts };
    } catch (error) {
      logger.error('Failed to get schedule with shifts:', error);
      throw error;
    }
  }

  async cloneSchedule(sourceScheduleId: number, newName: string, newStartDate: string, newEndDate: string): Promise<Schedule> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();

      const [sourceRows] = await connection.execute<RowDataPacket[]>(
        'SELECT * FROM schedules WHERE id = ? LIMIT 1',
        [sourceScheduleId]
      );
      if (sourceRows.length === 0) throw new Error('Source schedule not found');

      const source = sourceRows[0];
      const [scheduleResult] = await connection.execute<ResultSetHeader>(
        `INSERT INTO schedules (name, description, department_id, start_date, end_date, status, created_by, notes)
        VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`,
        [newName, null, source.department_id, newStartDate, newEndDate, source.created_by, `Cloned from ${source.name}`]
      );

      const newScheduleId = scheduleResult.insertId;
      const dayOffset = Math.floor(
        (new Date(newStartDate).getTime() - new Date(source.start_date).getTime()) / 86400000
      );

      const [shifts] = await connection.execute<RowDataPacket[]>(
        'SELECT * FROM shifts WHERE schedule_id = ?',
        [sourceScheduleId]
      );

      // Build old->new shift ID map and insert all shifts.
      const oldToNewShiftId = new Map<number, number>();
      for (const shift of shifts) {
        const shiftDate = new Date(shift.date);
        shiftDate.setDate(shiftDate.getDate() + dayOffset);
        const [shiftResult] = await connection.execute<ResultSetHeader>(
          `INSERT INTO shifts (schedule_id, department_id, template_id, date, start_time, end_time, min_staff, max_staff, notes, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
          [newScheduleId, shift.department_id, shift.template_id, shiftDate.toISOString().split('T')[0], shift.start_time, shift.end_time, shift.min_staff, shift.max_staff, shift.notes]
        );
        oldToNewShiftId.set(shift.id as number, shiftResult.insertId);
      }

      // Bulk-fetch all skills for the original shifts, then bulk-insert for the clones.
      if (oldToNewShiftId.size > 0) {
        const oldIds = [...oldToNewShiftId.keys()];
        const placeholders = oldIds.map(() => '?').join(', ');
        const [allSkills] = await connection.execute<RowDataPacket[]>(
          `SELECT shift_id, skill_id FROM shift_skills WHERE shift_id IN (${placeholders})`,
          oldIds
        );
        if (allSkills.length > 0) {
          const skillValues = allSkills.map((s) => [oldToNewShiftId.get(s.shift_id as number), s.skill_id]);
          const skillPlaceholders = skillValues.map(() => '(?, ?)').join(', ');
          await connection.execute(
            `INSERT INTO shift_skills (shift_id, skill_id) VALUES ${skillPlaceholders}`,
            skillValues.flat()
          );
        }
      }

      await connection.commit();
      logger.info(`Schedule cloned: ${sourceScheduleId} -> ${newScheduleId}`);

      const cloned = await this.fetchScheduleById(newScheduleId);
      if (!cloned) throw new Error('Failed to retrieve cloned schedule');
      return cloned;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to clone schedule:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  async duplicateSchedule(scheduleId: number, newName: string, newStartDate: string, newEndDate: string): Promise<Schedule> {
    return this.cloneSchedule(scheduleId, newName, newStartDate, newEndDate);
  }

  async generateOptimizedSchedule(scheduleId: number, createdBy: number): Promise<{
    success: true;
    scheduleId: number;
    assignmentsCreated: number;
    totalShifts: number;
    coveragePercentage: number;
    status: string;
  }> {
    // Lazy require to avoid a circular dependency at module load.
    const { AutoScheduleService } = require('./AutoScheduleService');
    const auto = new AutoScheduleService(this.pool);
    const result = await auto.generate(scheduleId, createdBy);
    logger.info(`Auto-schedule completed for schedule ${scheduleId}: ${result.assignmentsCreated} assignments`);
    return { success: true, ...result };
  }
}
