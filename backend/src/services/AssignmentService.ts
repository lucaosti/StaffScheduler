import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { ShiftAssignment, CreateAssignmentRequest } from '../types';
import { logger } from '../config/logger';
import { evaluateAssignmentCompliance } from './ComplianceEngine';
import { PolicyValidator } from './PolicyValidator';
import { AssignmentValidator } from './AssignmentValidator';
import { AssignmentOrchestrator } from './AssignmentOrchestrator';

export class AssignmentService {
  private policyValidator: PolicyValidator;
  private validator: AssignmentValidator;
  private orchestrator: AssignmentOrchestrator;

  constructor(private pool: Pool) {
    this.policyValidator = new PolicyValidator(pool);
    this.validator = new AssignmentValidator(pool);
    this.orchestrator = new AssignmentOrchestrator(pool);
  }

  async createAssignment(assignmentData: CreateAssignmentRequest): Promise<ShiftAssignment> {
    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();

      const [shiftRows] = await connection.execute<RowDataPacket[]>(
        `SELECT s.*, COUNT(DISTINCT sa.id) as current_assignments
        FROM shifts s
        LEFT JOIN shift_assignments sa ON s.id = sa.shift_id AND sa.status IN ('pending', 'confirmed')
        WHERE s.id = ?
        GROUP BY s.id`,
        [assignmentData.shiftId]
      );

      if (shiftRows.length === 0) throw new Error('Shift not found');

      const shift = shiftRows[0];

      if (shift.current_assignments >= shift.max_staff) throw new Error('Shift is already at maximum capacity');

      const [userRows] = await connection.execute<RowDataPacket[]>(
        'SELECT id, role FROM users WHERE id = ? AND is_active = 1 LIMIT 1',
        [assignmentData.userId]
      );

      if (userRows.length === 0) throw new Error('User not found or inactive');

      const conflicts = await this.validator.checkConflicts(
        assignmentData.userId,
        shift.date,
        shift.start_time,
        shift.end_time
      );

      if (conflicts.length > 0) {
        throw new Error(`User has conflicting assignment: ${conflicts[0].shiftDate} ${conflicts[0].startTime}-${conflicts[0].endTime}`);
      }

      const isAvailable = await this.validator.checkUserAvailability(
        assignmentData.userId,
        shift.date,
        shift.start_time,
        shift.end_time
      );

      if (!isAvailable) throw new Error('User is not available during this time');

      const [requiredSkills] = await connection.execute<RowDataPacket[]>(
        'SELECT skill_id FROM shift_skills WHERE shift_id = ?',
        [assignmentData.shiftId]
      );

      // If the shift requires skills, verify the user holds all of them.
      // execute() uses prepared statements that do not expand arrays, so
      // placeholders are built manually. When skillIds is empty the check
      // is skipped entirely — no skills required means no restriction.
      const skillIds = requiredSkills.map((rs: any) => rs.skill_id);
      if (skillIds.length > 0) {
        const placeholders = skillIds.map(() => '?').join(', ');
        const [userSkills] = await connection.execute<RowDataPacket[]>(
          `SELECT skill_id FROM user_skills WHERE user_id = ? AND skill_id IN (${placeholders})`,
          [assignmentData.userId, ...skillIds]
        );
        if ((userSkills as RowDataPacket[]).length < requiredSkills.length) {
          throw new Error('User does not have all required skills for this shift');
        }
      }

      // Block the assignment if it would exceed configured compliance limits.
      const compliance = await evaluateAssignmentCompliance(this.pool, assignmentData.userId, {
        date:
          typeof shift.date === 'string'
            ? shift.date
            : new Date(shift.date).toISOString().slice(0, 10),
        startTime: shift.start_time,
        endTime: shift.end_time,
      });
      if (!compliance.ok) {
        const head = compliance.violations[0];
        const err = new Error(`Compliance violation: ${head.message}`) as Error & {
          code?: string;
          violations?: typeof compliance.violations;
        };
        err.code = `COMPLIANCE_${head.code}`;
        err.violations = compliance.violations;
        throw err;
      }

      const policyValidation = await this.policyValidator.validateAssignment({
        userId: assignmentData.userId,
        shiftId: assignmentData.shiftId,
      });
      if (!policyValidation.ok) {
        const blocking = policyValidation.violations.filter((v) => !v.hasApprovedException);
        const head = blocking[0];
        const err = new Error(`Policy violation: ${head?.message ?? 'Blocked by policy'}`) as Error & {
          code?: string;
          violations?: typeof policyValidation.violations;
        };
        err.code = `POLICY_${head?.policyKey ?? 'VIOLATION'}`.toUpperCase();
        err.violations = policyValidation.violations;
        throw err;
      }

      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO shift_assignments (shift_id, user_id, status, notes)
        VALUES (?, ?, 'pending', ?)`,
        [assignmentData.shiftId, assignmentData.userId, assignmentData.notes || null]
      );

      const assignmentId = result.insertId;
      await connection.commit();
      logger.info(`Assignment created successfully: ${assignmentId}`);

      const newAssignment = await this.getAssignmentById(assignmentId);
      if (!newAssignment) throw new Error('Failed to retrieve created assignment');
      return newAssignment;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to create assignment:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

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
    } catch (error) {
      logger.error('Failed to get assignment by ID:', error);
      throw error;
    }
  }

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

      if (filters?.shiftId) { conditions.push('sa.shift_id = ?'); params.push(filters.shiftId); }
      if (filters?.userId) { conditions.push('sa.user_id = ?'); params.push(filters.userId); }
      if (filters?.scheduleId) { conditions.push('s.schedule_id = ?'); params.push(filters.scheduleId); }
      if (filters?.departmentId) { conditions.push('s.department_id = ?'); params.push(filters.departmentId); }
      if (filters?.status) { conditions.push('sa.status = ?'); params.push(filters.status); }
      if (filters?.startDate) { conditions.push('s.date >= ?'); params.push(filters.startDate); }
      if (filters?.endDate) { conditions.push('s.date <= ?'); params.push(filters.endDate); }

      if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
      query += ' ORDER BY s.date ASC, s.start_time ASC';

      const [rows] = await this.pool.execute<RowDataPacket[]>(query, params);

      return rows.map((row: any) => ({
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
    } catch (error) {
      logger.error('Failed to get all assignments:', error);
      throw error;
    }
  }

  async deleteAssignment(id: number): Promise<boolean> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute<ResultSetHeader>(
        'DELETE FROM shift_assignments WHERE id = ?',
        [id]
      );
      if (result.affectedRows === 0) throw new Error('Assignment not found');
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

  async updateAssignment(id: number, updateData: { status?: string; notes?: string }): Promise<ShiftAssignment> {
    const connection = await this.pool.getConnection();
    try {
      const existing = await this.getAssignmentById(id);
      if (!existing) throw new Error('Assignment not found');

      const updates: string[] = [];
      const values: any[] = [];

      if (updateData.status) { updates.push('status = ?'); values.push(updateData.status); }
      if (updateData.notes !== undefined) { updates.push('notes = ?'); values.push(updateData.notes); }

      if (updates.length === 0) return existing;

      values.push(id);
      await connection.execute(
        `UPDATE shift_assignments SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        values
      );

