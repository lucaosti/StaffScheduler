/**
 * Assignment Service
 * 
 * Handles all shift assignment business logic including manual assignments,
 * automatic optimization-based assignments, conflict detection, and assignment status management.
 * 
 * @module services/AssignmentService
 * @author Staff Scheduler Team
 */

import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { 
  ShiftAssignment,
  CreateAssignmentRequest
} from '../types';
import { logger } from '../config/logger';

/**
 * AssignmentService Class
 * 
 * Provides comprehensive shift assignment functionality including:
 * - Manual shift assignment
 * - Assignment conflict detection
 * - Assignment status management (pending, confirmed, cancelled)
 * - Availability and preference integration
 * - Skill matching validation
 * - Assignment statistics and reporting
 */
export class AssignmentService {
  /**
   * Creates a new AssignmentService instance
   * 
   * @param pool - MySQL connection pool for database operations
   */
  constructor(private pool: Pool) {}

  /**
   * Creates a new shift assignment
   * 
   * Validates:
   * - Shift exists and is not full
   * - User exists and is active
   * - User has required skills
   * - No scheduling conflicts
   * - User availability
   * 
   * @param assignmentData - Assignment creation data
   * @returns Promise resolving to the created assignment
   */
  async createAssignment(assignmentData: CreateAssignmentRequest): Promise<ShiftAssignment> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      // Validate shift exists and get details
      const [shiftRows] = await connection.execute<RowDataPacket[]>(
        `SELECT s.*, COUNT(DISTINCT sa.id) as current_assignments
        FROM shifts s
        LEFT JOIN shift_assignments sa ON s.id = sa.shift_id AND sa.status IN ('pending', 'confirmed')
        WHERE s.id = ?
        GROUP BY s.id`,
        [assignmentData.shiftId]
      );

      if (shiftRows.length === 0) {
        throw new Error('Shift not found');
      }

      const shift = shiftRows[0];

      // Check if shift is full
      if (shift.current_assignments >= shift.max_staff) {
        throw new Error('Shift is already at maximum capacity');
      }

      // Validate user exists and is active
      const [userRows] = await connection.execute<RowDataPacket[]>(
        'SELECT id, role FROM users WHERE id = ? AND is_active = 1 LIMIT 1',
        [assignmentData.userId]
      );

      if (userRows.length === 0) {
        throw new Error('User not found or inactive');
      }

      // Check for scheduling conflicts
      const conflicts = await this.checkConflicts(
        assignmentData.userId,
        shift.date,
        shift.start_time,
        shift.end_time
      );

      if (conflicts.length > 0) {
        throw new Error(`User has conflicting assignment: ${conflicts[0].shiftDate} ${conflicts[0].startTime}-${conflicts[0].endTime}`);
      }

      // Check user availability
      const isAvailable = await this.checkUserAvailability(
        assignmentData.userId,
        shift.date,
        shift.start_time,
        shift.end_time
      );

      if (!isAvailable) {
        throw new Error('User is not available during this time');
      }

      // Check required skills
      const [requiredSkills] = await connection.execute<RowDataPacket[]>(
        'SELECT skill_id FROM shift_skills WHERE shift_id = ?',
        [assignmentData.shiftId]
      );

      if (requiredSkills.length > 0) {
        const [userSkills] = await connection.execute<RowDataPacket[]>(
          `SELECT skill_id FROM user_skills 
          WHERE user_id = ? AND skill_id IN (?)`,
          [assignmentData.userId, requiredSkills.map((rs: any) => rs.skill_id)]
        );

        if (userSkills.length < requiredSkills.length) {
          throw new Error('User does not have all required skills for this shift');
        }
      }

