/**
 * Shift Service
 * 
 * Handles all shift-related business logic including shift management,
 * assignments, and schedule integration.
 * 
 * @module services/ShiftService
 * @author Staff Scheduler Team
 */

import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { 
  Shift,
  CreateShiftRequest,
  UpdateShiftRequest,
  ShiftAssignment
} from '../types';
import { logger } from '../config/logger';

/**
 * ShiftService Class
 * 
 * Provides comprehensive shift management functionality including:
 * - Shift CRUD operations
 * - Shift assignment management
 * - Skill requirements handling
 * - Shift status tracking
 * - Integration with schedules
 */
export class ShiftService {
  /**
   * Creates a new ShiftService instance
   * 
   * @param pool - MySQL connection pool for database operations
   */
  constructor(private pool: Pool) {}

  /**
   * Creates a new shift
   * 
   * @param shiftData - Shift creation data
   * @returns Promise resolving to the created shift
   */
  async createShift(shiftData: CreateShiftRequest): Promise<Shift> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      // Validate schedule exists
      const [scheduleRows] = await connection.execute<RowDataPacket[]>(
        'SELECT id FROM schedules WHERE id = ? LIMIT 1',
        [shiftData.scheduleId]
      );

      if (scheduleRows.length === 0) {
        throw new Error('Schedule not found');
      }

      // Validate department exists
      const [deptRows] = await connection.execute<RowDataPacket[]>(
        'SELECT id FROM departments WHERE id = ? AND is_active = 1 LIMIT 1',
        [shiftData.departmentId]
      );

      if (deptRows.length === 0) {
        throw new Error('Department not found');
      }