      const updated = await this.getAssignmentById(id);
      if (!updated) throw new Error('Failed to retrieve updated assignment');
      logger.info(`Assignment ${id} updated successfully`);
      return updated;
    } catch (error) {
      logger.error('Error updating assignment:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  async getAssignmentsByUser(userId: number, status?: string): Promise<ShiftAssignment[]> {
    return this.getAllAssignments({ userId, status });
  }

  async getAssignmentsByShift(shiftId: number, status?: string): Promise<ShiftAssignment[]> {
    return this.getAllAssignments({ shiftId, status });
  }

  async bulkCreateAssignments(
    assignmentsOrShiftId: CreateAssignmentRequest[] | number,
    userIds?: number[]
  ): Promise<ShiftAssignment[]> {
    const created: ShiftAssignment[] = [];

    if (Array.isArray(assignmentsOrShiftId)) {
      for (const data of assignmentsOrShiftId) {
        try {
          created.push(await this.createAssignment(data));
        } catch (error) {
          logger.warn(`Failed to create assignment for shift ${data.shiftId}, user ${data.userId}:`, error);
        }
      }
      return created;
    }

    const shiftId = assignmentsOrShiftId;
    if (!userIds || userIds.length === 0) return created;

    for (const userId of userIds) {
      try {
        created.push(await this.createAssignment({ shiftId, userId }));
      } catch (error) {
        logger.warn(`Failed to assign user ${userId} to shift ${shiftId}:`, error);
      }
    }
    return created;
  }

  // ── Delegated to AssignmentValidator ──────────────────────────────────────

  async checkConflicts(userId: number, date: string, startTime: string, endTime: string): Promise<any[]> {
    return this.validator.checkConflicts(userId, date, startTime, endTime);
  }

  async checkUserAvailability(userId: number, date: string, startTime: string, endTime: string): Promise<boolean> {
    return this.validator.checkUserAvailability(userId, date, startTime, endTime);
  }

  // ── Delegated to AssignmentOrchestrator ───────────────────────────────────

  async confirmAssignment(id: number): Promise<ShiftAssignment> {
    return this.orchestrator.confirmAssignment(id);
  }

  async cancelAssignment(id: number): Promise<ShiftAssignment> {
    return this.orchestrator.cancelAssignment(id);
  }

  async declineAssignment(id: number): Promise<ShiftAssignment> {
    return this.orchestrator.declineAssignment(id);
  }

  async completeAssignment(id: number): Promise<ShiftAssignment> {
    return this.orchestrator.completeAssignment(id);
  }

  async getAssignmentStatistics(scheduleId: number): Promise<{
    totalAssignments: number;
    pendingAssignments: number;
    confirmedAssignments: number;
    cancelledAssignments: number;
    uniqueEmployees: number;
    averageAssignmentsPerEmployee: number;
  }> {
    return this.orchestrator.getAssignmentStatistics(scheduleId);
  }

  async getAssignmentsByDepartment(departmentId: number, status?: string): Promise<ShiftAssignment[]> {
    return this.orchestrator.getAssignmentsByDepartment(departmentId, status);
  }

  async getAvailableEmployeesForShift(shiftId: number): Promise<Array<{ userId: number; firstName: string; lastName: string; email: string }>> {
    return this.orchestrator.getAvailableEmployeesForShift(shiftId);
  }
}
