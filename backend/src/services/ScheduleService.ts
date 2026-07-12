import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import {
  Schedule,
  CreateScheduleRequest,
  UpdateScheduleRequest
} from '../types';
import { logger } from '../config/logger';
import { AuditLogService } from './AuditLogService';
import { ScheduleOptimizationOrchestrator } from './ScheduleOptimizationOrchestrator';
import { NotificationService } from './NotificationService';

export class ScheduleService {
  private audit: AuditLogService;
  private orchestrator: ScheduleOptimizationOrchestrator;
  private notifications: NotificationService;

  constructor(private pool: Pool) {
    this.audit = new AuditLogService(pool);
    this.orchestrator = new ScheduleOptimizationOrchestrator(pool);
    this.notifications = new NotificationService(pool);
  }

  async createSchedule(scheduleData: CreateScheduleRequest): Promise<Schedule> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();

      if (!scheduleData.createdBy) throw new Error('createdBy is required');

      const startDate = new Date(scheduleData.startDate);
      const endDate = new Date(scheduleData.endDate);
      if (startDate >= endDate) throw new Error('End date must be after start date');

      const [deptRows] = await connection.execute<RowDataPacket[]>(
        'SELECT id FROM departments WHERE id = ? AND is_active = 1 LIMIT 1',
        [scheduleData.departmentId]
      );
      if (deptRows.length === 0) throw new Error('Department not found');