      // Insert shift record
      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO shifts (
          schedule_id, department_id, template_id, date, start_time, end_time,
          min_staff, max_staff, notes, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          shiftData.scheduleId,
          shiftData.departmentId,
          shiftData.templateId || null,
          shiftData.date,
          shiftData.startTime,
          shiftData.endTime,
          shiftData.minStaff,
          shiftData.maxStaff,
          shiftData.notes || null,
          'open'
        ]
      );

      const shiftId = result.insertId;

      // Add required skills if provided
      if (shiftData.requiredSkillIds && shiftData.requiredSkillIds.length > 0) {
        for (const skillId of shiftData.requiredSkillIds) {
          await connection.execute(
            'INSERT INTO shift_skills (shift_id, skill_id) VALUES (?, ?)',
            [shiftId, skillId]
          );
        }
      }

      await connection.commit();

      logger.info(`Shift created successfully: ${shiftId}`);

      // Retrieve and return the created shift
      const newShift = await this.getShiftById(shiftId);
      if (!newShift) {
        throw new Error('Failed to retrieve created shift');
      }

      return newShift;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to create shift:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Retrieves a shift by its unique identifier
   * 
   * Includes:
   * - Basic shift information
   * - Schedule and department details
   * - Required skills
   * - Current assignments
   * 
   * @param id - Shift ID
   * @returns Promise resolving to Shift object or null if not found
   */
  async getShiftById(id: number): Promise<Shift | null> {
    try {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT 
          s.id, s.schedule_id, s.department_id, s.template_id, s.date,
          s.start_time, s.end_time, s.min_staff, s.max_staff, s.notes, s.status,
          s.created_at, s.updated_at,
          sch.name as schedule_name,
          d.name as department_name,
          COUNT(DISTINCT sa.id) as assigned_staff
        FROM shifts s
        LEFT JOIN schedules sch ON s.schedule_id = sch.id
        LEFT JOIN departments d ON s.department_id = d.id
        LEFT JOIN shift_assignments sa ON s.id = sa.shift_id AND sa.status IN ('pending', 'confirmed')
        WHERE s.id = ?
        GROUP BY s.id`,
        [id]
      );

      if (rows.length === 0) {
        return null;
      }

      const row = rows[0];

      // Get required skills
      const [skillRows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT sk.id, sk.name, sk.description, sk.is_active, sk.created_at
        FROM shift_skills ss
        JOIN skills sk ON ss.skill_id = sk.id
        WHERE ss.shift_id = ? AND sk.is_active = 1`,
        [id]
      );

      // Get assignments
      const [assignmentRows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT 
          sa.id, sa.shift_id, sa.user_id, sa.status, sa.assigned_at, sa.confirmed_at, sa.notes,
          u.first_name, u.last_name, u.email
        FROM shift_assignments sa
        JOIN users u ON sa.user_id = u.id
        WHERE sa.shift_id = ?
        ORDER BY sa.assigned_at DESC`,
        [id]
      );

      const shift: Shift = {
        id: row.id,
        scheduleId: row.schedule_id,
        scheduleName: row.schedule_name,
        departmentId: row.department_id,
        departmentName: row.department_name,
        templateId: row.template_id,
        date: row.date,
        startTime: row.start_time,
        endTime: row.end_time,
        minStaff: row.min_staff,
        maxStaff: row.max_staff,
        assignedStaff: row.assigned_staff || 0,
        requiredSkills: skillRows.map((sr: any) => ({
          id: sr.id,
          name: sr.name,
          description: sr.description,
          isActive: Boolean(sr.is_active),
          createdAt: sr.created_at
        })),
        assignments: assignmentRows.map((ar: any) => ({
          id: ar.id,
          shiftId: ar.shift_id,
          userId: ar.user_id,
          userName: `${ar.first_name} ${ar.last_name}`,
          userEmail: ar.email,
          status: ar.status,
          assignedAt: ar.assigned_at,
          confirmedAt: ar.confirmed_at,
          notes: ar.notes
        })),
        status: row.status,
        notes: row.notes,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };

      return shift;
    } catch (error) {
      logger.error('Failed to get shift by ID:', error);
      throw error;
    }
  }

  /**
   * Retrieves all shifts with optional filtering
   * 
   * @param filters - Optional filters for schedule, department, date range, and status
   * @returns Promise resolving to array of shifts
   */
  async getAllShifts(filters?: {
    scheduleId?: number;
    departmentId?: number;
    startDate?: string;
    endDate?: string;
    status?: string;
  }): Promise<Shift[]> {
    try {
      let query = `
        SELECT 
          s.id, s.schedule_id, s.department_id, s.template_id, s.date,
          s.start_time, s.end_time, s.min_staff, s.max_staff, s.notes, s.status,
          s.created_at, s.updated_at,
          sch.name as schedule_name,
          d.name as department_name,
          COUNT(DISTINCT sa.id) as assigned_staff
        FROM shifts s
        LEFT JOIN schedules sch ON s.schedule_id = sch.id
        LEFT JOIN departments d ON s.department_id = d.id
        LEFT JOIN shift_assignments sa ON s.id = sa.shift_id AND sa.status IN ('pending', 'confirmed')
      `;

      const conditions: string[] = [];
      const params: any[] = [];

      if (filters?.scheduleId) {
        conditions.push('s.schedule_id = ?');
        params.push(filters.scheduleId);
      }

      if (filters?.departmentId) {
        conditions.push('s.department_id = ?');
        params.push(filters.departmentId);
      }

      if (filters?.startDate) {
        conditions.push('s.date >= ?');
        params.push(filters.startDate);
      }

      if (filters?.endDate) {
        conditions.push('s.date <= ?');
        params.push(filters.endDate);
      }

      if (filters?.status) {
        conditions.push('s.status = ?');
        params.push(filters.status);
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      query += ' GROUP BY s.id ORDER BY s.date ASC, s.start_time ASC';

      const [rows] = await this.pool.execute<RowDataPacket[]>(query, params);

      const shifts: Shift[] = rows.map((row: any) => ({
        id: row.id,
        scheduleId: row.schedule_id,
        scheduleName: row.schedule_name,
        departmentId: row.department_id,
        departmentName: row.department_name,
        templateId: row.template_id,
        date: row.date,
        startTime: row.start_time,
        endTime: row.end_time,
        minStaff: row.min_staff,
        maxStaff: row.max_staff,
        assignedStaff: row.assigned_staff || 0,
        status: row.status,
        notes: row.notes,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));

      return shifts;
    } catch (error) {
      logger.error('Failed to get all shifts:', error);
      throw error;
    }
  }

  /**
   * Updates an existing shift
   * 
   * @param id - Shift ID
   * @param shiftData - Partial shift data to update
   * @returns Promise resolving to updated shift
   */
  async updateShift(id: number, shiftData: UpdateShiftRequest): Promise<Shift> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      const updates: string[] = [];
      const values: any[] = [];

      if (shiftData.date !== undefined) {
        updates.push('date = ?');
        values.push(shiftData.date);
      }

      if (shiftData.startTime !== undefined) {
        updates.push('start_time = ?');
        values.push(shiftData.startTime);
      }

      if (shiftData.endTime !== undefined) {
        updates.push('end_time = ?');
        values.push(shiftData.endTime);
      }

      if (shiftData.minStaff !== undefined) {
        updates.push('min_staff = ?');
        values.push(shiftData.minStaff);
      }

      if (shiftData.maxStaff !== undefined) {
        updates.push('max_staff = ?');
        values.push(shiftData.maxStaff);
      }

      if (shiftData.status !== undefined) {
        updates.push('status = ?');
        values.push(shiftData.status);
      }

      if (shiftData.notes !== undefined) {
        updates.push('notes = ?');
        values.push(shiftData.notes);
      }

      if (updates.length > 0) {
        values.push(id);
        await connection.execute(
          `UPDATE shifts SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          values
        );
      }

      // Update required skills if provided
      if (shiftData.requiredSkillIds !== undefined) {
        await connection.execute('DELETE FROM shift_skills WHERE shift_id = ?', [id]);
        
        if (shiftData.requiredSkillIds.length > 0) {
          for (const skillId of shiftData.requiredSkillIds) {
            await connection.execute(
              'INSERT INTO shift_skills (shift_id, skill_id) VALUES (?, ?)',
              [id, skillId]
            );
          }
        }
      }

      await connection.commit();

      logger.info(`Shift updated successfully: ${id}`);

      const updatedShift = await this.getShiftById(id);
      if (!updatedShift) {
        throw new Error('Shift not found after update');
      }

      return updatedShift;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to update shift:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Deletes a shift
   * 
   * @param id - Shift ID to delete
   * @returns Promise resolving to true if successful
   */
  async deleteShift(id: number): Promise<boolean> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      // Delete shift assignments first
      await connection.execute('DELETE FROM shift_assignments WHERE shift_id = ?', [id]);

      // Delete shift skills
      await connection.execute('DELETE FROM shift_skills WHERE shift_id = ?', [id]);

      // Delete the shift
      const [result] = await connection.execute<ResultSetHeader>(
        'DELETE FROM shifts WHERE id = ?',
        [id]
      );

      if (result.affectedRows === 0) {
        throw new Error('Shift not found');
      }

      await connection.commit();

      logger.info(`Shift deleted successfully: ${id}`);
      return true;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to delete shift:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Creates shifts from a template for a date range
   * 
   * @param templateId - Shift template ID
   * @param scheduleId - Schedule ID
   * @param startDate - Start date
   * @param endDate - End date
   * @param daysOfWeek - Days of week to create shifts (0=Sunday, 6=Saturday)
   * @returns Promise resolving to array of created shift IDs
   */
  async createShiftsFromTemplate(
    templateId: number,
    scheduleId: number,
    startDate: Date,
    endDate: Date,
    daysOfWeek: number[]
  ): Promise<number[]> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      // Get template details
      const [templateRows] = await connection.execute<RowDataPacket[]>(
        `SELECT * FROM shift_templates WHERE id = ? AND is_active = 1 LIMIT 1`,
        [templateId]
      );

      if (templateRows.length === 0) {
        throw new Error('Shift template not found');
      }

      const template = templateRows[0];

      // Get template skills
      const [skillRows] = await connection.execute<RowDataPacket[]>(
        'SELECT skill_id FROM shift_template_skills WHERE template_id = ?',
        [templateId]
      );

      const skillIds = skillRows.map((row: any) => row.skill_id);

      const createdShiftIds: number[] = [];
      const currentDate = new Date(startDate);

      while (currentDate <= endDate) {
        const dayOfWeek = currentDate.getDay();

        if (daysOfWeek.includes(dayOfWeek)) {
          // Create shift for this day
          const [result] = await connection.execute<ResultSetHeader>(
            `INSERT INTO shifts (
              schedule_id, department_id, template_id, date, start_time, end_time,
              min_staff, max_staff, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              scheduleId,
              template.department_id,
              templateId,
              currentDate.toISOString().split('T')[0],
              template.start_time,
              template.end_time,
              template.min_staff,
              template.max_staff,
              'open'
            ]
          );

          const shiftId = result.insertId;
          createdShiftIds.push(shiftId);

          // Add required skills
          for (const skillId of skillIds) {
            await connection.execute(
              'INSERT INTO shift_skills (shift_id, skill_id) VALUES (?, ?)',
              [shiftId, skillId]
            );
          }
        }

        currentDate.setDate(currentDate.getDate() + 1);
      }

      await connection.commit();

      logger.info(`Created ${createdShiftIds.length} shifts from template ${templateId}`);

      return createdShiftIds;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to create shifts from template:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Gets unassigned shifts (shifts with staff below minimum)
   * 
   * @param scheduleId - Optional schedule ID to filter
   * @returns Promise resolving to array of shifts
   */
  async getUnassignedShifts(scheduleId?: number): Promise<Shift[]> {
    try {
      let query = `
        SELECT 
          s.id, s.schedule_id, s.department_id, s.date, s.start_time, s.end_time,
          s.min_staff, s.max_staff, s.status, s.created_at,
          COUNT(DISTINCT sa.id) as assigned_staff,
          sch.name as schedule_name,
          d.name as department_name
        FROM shifts s
        LEFT JOIN schedules sch ON s.schedule_id = sch.id
        LEFT JOIN departments d ON s.department_id = d.id
        LEFT JOIN shift_assignments sa ON s.id = sa.shift_id AND sa.status IN ('pending', 'confirmed')
      `;

      const params: any[] = [];

      if (scheduleId) {
        query += ' WHERE s.schedule_id = ?';
        params.push(scheduleId);
      }

      query += ' GROUP BY s.id HAVING assigned_staff < s.min_staff ORDER BY s.date ASC, s.start_time ASC';

      const [rows] = await this.pool.execute<RowDataPacket[]>(query, params);

      return rows.map((row: any) => ({
        id: row.id,
        scheduleId: row.schedule_id,
        scheduleName: row.schedule_name,
        departmentId: row.department_id,
        departmentName: row.department_name,
        date: row.date,
        startTime: row.start_time,
        endTime: row.end_time,
        minStaff: row.min_staff,
        maxStaff: row.max_staff,
        assignedStaff: row.assigned_staff || 0,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.created_at
      }));
    } catch (error) {
      logger.error('Failed to get unassigned shifts:', error);
      throw error;
    }
  }

  /**
   * Gets shifts by date range
   * 
   * @param startDate - Start date
   * @param endDate - End date
   * @param departmentId - Optional department filter
   * @returns Promise resolving to array of shifts
   */
  async getShiftsByDateRange(
    startDate: string,
    endDate: string,
    departmentId?: number
  ): Promise<Shift[]> {
    return this.getAllShifts({
      startDate,
      endDate,
      departmentId
    });
  }

  /**
   * Gets shift statistics
   * 
   * @param scheduleId - Optional schedule ID to filter
   * @returns Promise resolving to statistics object
   */
  async getShiftStatistics(scheduleId?: number): Promise<{
    total: number;
    assigned: number;
    unassigned: number;
    fullyStaffed: number;
    understaffed: number;
    overstaffed: number;
  }> {
    try {
      const params: any[] = [];
      let whereClause = '';

      if (scheduleId) {
        whereClause = ' WHERE s.schedule_id = ?';
        params.push(scheduleId);
      }

      const [rows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN assigned_staff >= min_staff THEN 1 ELSE 0 END) as fully_staffed,
          SUM(CASE WHEN assigned_staff < min_staff THEN 1 ELSE 0 END) as understaffed,
          SUM(CASE WHEN assigned_staff > max_staff THEN 1 ELSE 0 END) as overstaffed,
          SUM(CASE WHEN assigned_staff > 0 THEN 1 ELSE 0 END) as assigned
        FROM (
          SELECT 
            s.id, s.min_staff, s.max_staff,
            COUNT(DISTINCT sa.id) as assigned_staff
          FROM shifts s
          LEFT JOIN shift_assignments sa ON s.id = sa.shift_id AND sa.status IN ('pending', 'confirmed')
          ${whereClause}
          GROUP BY s.id
        ) as shift_stats`,
        params
      );

      const stats = rows[0];

      return {
        total: stats.total || 0,
        assigned: stats.assigned || 0,
        unassigned: (stats.total || 0) - (stats.assigned || 0),
        fullyStaffed: stats.fully_staffed || 0,
        understaffed: stats.understaffed || 0,
        overstaffed: stats.overstaffed || 0
      };
    } catch (error) {
      logger.error('Failed to get shift statistics:', error);
      throw error;
    }
  }

  async getAllShiftTemplates(): Promise<any[]> {
    try {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        'SELECT * FROM shift_templates WHERE is_active = 1 ORDER BY name ASC'
      );
      return rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        departmentId: row.department_id,
        startTime: row.start_time,
        endTime: row.end_time,
        minStaff: row.min_staff,
        maxStaff: row.max_staff,
        isActive: Boolean(row.is_active),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
    } catch (error) {
      logger.error('Failed to get shift templates:', error);
      throw error;
    }
  }

  async getShiftTemplateById(id: number): Promise<any | null> {
    try {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        'SELECT * FROM shift_templates WHERE id = ? LIMIT 1',
        [id]
      );
      if (rows.length === 0) return null;
      const row = rows[0];
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        departmentId: row.department_id,
        startTime: row.start_time,
        endTime: row.end_time,
        minStaff: row.min_staff,
        maxStaff: row.max_staff,
        isActive: Boolean(row.is_active),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    } catch (error) {
      logger.error('Failed to get shift template:', error);
      throw error;
    }
  }

  async createShiftTemplate(templateData: any): Promise<any> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute<ResultSetHeader>(
        'INSERT INTO shift_templates (name, description, department_id, start_time, end_time, min_staff, max_staff) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [templateData.name, templateData.description || null, templateData.departmentId, templateData.startTime, templateData.endTime, templateData.minStaff, templateData.maxStaff]
      );
      await connection.commit();
      logger.info('Shift template created: ' + result.insertId);
      return this.getShiftTemplateById(result.insertId);
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to create shift template:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  async updateShiftTemplate(id: number, templateData: any): Promise<any> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const updates: string[] = [];
      const values: any[] = [];
      if (templateData.name !== undefined) {
        updates.push('name = ?');
        values.push(templateData.name);
      }
      if (templateData.description !== undefined) {
        updates.push('description = ?');
        values.push(templateData.description);
      }
      if (templateData.startTime !== undefined) {
        updates.push('start_time = ?');
        values.push(templateData.startTime);
      }
      if (templateData.endTime !== undefined) {
        updates.push('end_time = ?');
        values.push(templateData.endTime);
      }
      if (templateData.minStaff !== undefined) {
        updates.push('min_staff = ?');
        values.push(templateData.minStaff);
      }
      if (templateData.maxStaff !== undefined) {
        updates.push('max_staff = ?');
        values.push(templateData.maxStaff);
      }
      if (updates.length > 0) {
        values.push(id);
        await connection.execute(`UPDATE shift_templates SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, values);
      }
      await connection.commit();
      logger.info('Shift template updated: ' + id);
      return this.getShiftTemplateById(id);
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to update shift template:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  async deleteShiftTemplate(id: number): Promise<boolean> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute('UPDATE shift_templates SET is_active = 0 WHERE id = ?', [id]);
      await connection.commit();
      logger.info('Shift template deleted: ' + id);
      return true;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to delete shift template:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  async getShiftsBySchedule(scheduleId: number): Promise<Shift[]> {
    return this.getAllShifts({ scheduleId });
  }

  async getShiftsByDepartment(departmentId: number): Promise<Shift[]> {
    return this.getAllShifts({ departmentId });
  }
}
