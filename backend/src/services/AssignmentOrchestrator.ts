/**
 * Assignment lifecycle SQL and read-only aggregates over `shift_assignments`.
 *
 * Extracted from `AssignmentService` — see that file for why the seam is drawn
 * here. The short version: this class owns the status transitions and the
 * reporting queries, and is deliberately ACTOR-UNAWARE. Its methods take an id;
 * nothing here knows or asks who is acting, and nothing here writes an audit
 * row. `AssignmentService` supplies both.
 *
 * WHY EACH TRANSITION GUARDS ON THE CURRENT STATUS IN THE `WHERE` CLAUSE
 * (`... WHERE id = ? AND status = 'pending'`) RATHER THAN READING THEN
 * WRITING. Read-check-write is racy: two concurrent confirmations both read
 * `pending` and both write, and the second silently succeeds. Folding the
 * precondition into the UPDATE makes the check and the write one atomic
 * statement, so `affectedRows === 0` is an unambiguous "the assignment was not
 * in a state this transition applies to" — reported as `NotFoundError` rather
 * than a false success. The same reasoning is why `pending_approvals` keeps its
 * raw `WHERE status = 'pending'` guard alongside the ApprovalStateMachine.
 *
 * `declineAssignment` deliberately delegates to `cancelAssignment`: declining
 * and cancelling reach the same terminal state and the same row shape. They are
 * kept as separate entry points because the CALLER's intent differs (the
 * employee refused vs a manager withdrew it), and that distinction is preserved
 * where it matters — in the audit action the service records — rather than by
 * duplicating identical SQL here.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { ShiftAssignment } from '../types';
import { ConflictError, NotFoundError } from '../errors';
import { logger } from '../config/logger';
import { EmployeeLoanService } from './EmployeeLoanService';
import { inClause } from '../utils/sql';
import { DateUtils } from '../utils';

export class AssignmentOrchestrator {
  private loans: EmployeeLoanService;

  constructor(private pool: Pool) {
    this.loans = new EmployeeLoanService(pool);
  }

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
      if (result.affectedRows === 0) throw new NotFoundError('Assignment not found or already confirmed');
      await connection.commit();
      logger.info(`Assignment confirmed successfully: ${id}`);
      const confirmed = await this.fetchById(id);
      if (!confirmed) throw new NotFoundError('Assignment not found after confirmation');
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
      if (result.affectedRows === 0) throw new NotFoundError('Assignment not found or already cancelled');
      await connection.commit();
      logger.info(`Assignment cancelled successfully: ${id}`);
      const cancelled = await this.fetchById(id);
      if (!cancelled) throw new NotFoundError('Assignment not found after cancellation');
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
      if (!existing) throw new NotFoundError('Assignment not found');
      if (existing.status === 'completed') return existing;
      if (existing.status !== 'confirmed') throw new ConflictError('Only confirmed assignments can be marked as completed');
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
        `SELECT s.id, s.date, s.start_time, s.end_time, s.department_id, d.org_unit_id
           FROM shifts s
           JOIN departments d ON d.id = s.department_id
          WHERE s.id = ?`,
        [shiftId]
      );
      if (shiftRows.length === 0) throw new NotFoundError('Shift not found');
      const shift = shiftRows[0];
      const shiftDate = DateUtils.toDateString(shift.date as string | Date);

      // Department members, PLUS anyone on an approved loan into the
      // department's org unit for this shift's date — see EmployeeLoanService.
      // A department with no `org_unit_id` bridge has no loan pool to add.
      const orgUnitId = shift.org_unit_id as number | null;
      const loanedInUserIds = orgUnitId
        ? await this.loans.listLoanedInUserIds(orgUnitId, shiftDate, shiftDate)
        : [];
      const loanedInCondition =
        loanedInUserIds.length > 0
          ? `(ud.department_id IS NOT NULL OR u.id IN (${inClause(loanedInUserIds)}))`
          : `ud.department_id IS NOT NULL`;

      const [userRows] = await connection.execute<RowDataPacket[]>(
        `SELECT DISTINCT u.id AS userId, u.first_name AS firstName, u.last_name AS lastName, u.email
        FROM users u
        LEFT JOIN user_departments ud ON u.id = ud.user_id AND ud.department_id = ?
        WHERE u.is_active = 1
        AND ${loanedInCondition}
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
