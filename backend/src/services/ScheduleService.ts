/**
 * Schedule Service
 * 
 * Handles all schedule-related business logic including schedule creation,
 * management, shift generation, and publication.
 * 
 * @module services/ScheduleService
 * @author Staff Scheduler Team
 */

import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { 
  Schedule,
  CreateScheduleRequest,
  UpdateScheduleRequest
} from '../types';
import { logger } from '../config/logger';

/**
 * ScheduleService Class
 * 
 * Provides comprehensive schedule management functionality including:
 * - Schedule CRUD operations
 * - Schedule publication and status management
 * - Shift generation from templates
 * - Schedule statistics and reporting
 * - Integration with optimization engine
 */
export class ScheduleService {
  /**
   * Creates a new ScheduleService instance
   * 
   * @param pool - MySQL connection pool for database operations
   */
  constructor(private pool: Pool) {}

  /**
   * Creates a new schedule
   * 
   * @param scheduleData - Schedule creation data
   * @returns Promise resolving to the created schedule
   */
  async createSchedule(scheduleData: CreateScheduleRequest): Promise<Schedule> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      // Validate dates
      const startDate = new Date(scheduleData.startDate);
      const endDate = new Date(scheduleData.endDate);

      if (startDate >= endDate) {
        throw new Error('End date must be after start date');
      }

      // Validate department exists
      const [deptRows] = await connection.execute<RowDataPacket[]>(
        'SELECT id FROM departments WHERE id = ? AND is_active = 1 LIMIT 1',
        [scheduleData.departmentId]
      );

      if (deptRows.length === 0) {
        throw new Error('Department not found');
      }

      // Check for overlapping schedules if needed
      const [overlapRows] = await connection.execute<RowDataPacket[]>(
        `SELECT id FROM schedules 
        WHERE department_id = ? 
        AND status IN ('draft', 'published')
        AND (
          (start_date <= ? AND end_date >= ?)
          OR (start_date <= ? AND end_date >= ?)
          OR (start_date >= ? AND end_date <= ?)
        )
        LIMIT 1`,
        [
          scheduleData.departmentId,
          scheduleData.startDate, scheduleData.startDate,
          scheduleData.endDate, scheduleData.endDate,
          scheduleData.startDate, scheduleData.endDate
        ]
      );

      if (overlapRows.length > 0) {
        throw new Error('A schedule already exists for this department in the specified date range');
      }