      // FOR UPDATE acquires gap locks under InnoDB REPEATABLE READ, preventing
      // concurrent INSERTs in the same date window from racing past this check.
      const [overlapRows] = await connection.execute<RowDataPacket[]>(
        `SELECT id FROM schedules
        WHERE department_id = ?
        AND status IN ('draft', 'published')
        AND start_date <= ? AND end_date >= ?
        LIMIT 1
        FOR UPDATE`,
        [scheduleData.departmentId, scheduleData.endDate, scheduleData.startDate]
      );
      if (overlapRows.length > 0) {
        throw new Error('A schedule already exists for this department in the specified date range');
      }

      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO schedules (name, description, department_id, start_date, end_date, status, created_by, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          scheduleData.name,
          null,
          scheduleData.departmentId,
          scheduleData.startDate,
          scheduleData.endDate,
          'draft',
          scheduleData.createdBy,
          scheduleData.notes || null
        ]
      );

      const scheduleId = result.insertId;
      await connection.commit();
      logger.info(`Schedule created successfully: ${scheduleId}`);

      const newSchedule = await this.getScheduleById(scheduleId);
      if (!newSchedule) throw new Error('Failed to retrieve created schedule');
      return newSchedule;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to create schedule:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  async getScheduleById(id: number): Promise<Schedule | null> {
    try {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT
          s.id, s.name, s.department_id, s.start_date, s.end_date,
          s.status, s.published_at, s.notes, s.created_at, s.updated_at,
          d.name as department_name,
          d.org_unit_id as department_org_unit_id,
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
      const schedule: Schedule = {
        id: row.id,
        name: row.name,
        departmentId: row.department_id,
        departmentName: row.department_name,
        departmentOrgUnitId: row.department_org_unit_id ?? null,
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
      return schedule;
    } catch (error) {
      logger.error('Failed to get schedule by ID:', error);
      throw error;
    }
  }

  async getAllSchedules(filters?: {
    departmentId?: number;
    status?: string;
    startDate?: string;
    endDate?: string;
    orgUnitIds?: number[];
  }, pagination?: { limit: number; offset: number }): Promise<Schedule[]> {
    try {
      let query = `
        SELECT
          s.id, s.name, s.department_id, s.start_date, s.end_date,
          s.status, s.published_at, s.notes, s.created_at, s.updated_at,
          d.name as department_name,
          COUNT(DISTINCT sh.id) as total_shifts,
          COUNT(DISTINCT sa.id) as total_assignments
        FROM schedules s
        LEFT JOIN departments d ON s.department_id = d.id
        LEFT JOIN shifts sh ON s.id = sh.schedule_id
        LEFT JOIN shift_assignments sa ON sh.id = sa.shift_id AND sa.status IN ('pending', 'confirmed')
      `;

      const conditions: string[] = [];
      const params: any[] = [];

      if (filters?.departmentId) { conditions.push('s.department_id = ?'); params.push(filters.departmentId); }
      if (filters?.status) { conditions.push('s.status = ?'); params.push(filters.status); }
      if (filters?.startDate) { conditions.push('s.end_date >= ?'); params.push(filters.startDate); }
      if (filters?.endDate) { conditions.push('s.start_date <= ?'); params.push(filters.endDate); }
      if (filters?.orgUnitIds && filters.orgUnitIds.length > 0) {
        const placeholders = filters.orgUnitIds.map(() => '?').join(', ');
        conditions.push(`d.org_unit_id IN (${placeholders})`);
        params.push(...filters.orgUnitIds);
      }

      if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
      query += ' GROUP BY s.id ORDER BY s.start_date DESC';
      if (pagination) {
        query += ' LIMIT ? OFFSET ?';
        params.push(pagination.limit, pagination.offset);
      } else {
        query += ' LIMIT 1000';
      }

      const [rows] = await this.pool.execute<RowDataPacket[]>(query, params);

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
      logger.error('Failed to get all schedules:', error);
      throw error;
    }
  }

  async countSchedules(filters?: {
    departmentId?: number;
    status?: string;
    startDate?: string;
    endDate?: string;
    orgUnitIds?: number[];
  }): Promise<number> {
    try {
      let query = `SELECT COUNT(DISTINCT s.id) AS total FROM schedules s LEFT JOIN departments d ON s.department_id = d.id`;
      const conditions: string[] = [];
      const params: any[] = [];

      if (filters?.departmentId) { conditions.push('s.department_id = ?'); params.push(filters.departmentId); }
      if (filters?.status) { conditions.push('s.status = ?'); params.push(filters.status); }
      if (filters?.startDate) { conditions.push('s.end_date >= ?'); params.push(filters.startDate); }
      if (filters?.endDate) { conditions.push('s.start_date <= ?'); params.push(filters.endDate); }
      if (filters?.orgUnitIds && filters.orgUnitIds.length > 0) {
        const placeholders = filters.orgUnitIds.map(() => '?').join(', ');
        conditions.push(`d.org_unit_id IN (${placeholders})`);
        params.push(...filters.orgUnitIds);
      }

      if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');

      const [rows] = await this.pool.execute<RowDataPacket[]>(query, params);
      return Number(rows[0]?.total ?? 0);
    } catch (error) {
      logger.error('Failed to count schedules:', error);
      throw error;
    }
  }

  async updateSchedule(id: number, scheduleData: UpdateScheduleRequest): Promise<Schedule> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();

      const [existingRows] = await connection.execute<RowDataPacket[]>(
        'SELECT status FROM schedules WHERE id = ? LIMIT 1',
        [id]
      );
      if (existingRows.length === 0) throw new Error('Schedule not found');

      const currentStatus = existingRows[0].status;
      if (currentStatus === 'archived' && scheduleData.status !== 'archived') {
        throw new Error('Cannot modify archived schedule');
      }

      const updates: string[] = [];
      const values: any[] = [];

      if (scheduleData.name !== undefined) { updates.push('name = ?'); values.push(scheduleData.name); }
      if (scheduleData.startDate !== undefined) { updates.push('start_date = ?'); values.push(scheduleData.startDate); }
      if (scheduleData.endDate !== undefined) { updates.push('end_date = ?'); values.push(scheduleData.endDate); }
      if (scheduleData.status !== undefined) {
        updates.push('status = ?');
        values.push(scheduleData.status);
        if (scheduleData.status === 'published') updates.push('published_at = CURRENT_TIMESTAMP');
      }
      if (scheduleData.notes !== undefined) { updates.push('notes = ?'); values.push(scheduleData.notes); }

      if (updates.length > 0) {
        values.push(id);
        await connection.execute(
          `UPDATE schedules SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          values
        );
      }

      await connection.commit();
      logger.info(`Schedule updated successfully: ${id}`);

      const updatedSchedule = await this.getScheduleById(id);
      if (!updatedSchedule) throw new Error('Schedule not found after update');
      return updatedSchedule;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to update schedule:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  async deleteSchedule(id: number): Promise<boolean> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();

      const [scheduleRows] = await connection.execute<RowDataPacket[]>(
        'SELECT status FROM schedules WHERE id = ? LIMIT 1',
        [id]
      );
      if (scheduleRows.length === 0) throw new Error('Schedule not found');

      const status = scheduleRows[0].status;
      if (status !== 'draft') {
        throw new Error('Only draft schedules can be deleted. Archive published schedules instead.');
      }

      await connection.execute(
        `DELETE sa FROM shift_assignments sa
        JOIN shifts sh ON sa.shift_id = sh.id
        WHERE sh.schedule_id = ?`,
        [id]
      );
      await connection.execute(
        `DELETE ss FROM shift_skills ss
        JOIN shifts sh ON ss.shift_id = sh.id
        WHERE sh.schedule_id = ?`,
        [id]
      );
      await connection.execute('DELETE FROM shifts WHERE schedule_id = ?', [id]);

      const [result] = await connection.execute<ResultSetHeader>(
        'DELETE FROM schedules WHERE id = ?',
        [id]
      );
      if (result.affectedRows === 0) throw new Error('Schedule not found');

      await connection.commit();
      logger.info(`Schedule deleted successfully: ${id}`);
      return true;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to delete schedule:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  async publishSchedule(id: number, actorId?: number | null, reason?: string): Promise<Schedule> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();

      const [shiftRows] = await connection.execute<RowDataPacket[]>(
        'SELECT COUNT(*) as shift_count FROM shifts WHERE schedule_id = ?',
        [id]
      );
      if (shiftRows[0].shift_count === 0) throw new Error('Cannot publish schedule with no shifts');

      await connection.execute(
        `UPDATE schedules
        SET status = 'published', published_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'draft'`,
        [id]
      );

      await connection.commit();
      logger.info(`Schedule published successfully: ${id}`);

      const publishedSchedule = await this.getScheduleById(id);
      if (!publishedSchedule) throw new Error('Schedule not found after publishing');

      await this.audit.write({
        actorId: actorId ?? null,
        action: 'schedule.publish',
        entityType: 'schedule',
        entityId: id,
        description: `Schedule published: ${publishedSchedule.name}`,
        justification: reason ?? null,
        after: { id, status: 'published' },
      });

      // One notification per employee actually on the roster — this is the
      // signal that "the schedule is available", not just an audit entry.
      // In the simulation harness this same event is what an employee
      // thread waits on before checking its own assignments for errors.
      const [assignedRows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT DISTINCT sa.user_id
           FROM shift_assignments sa
           JOIN shifts s ON s.id = sa.shift_id
          WHERE s.schedule_id = ?`,
        [id]
      );
      for (const row of assignedRows) {
        this.notifications.notifyAsync({
          userId: row.user_id as number,
          type: 'schedule.published',
          title: 'Schedule published',
          body: `"${publishedSchedule.name}" is now available — check your assigned shifts.`,
        });
      }

      return publishedSchedule;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to publish schedule:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  async archiveSchedule(id: number, actorId?: number | null): Promise<Schedule> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();

      const [scheduleRows] = await connection.execute<RowDataPacket[]>(
        'SELECT status FROM schedules WHERE id = ? LIMIT 1 FOR UPDATE',
        [id]
      );
      if (scheduleRows.length === 0) throw new Error('Schedule not found');
      const previousStatus = scheduleRows[0].status as string;
      if (previousStatus !== 'draft' && previousStatus !== 'published') {
        throw new Error(`Cannot archive schedule in '${previousStatus}' status`);
      }

      // Archiving abandons any shift invite that hasn't been answered yet —
      // block until those are resolved (confirmed/completed/cancelled) rather
      // than silently orphaning them.
      const [pendingRows] = await connection.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS pending_count
           FROM shift_assignments sa
           JOIN shifts sh ON sa.shift_id = sh.id
          WHERE sh.schedule_id = ? AND sa.status = 'pending'`,
        [id]
      );
      const pendingCount = pendingRows[0].pending_count as number;
      if (pendingCount > 0) {
        throw new Error(
          `Cannot archive schedule with ${pendingCount} pending shift assignment(s); resolve or cancel them first`
        );
      }

      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE schedules
        SET status = 'archived', updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = ?`,
        [id, previousStatus]
      );
      if (result.affectedRows === 0) throw new Error('Schedule not found');

      await connection.commit();
      logger.info(`Schedule archived successfully: ${id}`);

      const archivedSchedule = await this.getScheduleById(id);
      if (!archivedSchedule) throw new Error('Schedule not found after archiving');

      await this.audit.write({
        actorId: actorId ?? null,
        action: 'schedule.archive',
        entityType: 'schedule',
        entityId: id,
        description: `Schedule archived: ${archivedSchedule.name}`,
        before: { id, status: previousStatus },
        after: { id, status: 'archived' },
      });

      return archivedSchedule;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to archive schedule:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  // ── Thin delegates — real logic lives in ScheduleOptimizationOrchestrator ──

  async getSchedulesByDateRange(startDate: string, endDate: string, departmentId?: number): Promise<Schedule[]> {
    return this.getAllSchedules({ startDate, endDate, departmentId });
  }

  async getSchedulesByDepartment(departmentId: number): Promise<Schedule[]> {
    return this.getAllSchedules({ departmentId });
  }

  async getSchedulesByUser(userId: number): Promise<Schedule[]> {
    return this.orchestrator.getSchedulesByUser(userId);
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
    return this.orchestrator.getScheduleStatistics(id);
  }

  async getScheduleShifts(scheduleId: number): Promise<any[]> {
    return this.orchestrator.getScheduleShifts(scheduleId);
  }

  async getScheduleWithShifts(scheduleId: number): Promise<any> {
    return this.orchestrator.getScheduleWithShifts(scheduleId);
  }

  async cloneSchedule(
    sourceScheduleId: number,
    newName: string,
    newStartDate: string,
    newEndDate: string
  ): Promise<Schedule> {
    return this.orchestrator.cloneSchedule(sourceScheduleId, newName, newStartDate, newEndDate);
  }

  async duplicateSchedule(
    scheduleId: number,
    newName: string,
    newStartDate: string,
    newEndDate: string
  ): Promise<Schedule> {
    return this.orchestrator.duplicateSchedule(scheduleId, newName, newStartDate, newEndDate);
  }

  async generateOptimizedSchedule(scheduleId: number, createdBy: number): Promise<{
    success: true;
    scheduleId: number;
    assignmentsCreated: number;
    totalShifts: number;
    coveragePercentage: number;
    status: string;
  }> {
    return this.orchestrator.generateOptimizedSchedule(scheduleId, createdBy);
  }
}