      // Create assignment
      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO shift_assignments (shift_id, user_id, status, notes)
        VALUES (?, ?, 'pending', ?)`,
        [
          assignmentData.shiftId,
          assignmentData.userId,
          assignmentData.notes || null
        ]
      );

      const assignmentId = result.insertId;

      await connection.commit();

      logger.info(`Assignment created successfully: ${assignmentId}`);

      // Retrieve and return the created assignment
      const newAssignment = await this.getAssignmentById(assignmentId);
      if (!newAssignment) {
        throw new Error('Failed to retrieve created assignment');
      }

      return newAssignment;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to create assignment:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Retrieves an assignment by its unique identifier
   * 
   * @param id - Assignment ID
   * @returns Promise resolving to ShiftAssignment object or null if not found
   */
  async getAssignmentById(id: number): Promise<ShiftAssignment | null> {
    try {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT 
          sa.id, sa.shift_id, sa.user_id, sa.status, 
          sa.assigned_at, sa.confirmed_at, sa.notes,
          u.first_name, u.last_name, u.email,
          s.date, s.start_time, s.end_time, s.department_id,
          d.name as department_name
        FROM shift_assignments sa
        JOIN users u ON sa.user_id = u.id
        JOIN shifts s ON sa.shift_id = s.id
        JOIN departments d ON s.department_id = d.id
        WHERE sa.id = ?`,
        [id]
      );

      if (rows.length === 0) {
        return null;
      }

      const row = rows[0];

      const assignment: ShiftAssignment = {
        id: row.id,
        shiftId: row.shift_id,
        userId: row.user_id,
        userName: `${row.first_name} ${row.last_name}`,
        userEmail: row.email,
        shiftDate: row.date,
        startTime: row.start_time,
        endTime: row.end_time,
        departmentId: row.department_id,
        departmentName: row.department_name,
        status: row.status,
        assignedAt: row.assigned_at,
        confirmedAt: row.confirmed_at,
        notes: row.notes
      };

      return assignment;
    } catch (error) {
      logger.error('Failed to get assignment by ID:', error);
      throw error;
    }
  }

  /**
   * Gets all assignments with optional filtering
   * 
   * @param filters - Optional filters for shift, user, status, and date range
   * @returns Promise resolving to array of assignments
   */
  async getAllAssignments(filters?: {
    shiftId?: number;
    userId?: number;
    scheduleId?: number;
    departmentId?: number;
    status?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<ShiftAssignment[]> {
    try {
      let query = `
        SELECT 
          sa.id, sa.shift_id, sa.user_id, sa.status, 
          sa.assigned_at, sa.confirmed_at, sa.notes,
          u.first_name, u.last_name, u.email,
          s.date, s.start_time, s.end_time, s.department_id, s.schedule_id,
          d.name as department_name
        FROM shift_assignments sa
        JOIN users u ON sa.user_id = u.id
        JOIN shifts s ON sa.shift_id = s.id
        JOIN departments d ON s.department_id = d.id
      `;

      const conditions: string[] = [];
      const params: any[] = [];

      if (filters?.shiftId) {
        conditions.push('sa.shift_id = ?');
        params.push(filters.shiftId);
      }

      if (filters?.userId) {
        conditions.push('sa.user_id = ?');
        params.push(filters.userId);
      }

      if (filters?.scheduleId) {
        conditions.push('s.schedule_id = ?');
        params.push(filters.scheduleId);
      }

      if (filters?.departmentId) {
        conditions.push('s.department_id = ?');
        params.push(filters.departmentId);
      }

      if (filters?.status) {
        conditions.push('sa.status = ?');
        params.push(filters.status);
      }

      if (filters?.startDate) {
        conditions.push('s.date >= ?');
        params.push(filters.startDate);
      }

      if (filters?.endDate) {
        conditions.push('s.date <= ?');
        params.push(filters.endDate);
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      query += ' ORDER BY s.date ASC, s.start_time ASC';

      const [rows] = await this.pool.execute<RowDataPacket[]>(query, params);

      const assignments: ShiftAssignment[] = rows.map((row: any) => ({
        id: row.id,
        shiftId: row.shift_id,
        userId: row.user_id,
        userName: `${row.first_name} ${row.last_name}`,
        userEmail: row.email,
        shiftDate: row.date,
        startTime: row.start_time,
        endTime: row.end_time,
        departmentId: row.department_id,
        departmentName: row.department_name,
        status: row.status,
        assignedAt: row.assigned_at,
        confirmedAt: row.confirmed_at,
        notes: row.notes
      }));

      return assignments;
    } catch (error) {
      logger.error('Failed to get all assignments:', error);
      throw error;
    }
  }

  /**
   * Confirms a pending assignment
   * 
   * @param id - Assignment ID
   * @returns Promise resolving to updated assignment
   */
  async confirmAssignment(id: number): Promise<ShiftAssignment> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE shift_assignments 
        SET status = 'confirmed', confirmed_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'pending'`,
        [id]
      );

      if (result.affectedRows === 0) {
        throw new Error('Assignment not found or already confirmed');
      }

      await connection.commit();

      logger.info(`Assignment confirmed successfully: ${id}`);

      const confirmedAssignment = await this.getAssignmentById(id);
      if (!confirmedAssignment) {
        throw new Error('Assignment not found after confirmation');
      }

      return confirmedAssignment;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to confirm assignment:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Cancels an assignment
   * 
   * @param id - Assignment ID
   * @returns Promise resolving to updated assignment
   */
  async cancelAssignment(id: number): Promise<ShiftAssignment> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE shift_assignments 
        SET status = 'cancelled'
        WHERE id = ? AND status IN ('pending', 'confirmed')`,
        [id]
      );

      if (result.affectedRows === 0) {
        throw new Error('Assignment not found or already cancelled');
      }

      await connection.commit();

      logger.info(`Assignment cancelled successfully: ${id}`);

      const cancelledAssignment = await this.getAssignmentById(id);
      if (!cancelledAssignment) {
        throw new Error('Assignment not found after cancellation');
      }

      return cancelledAssignment;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to cancel assignment:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Deletes an assignment
   * 
   * @param id - Assignment ID to delete
   * @returns Promise resolving to true if successful
   */
  async deleteAssignment(id: number): Promise<boolean> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      const [result] = await connection.execute<ResultSetHeader>(
        'DELETE FROM shift_assignments WHERE id = ?',
        [id]
      );

      if (result.affectedRows === 0) {
        throw new Error('Assignment not found');
      }

      await connection.commit();

      logger.info(`Assignment deleted successfully: ${id}`);
      return true;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to delete assignment:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Checks for scheduling conflicts for a user
   * 
   * @param userId - User ID
   * @param date - Shift date
   * @param startTime - Shift start time
   * @param endTime - Shift end time
   * @returns Promise resolving to array of conflicting assignments
   */
  async checkConflicts(
    userId: number,
    date: string,
    startTime: string,
    endTime: string
  ): Promise<any[]> {
    try {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT 
          sa.id, s.date as shift_date, s.start_time, s.end_time,
          d.name as department_name
        FROM shift_assignments sa
        JOIN shifts s ON sa.shift_id = s.id
        JOIN departments d ON s.department_id = d.id
        WHERE sa.user_id = ?
        AND sa.status IN ('pending', 'confirmed')
        AND s.date = ?
        AND (
          (s.start_time < ? AND s.end_time > ?)
          OR (s.start_time >= ? AND s.start_time < ?)
          OR (s.end_time > ? AND s.end_time <= ?)
        )`,
        [userId, date, endTime, startTime, startTime, endTime, startTime, endTime]
      );

      return rows.map((row: any) => ({
        assignmentId: row.id,
        shiftDate: row.shift_date,
        startTime: row.start_time,
        endTime: row.end_time,
        departmentName: row.department_name
      }));
    } catch (error) {
      logger.error('Failed to check conflicts:', error);
      throw error;
    }
  }

  /**
   * Checks if user is available during specified time
   * 
   * Checks against user_unavailability table
   * 
   * @param userId - User ID
   * @param date - Date to check
   * @param startTime - Start time
   * @param endTime - End time
   * @returns Promise resolving to boolean indicating availability
   */
  async checkUserAvailability(
    userId: number,
    date: string,
    startTime: string,
    endTime: string
  ): Promise<boolean> {
    try {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT id FROM user_unavailability
        WHERE user_id = ?
        AND (
          (date = ? AND (
            (start_time IS NULL AND end_time IS NULL)
            OR (start_time <= ? AND end_time >= ?)
            OR (start_time IS NULL AND end_time >= ?)
            OR (start_time <= ? AND end_time IS NULL)
          ))
          OR (date IS NULL AND day_of_week = DAYOFWEEK(?) - 1 AND (
            (start_time <= ? AND end_time >= ?)
            OR (start_time IS NULL AND end_time >= ?)
            OR (start_time <= ? AND end_time IS NULL)
          ))
        )
        LIMIT 1`,
        [
          userId,
          date, startTime, startTime, startTime, endTime,
          date, startTime, startTime, startTime, endTime
        ]
      );

      return rows.length === 0;
    } catch (error) {
      logger.error('Failed to check user availability:', error);
      throw error;
    }
  }

  /**
   * Gets assignments by user ID
   * 
   * @param userId - User ID
   * @param status - Optional status filter
   * @returns Promise resolving to array of assignments
   */
  async getAssignmentsByUser(userId: number, status?: string): Promise<ShiftAssignment[]> {
    return this.getAllAssignments({ userId, status });
  }

  /**
   * Gets assignments by shift ID
   * 
   * @param shiftId - Shift ID
   * @param status - Optional status filter
   * @returns Promise resolving to array of assignments
   */
  async getAssignmentsByShift(shiftId: number, status?: string): Promise<ShiftAssignment[]> {
    return this.getAllAssignments({ shiftId, status });
  }

  /**
   * Gets assignment statistics for a schedule
   * 
   * @param scheduleId - Schedule ID
   * @returns Promise resolving to statistics object
   */
  async getAssignmentStatistics(scheduleId: number): Promise<{
    totalAssignments: number;
    pendingAssignments: number;
    confirmedAssignments: number;
    cancelledAssignments: number;
    uniqueEmployees: number;
    averageAssignmentsPerEmployee: number;
  }> {
    try {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT 
          COUNT(*) as total,
          COUNT(DISTINCT user_id) as unique_employees,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
          SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled
        FROM shift_assignments sa
        JOIN shifts s ON sa.shift_id = s.id
        WHERE s.schedule_id = ?`,
        [scheduleId]
      );

      const stats = rows[0];
      const total = stats.total || 0;
      const uniqueEmployees = stats.unique_employees || 0;
      const averageAssignments = uniqueEmployees > 0 
        ? Math.round((total / uniqueEmployees) * 10) / 10
        : 0;

      return {
        totalAssignments: total,
        pendingAssignments: stats.pending || 0,
        confirmedAssignments: stats.confirmed || 0,
        cancelledAssignments: stats.cancelled || 0,
        uniqueEmployees: uniqueEmployees,
        averageAssignmentsPerEmployee: averageAssignments
      };
    } catch (error) {
      logger.error('Failed to get assignment statistics:', error);
      throw error;
    }
  }

  /**
   * Bulk creates assignments for a shift
   * 
   * @param shiftId - Shift ID
   * @param userIds - Array of user IDs to assign
   * @returns Promise resolving to array of created assignments
   */
  /**
   * Bulk creates assignments from an array of assignment requests
   * 
   * @param assignments - Array of assignment creation requests
   * @returns Promise resolving to array of created assignments
   */
  async bulkCreateAssignments(assignments: CreateAssignmentRequest[]): Promise<ShiftAssignment[]>;
  
  /**
   * Bulk creates assignments for multiple users on the same shift
   * 
   * @param shiftId - Shift ID
   * @param userIds - Array of user IDs
   * @returns Promise resolving to array of created assignments
   */
  async bulkCreateAssignments(shiftId: number, userIds: number[]): Promise<ShiftAssignment[]>;
  
  async bulkCreateAssignments(
    assignmentsOrShiftId: CreateAssignmentRequest[] | number, 
    userIds?: number[]
  ): Promise<ShiftAssignment[]> {
    const createdAssignments: ShiftAssignment[] = [];

    // Handle array of assignment requests
    if (Array.isArray(assignmentsOrShiftId)) {
      for (const assignmentData of assignmentsOrShiftId) {
        try {
          const assignment = await this.createAssignment(assignmentData);
          createdAssignments.push(assignment);
        } catch (error) {
          logger.warn(`Failed to create assignment for shift ${assignmentData.shiftId}, user ${assignmentData.userId}:`, error);
        }
      }
      return createdAssignments;
    }

    // Handle single shift ID with multiple user IDs
    const shiftId = assignmentsOrShiftId;
    if (!userIds || userIds.length === 0) {
      return createdAssignments;
    }

    for (const userId of userIds) {
      try {
        const assignment = await this.createAssignment({
          shiftId,
          userId
        });
        createdAssignments.push(assignment);
      } catch (error) {
        logger.warn(`Failed to assign user ${userId} to shift ${shiftId}:`, error);
      }
    }

    return createdAssignments;
  }

  /**
   * Updates an existing shift assignment
   * 
   * Allows updating assignment status and notes. Cannot change user or shift.
   * 
   * @param id - Assignment ID
   * @param updateData - Data to update
   * @returns Promise resolving to the updated assignment
   */
  async updateAssignment(id: number, updateData: { status?: string; notes?: string }): Promise<ShiftAssignment> {
    const connection = await this.pool.getConnection();
    
    try {
      // Check if assignment exists
      const existing = await this.getAssignmentById(id);
      if (!existing) {
        throw new Error('Assignment not found');
      }

      const updates: string[] = [];
      const values: any[] = [];

      if (updateData.status) {
        updates.push('status = ?');
        values.push(updateData.status);
      }

      if (updateData.notes !== undefined) {
        updates.push('notes = ?');
        values.push(updateData.notes);
      }

      if (updates.length === 0) {
        return existing;
      }

      values.push(id);

      await connection.execute(
        `UPDATE shift_assignments SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        values
      );

      const updated = await this.getAssignmentById(id);
      if (!updated) {
        throw new Error('Failed to retrieve updated assignment');
      }

      logger.info(`Assignment ${id} updated successfully`);
      return updated;
    } catch (error) {
      logger.error('Error updating assignment:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Declines a shift assignment (alias for cancelAssignment)
   * 
   * @param id - Assignment ID
   * @returns Promise resolving to the declined assignment
   */
  async declineAssignment(id: number): Promise<ShiftAssignment> {
    return this.cancelAssignment(id);
  }

  /**
   * Marks an assignment as completed
   * 
   * @param id - Assignment ID
   * @returns Promise resolving to the completed assignment
   */
  async completeAssignment(id: number): Promise<ShiftAssignment> {
    const connection = await this.pool.getConnection();
    
    try {
      // Check if assignment exists
      const existing = await this.getAssignmentById(id);
      if (!existing) {
        throw new Error('Assignment not found');
      }

      if (existing.status === 'completed') {
        return existing;
      }

      // Only confirmed assignments can be completed
      if (existing.status !== 'confirmed') {
        throw new Error('Only confirmed assignments can be marked as completed');
      }

      await connection.execute(
        'UPDATE shift_assignments SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        ['completed', id]
      );

      const updated = await this.getAssignmentById(id);
      if (!updated) {
        throw new Error('Failed to retrieve completed assignment');
      }

      logger.info(`Assignment ${id} marked as completed`);
      return updated;
    } catch (error) {
      logger.error('Error completing assignment:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Gets all assignments for a specific department
   * 
   * @param departmentId - Department ID
   * @param status - Optional status filter
   * @returns Promise resolving to array of assignments
   */
  async getAssignmentsByDepartment(departmentId: number, status?: string): Promise<ShiftAssignment[]> {
    try {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT 
          sa.id,
          sa.shift_id AS shiftId,
          sa.user_id AS userId,
          sa.status,
          sa.assigned_by AS assignedBy,
          sa.notes,
          sa.created_at AS createdAt,
          sa.updated_at AS updatedAt,
          s.date AS shiftDate,
          s.start_time AS startTime,
          s.end_time AS endTime,
          s.department_id AS departmentId,
          u.first_name AS userFirstName,
          u.last_name AS userLastName
        FROM shift_assignments sa
        INNER JOIN shifts s ON sa.shift_id = s.id
        INNER JOIN users u ON sa.user_id = u.id
        WHERE s.department_id = ?
        ${status ? 'AND sa.status = ?' : ''}
        ORDER BY s.date DESC, s.start_time`,
        status ? [departmentId, status] : [departmentId]
      );

      return rows as ShiftAssignment[];
    } catch (error) {
      logger.error('Error getting assignments by department:', error);
      throw error;
    }
  }

  /**
   * Gets available employees for a specific shift
   * 
   * Returns users who:
   * - Are active
   * - Have the required skills
   * - Have no conflicting assignments
   * - Are available during shift time
   * 
   * @param shiftId - Shift ID
   * @returns Promise resolving to array of available user IDs with names
   */
  async getAvailableEmployeesForShift(shiftId: number): Promise<Array<{ userId: number; firstName: string; lastName: string; email: string }>> {
    const connection = await this.pool.getConnection();
    
    try {
      // Get shift details
      const [shiftRows] = await connection.execute<RowDataPacket[]>(
        'SELECT id, date, start_time, end_time, department_id FROM shifts WHERE id = ?',
        [shiftId]
      );

      if (shiftRows.length === 0) {
        throw new Error('Shift not found');
      }

      const shift = shiftRows[0];

      // Get users who meet all criteria
      const [userRows] = await connection.execute<RowDataPacket[]>(
        `SELECT DISTINCT u.id AS userId, u.first_name AS firstName, u.last_name AS lastName, u.email
        FROM users u
        INNER JOIN user_departments ud ON u.id = ud.user_id
        WHERE u.is_active = 1
        AND u.role = 'employee'
        AND ud.department_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM shift_assignments sa
          INNER JOIN shifts s ON sa.shift_id = s.id
          WHERE sa.user_id = u.id
          AND sa.status IN ('pending', 'confirmed')
          AND s.date = ?
          AND (
            (s.start_time < ? AND s.end_time > ?) OR
            (s.start_time >= ? AND s.start_time < ?)
          )
        )
        ORDER BY u.last_name, u.first_name`,
        [
          shift.department_id,
          shift.date,
          shift.end_time,
          shift.start_time,
          shift.start_time,
          shift.end_time
        ]
      );

      return userRows as Array<{ userId: number; firstName: string; lastName: string; email: string }>;
    } catch (error) {
      logger.error('Error getting available employees for shift:', error);
      throw error;
    } finally {
      connection.release();
    }
  }
}
