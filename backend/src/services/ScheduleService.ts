/**
 * Schedule service — CRUD and the draft -> published -> archived lifecycle.
 *
 * WHY THE OPTIMIZATION-ADJACENT READS LIVE ELSEWHERE. The statistics, per-shift
 * breakdowns and by-user queries were split into
 * {@link ScheduleOptimizationOrchestrator}. They are read-only aggregates whose
 * consumers are the optimizer and the reporting UI, not the schedule lifecycle,
 * and they change for different reasons: a new coverage metric touches the
 * orchestrator, a new lifecycle state touches this file. Keeping them together
 * meant every change to either risked the other.
 *
 * WHY PUBLISHING IS MORE THAN A STATUS COLUMN. `publishSchedule` is the point
 * where a schedule stops being a proposal and becomes something people arrange
 * their lives around, which is why it is audited and why the transition is
 * guarded rather than a bare UPDATE. #449 is the follow-on: once published,
 * the assignments should be pinned so a later re-solve plans AROUND them
 * instead of reshuffling commitments people have already acted on.
 *
 * @author Luca Ostinelli
 */

import { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { ConflictError, NotFoundError } from '../errors';
import {
  Schedule,
  CreateScheduleRequest,
  UpdateScheduleRequest, SqlParam } from '../types';
import { logger } from '../config/logger';
import { DateUtils } from '../utils';
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

      if (!scheduleData.createdBy) throw new ConflictError('createdBy is required');

      const startDate = new Date(scheduleData.startDate);
      const endDate = new Date(scheduleData.endDate);
      if (startDate >= endDate) throw new ConflictError('End date must be after start date');

      const [deptRows] = await connection.execute<RowDataPacket[]>(
        'SELECT id FROM departments WHERE id = ? AND is_active = 1 LIMIT 1',
        [scheduleData.departmentId]
      );
      if (deptRows.length === 0) throw new NotFoundError('Department not found');

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
        throw new ConflictError('A schedule already exists for this department in the specified date range');
      }

      if (scheduleData.previousScheduleId) {
        await this.assertUsablePredecessor(connection, {
          predecessorId: scheduleData.previousScheduleId,
          departmentId: scheduleData.departmentId,
          startDate: scheduleData.startDate,
        });
      }

      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO schedules (name, description, department_id, start_date, end_date, status, created_by, notes, previous_schedule_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          scheduleData.name,
          null,
          scheduleData.departmentId,
          scheduleData.startDate,
          scheduleData.endDate,
          'draft',
          scheduleData.createdBy,
          scheduleData.notes || null,
          scheduleData.previousScheduleId ?? null
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
          s.previous_schedule_id,
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
        previousScheduleId: row.previous_schedule_id ?? null,
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
      const params: SqlParam[] = [];

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
      const params: SqlParam[] = [];

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
      if (existingRows.length === 0) throw new NotFoundError('Schedule not found');

      const currentStatus = existingRows[0].status;
      if (currentStatus === 'archived' && scheduleData.status !== 'archived') {
        throw new ConflictError('Cannot modify archived schedule');
      }

      const updates: string[] = [];
      const values: SqlParam[] = [];

      if (scheduleData.name !== undefined) { updates.push('name = ?'); values.push(scheduleData.name); }
      if (scheduleData.startDate !== undefined) { updates.push('start_date = ?'); values.push(scheduleData.startDate); }
      if (scheduleData.endDate !== undefined) { updates.push('end_date = ?'); values.push(scheduleData.endDate); }
      if (scheduleData.status !== undefined) {
        updates.push('status = ?');
        values.push(scheduleData.status);
        if (scheduleData.status === 'published') updates.push('published_at = CURRENT_TIMESTAMP');
      }
      if (scheduleData.notes !== undefined) { updates.push('notes = ?'); values.push(scheduleData.notes); }
      if (scheduleData.previousScheduleId !== undefined) {
        // Explicit null is meaningful: it restores the default resolution
        // rather than saying there is no predecessor, so it must be told apart
        // from the field being absent.
        if (scheduleData.previousScheduleId !== null) {
          const [self] = await connection.execute<RowDataPacket[]>(
            'SELECT department_id, start_date FROM schedules WHERE id = ? LIMIT 1',
            [id]
          );
          await this.assertUsablePredecessor(connection, {
            predecessorId: scheduleData.previousScheduleId,
            departmentId: self[0].department_id as number,
            startDate: DateUtils.toDateString(self[0].start_date),
            selfId: id,
          });
        }
        updates.push('previous_schedule_id = ?');
        values.push(scheduleData.previousScheduleId);
      }

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
      if (!updatedSchedule) throw new NotFoundError('Schedule not found after update');
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
      if (scheduleRows.length === 0) throw new NotFoundError('Schedule not found');

      const status = scheduleRows[0].status;
      if (status !== 'draft') {
        throw new ConflictError('Only draft schedules can be deleted. Archive published schedules instead.');
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
      if (result.affectedRows === 0) throw new NotFoundError('Schedule not found');

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

  /**
   * Refuses a predecessor that cannot be one.
   *
   * The foreign key only proves the row exists. What makes a schedule a usable
   * predecessor is that it belongs to the same department — continuity is
   * about the same people — and that it does not start after this one, which
   * would make the sequence circular in meaning if not in data. A schedule
   * cannot precede itself.
   *
   * Overlap is deliberately allowed. An archived generation for the same
   * period is exactly the case the explicit column exists for: the manager is
   * saying "this is the one that happened".
   */
  private async assertUsablePredecessor(
    connection: PoolConnection,
    input: { predecessorId: number; departmentId: number; startDate: string; selfId?: number }
  ): Promise<void> {
    if (input.selfId !== undefined && input.predecessorId === input.selfId) {
      throw new ConflictError('A schedule cannot continue from itself');
    }
    const [rows] = await connection.execute<RowDataPacket[]>(
      'SELECT department_id, start_date FROM schedules WHERE id = ? LIMIT 1',
      [input.predecessorId]
    );
    if (rows.length === 0) throw new NotFoundError('Previous schedule not found');
    if ((rows[0].department_id as number) !== input.departmentId) {
      throw new ConflictError('The previous schedule must belong to the same department');
    }
    if (DateUtils.toDateString(rows[0].start_date) > input.startDate) {
      throw new ConflictError('The previous schedule cannot start after this one');
    }
  }

  /**
   * The schedules that could plausibly precede this one, newest first.
   *
   * Exists so the choice can be made from a list rather than by knowing an id.
   * Archived ones are included on purpose — an abandoned generation for the
   * period is precisely what a manager might be choosing between, and
   * excluding it would hide the case this feature was built for.
   *
   * The one that would be used if nothing is chosen is flagged rather than
   * left for the caller to re-derive, so the UI can show "current default"
   * without reimplementing the rule.
   */
  async getPredecessorCandidates(id: number): Promise<Array<{
    id: number;
    name: string;
    startDate: string;
    endDate: string;
    status: string;
    isCurrent: boolean;
    isDefault: boolean;
  }>> {
    const [selfRows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT department_id, start_date, previous_schedule_id FROM schedules WHERE id = ? LIMIT 1',
      [id]
    );
    if (selfRows.length === 0) throw new NotFoundError('Schedule not found');
    const self = selfRows[0];

    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id, name, start_date, end_date, status FROM schedules
        WHERE department_id = ?
          AND id != ?
          AND start_date <= ?
        ORDER BY end_date DESC, id DESC`,
      [self.department_id, id, self.start_date]
    );

    // The default is the most recent PUBLISHED one ending before this starts —
    // the same rule the optimizer applies, stated in one place here and read
    // from the same ordering.
    const defaultId = rows.find(
      (r) => r.status === 'published' && DateUtils.toDateString(r.end_date) < DateUtils.toDateString(self.start_date)
    )?.id as number | undefined;

    return rows.map((r) => ({
      id: r.id as number,
      name: r.name as string,
      startDate: DateUtils.toDateString(r.start_date),
      endDate: DateUtils.toDateString(r.end_date),
      status: r.status as string,
      isCurrent: (self.previous_schedule_id as number | null) === r.id,
      isDefault: (self.previous_schedule_id as number | null) === null && r.id === defaultId,
    }));
  }

  async publishSchedule(id: number, actorId?: number | null, reason?: string): Promise<Schedule> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();

      const [shiftRows] = await connection.execute<RowDataPacket[]>(
        'SELECT COUNT(*) as shift_count FROM shifts WHERE schedule_id = ?',
        [id]
      );
      if (shiftRows[0].shift_count === 0) throw new ConflictError('Cannot publish schedule with no shifts');

      await connection.execute(
        `UPDATE schedules
        SET status = 'published', published_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'draft'`,
        [id]
      );

      // Publishing is what turns an assignment into a COMMITMENT: it is the
      // moment people are told, and from here a re-solve must plan around it
      // rather than reconsider it.
      //
      // This is the write the pin column was added for and never got — the
      // migration backfilled schedules that were already published, so the
      // machinery worked exactly once, for rows that existed before it. Every
      // schedule published afterwards handed the optimizer an empty pinned set,
      // leaving the disruption objective nothing to charge and the re-solve
      // diff permanently empty.
      //
      // In the same transaction as the status change, because "published" and
      // "committed" are one fact; a crash between them would leave a live
      // schedule the optimizer is free to reshuffle.
      //
      // Only `pending` and `confirmed`: a declined or cancelled assignment is
      // not something anyone is relying on, and pinning it would ask the
      // optimizer to preserve work nobody is doing.
      await connection.execute(
        `UPDATE shift_assignments sa
           JOIN shifts s ON s.id = sa.shift_id
            SET sa.is_pinned = TRUE
          WHERE s.schedule_id = ?
            AND sa.status IN ('pending', 'confirmed')`,
        [id]
      );

      await connection.commit();
      logger.info(`Schedule published successfully: ${id}`);

      const publishedSchedule = await this.getScheduleById(id);
      if (!publishedSchedule) throw new NotFoundError('Schedule not found after publishing');

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
      if (scheduleRows.length === 0) throw new NotFoundError('Schedule not found');
      const previousStatus = scheduleRows[0].status as string;
      if (previousStatus !== 'draft' && previousStatus !== 'published') {
        throw new ConflictError(`Cannot archive schedule in '${previousStatus}' status`);
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
        throw new ConflictError(
          `Cannot archive schedule with ${pendingCount} pending shift assignment(s); resolve or cancel them first`
        );
      }

      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE schedules
        SET status = 'archived', updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = ?`,
        [id, previousStatus]
      );
      if (result.affectedRows === 0) throw new NotFoundError('Schedule not found');

      await connection.commit();
      logger.info(`Schedule archived successfully: ${id}`);

      const archivedSchedule = await this.getScheduleById(id);
      if (!archivedSchedule) throw new NotFoundError('Schedule not found after archiving');

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
