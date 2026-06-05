import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { ShiftAssignment } from '../types';
import { logger } from '../config/logger';

export class AssignmentOrchestrator {
  constructor(private pool: Pool) {}

  private async fetchById(id: number): Promise<ShiftAssignment | null> {
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
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
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
  }

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
      if (result.affectedRows === 0) throw new Error('Assignment not found or already confirmed');
      await connection.commit();
      logger.info(`Assignment confirmed successfully: ${id}`);
      const confirmed = await this.fetchById(id);
      if (!confirmed) throw new Error('Assignment not found after confirmation');
      return confirmed;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to confirm assignment:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

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
      if (result.affectedRows === 0) throw new Error('Assignment not found or already cancelled');
      await connection.commit();
      logger.info(`Assignment cancelled successfully: ${id}`);
      const cancelled = await this.fetchById(id);
      if (!cancelled) throw new Error('Assignment not found after cancellation');
      return cancelled;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to cancel assignment:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  async declineAssignment(id: number): Promise<ShiftAssignment> {
    return this.cancelAssignment(id);
  }

  async completeAssignment(id: number): Promise<ShiftAssignment> {
    const connection = await this.pool.getConnection();
    try {
      const existing = await this.fetchById(id);
      if (!existing) throw new Error('Assignment not found');
      if (existing.status === 'completed') return existing;
      if (existing.status !== 'confirmed') throw new Error('Only confirmed assignments can be marked as completed');
      await connection.execute(
        'UPDATE shift_assignments SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        ['completed', id]
      );
      const updated = await this.fetchById(id);
      if (!updated) throw new Error('Failed to retrieve completed assignment');
      logger.info(`Assignment ${id} marked as completed`);
      return updated;
    } catch (error) {
      logger.error('Error completing assignment:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

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
      return {
        totalAssignments: total,
        pendingAssignments: stats.pending || 0,
        confirmedAssignments: stats.confirmed || 0,
        cancelledAssignments: stats.cancelled || 0,
        uniqueEmployees,
        averageAssignmentsPerEmployee: uniqueEmployees > 0 ? Math.round((total / uniqueEmployees) * 10) / 10 : 0
      };
    } catch (error) {
      logger.error('Failed to get assignment statistics:', error);
      throw error;
    }
  }

  async getAssignmentsByDepartment(departmentId: number, status?: string): Promise<ShiftAssignment[]> {
    try {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT
          sa.id, sa.shift_id AS shiftId, sa.user_id AS userId,
          sa.status, sa.assigned_by AS assignedBy, sa.notes,
          sa.created_at AS createdAt, sa.updated_at AS updatedAt,
          s.date AS shiftDate, s.start_time AS startTime, s.end_time AS endTime,
          s.department_id AS departmentId,
          u.first_name AS userFirstName, u.last_name AS userLastName
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

  async getAvailableEmployeesForShift(shiftId: number): Promise<Array<{ userId: number; firstName: string; lastName: string; email: string }>> {
    const connection = await this.pool.getConnection();
    try {
      const [shiftRows] = await connection.execute<RowDataPacket[]>(
        'SELECT id, date, start_time, end_time, department_id FROM shifts WHERE id = ?',
        [shiftId]
      );
      if (shiftRows.length === 0) throw new Error('Shift not found');
      const shift = shiftRows[0];
      const [userRows] = await connection.execute<RowDataPacket[]>(
        `SELECT DISTINCT u.id AS userId, u.first_name AS firstName, u.last_name AS lastName, u.email
        FROM users u
        INNER JOIN user_departments ud ON u.id = ud.user_id
        WHERE u.is_active = 1
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
        [shift.department_id, shift.date, shift.end_time, shift.start_time, shift.start_time, shift.end_time]
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