      // Insert schedule record
      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO schedules (
          name, department_id, start_date, end_date, status, notes
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          scheduleData.name,
          scheduleData.departmentId,
          scheduleData.startDate,
          scheduleData.endDate,
          'draft',
          scheduleData.notes || null
        ]
      );

      const scheduleId = result.insertId;

      await connection.commit();

      logger.info(`Schedule created successfully: ${scheduleId}`);

      // Retrieve and return the created schedule
      const newSchedule = await this.getScheduleById(scheduleId);
      if (!newSchedule) {
        throw new Error('Failed to retrieve created schedule');
      }

      return newSchedule;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to create schedule:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Retrieves a schedule by its unique identifier
   * 
   * Includes:
   * - Basic schedule information
   * - Department details
   * - Shift statistics
   * - Assignment statistics
   * 
   * @param id - Schedule ID
   * @returns Promise resolving to Schedule object or null if not found
   */
  async getScheduleById(id: number): Promise<Schedule | null> {
    try {
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

      if (rows.length === 0) {
        return null;
      }

      const row = rows[0];

      const schedule: Schedule = {
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

      return schedule;
    } catch (error) {
      logger.error('Failed to get schedule by ID:', error);
      throw error;
    }
  }

  /**
   * Retrieves all schedules with optional filtering
   * 
   * @param filters - Optional filters for department, status, and date range
   * @returns Promise resolving to array of schedules
   */
  async getAllSchedules(filters?: {
    departmentId?: number;
    status?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<Schedule[]> {
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

      if (filters?.departmentId) {
        conditions.push('s.department_id = ?');
        params.push(filters.departmentId);
      }

      if (filters?.status) {
        conditions.push('s.status = ?');
        params.push(filters.status);
      }

      if (filters?.startDate) {
        conditions.push('s.end_date >= ?');
        params.push(filters.startDate);
      }

      if (filters?.endDate) {
        conditions.push('s.start_date <= ?');
        params.push(filters.endDate);
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      query += ' GROUP BY s.id ORDER BY s.start_date DESC';

      const [rows] = await this.pool.execute<RowDataPacket[]>(query, params);

      const schedules: Schedule[] = rows.map((row: any) => ({
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

      return schedules;
    } catch (error) {
      logger.error('Failed to get all schedules:', error);
      throw error;
    }
  }

  /**
   * Updates an existing schedule
   * 
   * @param id - Schedule ID
   * @param scheduleData - Partial schedule data to update
   * @returns Promise resolving to updated schedule
   */
  async updateSchedule(id: number, scheduleData: UpdateScheduleRequest): Promise<Schedule> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      // Check if schedule exists
      const [existingRows] = await connection.execute<RowDataPacket[]>(
        'SELECT status FROM schedules WHERE id = ? LIMIT 1',
        [id]
      );

      if (existingRows.length === 0) {
        throw new Error('Schedule not found');
      }

      const currentStatus = existingRows[0].status;

      // Prevent editing published or archived schedules
      if (currentStatus === 'archived' && scheduleData.status !== 'archived') {
        throw new Error('Cannot modify archived schedule');
      }

      const updates: string[] = [];
      const values: any[] = [];

      if (scheduleData.name !== undefined) {
        updates.push('name = ?');
        values.push(scheduleData.name);
      }

      if (scheduleData.startDate !== undefined) {
        updates.push('start_date = ?');
        values.push(scheduleData.startDate);
      }

      if (scheduleData.endDate !== undefined) {
        updates.push('end_date = ?');
        values.push(scheduleData.endDate);
      }

      if (scheduleData.status !== undefined) {
        updates.push('status = ?');
        values.push(scheduleData.status);

        // Set published_at when status changes to published
        if (scheduleData.status === 'published') {
          updates.push('published_at = CURRENT_TIMESTAMP');
        }
      }

      if (scheduleData.notes !== undefined) {
        updates.push('notes = ?');
        values.push(scheduleData.notes);
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
      if (!updatedSchedule) {
        throw new Error('Schedule not found after update');
      }

      return updatedSchedule;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to update schedule:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Deletes a schedule
   * 
   * Only allows deletion of draft schedules
   * 
   * @param id - Schedule ID to delete
   * @returns Promise resolving to true if successful
   */
  async deleteSchedule(id: number): Promise<boolean> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      // Check schedule status
      const [scheduleRows] = await connection.execute<RowDataPacket[]>(
        'SELECT status FROM schedules WHERE id = ? LIMIT 1',
        [id]
      );

      if (scheduleRows.length === 0) {
        throw new Error('Schedule not found');
      }

      const status = scheduleRows[0].status;

      if (status !== 'draft') {
        throw new Error('Only draft schedules can be deleted. Archive published schedules instead.');
      }

      // Delete shift assignments first
      await connection.execute(
        `DELETE sa FROM shift_assignments sa
        JOIN shifts sh ON sa.shift_id = sh.id
        WHERE sh.schedule_id = ?`,
        [id]
      );

      // Delete shift skills
      await connection.execute(
        `DELETE ss FROM shift_skills ss
        JOIN shifts sh ON ss.shift_id = sh.id
        WHERE sh.schedule_id = ?`,
        [id]
      );

      // Delete shifts
      await connection.execute('DELETE FROM shifts WHERE schedule_id = ?', [id]);

      // Delete the schedule
      const [result] = await connection.execute<ResultSetHeader>(
        'DELETE FROM schedules WHERE id = ?',
        [id]
      );

      if (result.affectedRows === 0) {
        throw new Error('Schedule not found');
      }

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
   * Publishes a schedule
   * 
   * Changes status from draft to published and sets published_at timestamp
   * 
   * @param id - Schedule ID
   * @returns Promise resolving to updated schedule
   */
  async publishSchedule(id: number): Promise<Schedule> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      // Validate schedule has shifts
      const [shiftRows] = await connection.execute<RowDataPacket[]>(
        'SELECT COUNT(*) as shift_count FROM shifts WHERE schedule_id = ?',
        [id]
      );

      const shiftCount = shiftRows[0].shift_count;

      if (shiftCount === 0) {
        throw new Error('Cannot publish schedule with no shifts');
      }

      // Update schedule status
      await connection.execute(
        `UPDATE schedules 
        SET status = 'published', published_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'draft'`,
        [id]
      );

      await connection.commit();

      logger.info(`Schedule published successfully: ${id}`);

      const publishedSchedule = await this.getScheduleById(id);
      if (!publishedSchedule) {
        throw new Error('Schedule not found after publishing');
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

  /**
   * Archives a schedule
   * 
   * Changes status to archived, preventing further modifications
   * 
   * @param id - Schedule ID
   * @returns Promise resolving to updated schedule
   */
  async archiveSchedule(id: number): Promise<Schedule> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      await connection.execute(
        `UPDATE schedules 
        SET status = 'archived', updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status IN ('draft', 'published')`,
        [id]
      );

      await connection.commit();

      logger.info(`Schedule archived successfully: ${id}`);

      const archivedSchedule = await this.getScheduleById(id);
      if (!archivedSchedule) {
        throw new Error('Schedule not found after archiving');
      }

      return archivedSchedule;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to archive schedule:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Gets schedule statistics
   * 
   * @param id - Schedule ID
   * @returns Promise resolving to statistics object
   */
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
      const coveragePercentage = totalStaffNeeded > 0 
        ? Math.round((totalAssignments / totalStaffNeeded) * 100)
        : 0;

      return {
        totalShifts: stats.total_shifts || 0,
        totalAssignments: totalAssignments,
        fullyStaffedShifts: stats.fully_staffed || 0,
        understaffedShifts: stats.understaffed || 0,
        overstaffedShifts: stats.overstaffed || 0,
        emptyShifts: stats.empty_shifts || 0,
        totalStaffNeeded: totalStaffNeeded,
        totalStaffAssigned: totalAssignments,
        coveragePercentage: coveragePercentage
      };
    } catch (error) {
      logger.error('Failed to get schedule statistics:', error);
      throw error;
    }
  }

  /**
   * Gets all shifts for a schedule
   * 
   * @param scheduleId - Schedule ID
   * @returns Promise resolving to array of shifts with assignment details
   */
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

  /**
   * Gets schedules by date range
   * 
   * @param startDate - Start date
   * @param endDate - End date
   * @param departmentId - Optional department filter
   * @returns Promise resolving to array of schedules
   */
  async getSchedulesByDateRange(
    startDate: string,
    endDate: string,
    departmentId?: number
  ): Promise<Schedule[]> {
    return this.getAllSchedules({
      startDate,
      endDate,
      departmentId
    });
  }

  /**
   * Clones a schedule to a new date range
   * 
   * Creates a copy of all shifts with new dates
   * 
   * @param sourceScheduleId - ID of schedule to clone
   * @param newName - Name for the new schedule
   * @param newStartDate - Start date for the new schedule
   * @param newEndDate - End date for the new schedule
   * @returns Promise resolving to the new schedule
   */
  async cloneSchedule(
    sourceScheduleId: number,
    newName: string,
    newStartDate: string,
    newEndDate: string
  ): Promise<Schedule> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      // Get source schedule
      const [sourceRows] = await connection.execute<RowDataPacket[]>(
        'SELECT * FROM schedules WHERE id = ? LIMIT 1',
        [sourceScheduleId]
      );

      if (sourceRows.length === 0) {
        throw new Error('Source schedule not found');
      }

      const sourceSchedule = sourceRows[0];

      // Create new schedule
      const [scheduleResult] = await connection.execute<ResultSetHeader>(
        `INSERT INTO schedules (name, department_id, start_date, end_date, status, notes)
        VALUES (?, ?, ?, ?, 'draft', ?)`,
        [
          newName,
          sourceSchedule.department_id,
          newStartDate,
          newEndDate,
          `Cloned from ${sourceSchedule.name}`
        ]
      );

      const newScheduleId = scheduleResult.insertId;

      // Calculate date offset
      const sourceDateStart = new Date(sourceSchedule.start_date);
      const targetDateStart = new Date(newStartDate);
      const dayOffset = Math.floor((targetDateStart.getTime() - sourceDateStart.getTime()) / (1000 * 60 * 60 * 24));

      // Clone all shifts
      const [shifts] = await connection.execute<RowDataPacket[]>(
        'SELECT * FROM shifts WHERE schedule_id = ?',
        [sourceScheduleId]
      );

      for (const shift of shifts) {
        const shiftDate = new Date(shift.date);
        shiftDate.setDate(shiftDate.getDate() + dayOffset);
        const newDate = shiftDate.toISOString().split('T')[0];

        const [shiftResult] = await connection.execute<ResultSetHeader>(
          `INSERT INTO shifts (
            schedule_id, department_id, template_id, date, start_time, end_time,
            min_staff, max_staff, notes, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
          [
            newScheduleId,
            shift.department_id,
            shift.template_id,
            newDate,
            shift.start_time,
            shift.end_time,
            shift.min_staff,
            shift.max_staff,
            shift.notes
          ]
        );

        const newShiftId = shiftResult.insertId;

        // Clone shift skills
        const [shiftSkills] = await connection.execute<RowDataPacket[]>(
          'SELECT skill_id FROM shift_skills WHERE shift_id = ?',
          [shift.id]
        );

        for (const skill of shiftSkills) {
          await connection.execute(
            'INSERT INTO shift_skills (shift_id, skill_id) VALUES (?, ?)',
            [newShiftId, skill.skill_id]
          );
        }
      }

      await connection.commit();

      logger.info(`Schedule cloned successfully: ${sourceScheduleId} -> ${newScheduleId}`);

      const newSchedule = await this.getScheduleById(newScheduleId);
      if (!newSchedule) {
        throw new Error('Failed to retrieve cloned schedule');
      }

      return newSchedule;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to clone schedule:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  async getSchedulesByDepartment(departmentId: number): Promise<Schedule[]> {
    return this.getAllSchedules({ departmentId });
  }

  async getSchedulesByUser(userId: number): Promise<Schedule[]> {
    try {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT DISTINCT s.id FROM schedules s 
        JOIN shifts sh ON s.id = sh.schedule_id 
        JOIN shift_assignments sa ON sh.id = sa.shift_id 
        WHERE sa.user_id = ?`,
        [userId]
      );
      const schedules = await Promise.all(
        rows.map((row: any) => this.getScheduleById(row.id))
      );
      return schedules.filter((s): s is Schedule => s !== null);
    } catch (error) {
      logger.error('Failed to get schedules by user:', error);
      throw error;
    }
  }

  async duplicateSchedule(scheduleId: number, newName: string, newStartDate: string, newEndDate: string): Promise<Schedule> {
    return this.cloneSchedule(scheduleId, newName, newStartDate, newEndDate);
  }

  async getScheduleWithShifts(scheduleId: number): Promise<any> {
    try {
      const schedule = await this.getScheduleById(scheduleId);
      if (!schedule) return null;
      const shifts = await this.getScheduleShifts(scheduleId);
      return { ...schedule, shifts };
    } catch (error) {
      logger.error('Failed to get schedule with shifts:', error);
      throw error;
    }
  }

  async generateOptimizedSchedule(scheduleId: number, options: any): Promise<any> {
    try {
      logger.info('Optimization requested for schedule: ' + scheduleId);
      return {
        success: false,
        message: 'Optimization not yet implemented. Use ScheduleOptimizer service.',
        scheduleId
      };
    } catch (error) {
      logger.error('Failed to generate optimized schedule:', error);
      throw error;
    }
  }
}
