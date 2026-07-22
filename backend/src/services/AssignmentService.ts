import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { ShiftAssignment, CreateAssignmentRequest } from '../types';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { logger } from '../config/logger';
import { evaluateAssignmentCompliance } from './ComplianceEngine';
import { PolicyValidator } from './PolicyValidator';
import { AssignmentValidator } from './AssignmentValidator';
import { AssignmentOrchestrator } from './AssignmentOrchestrator';
import { AuditLogService } from './AuditLogService';
import { DateUtils } from '../utils';

/** Filters accepted by the assignment listing, mirrored by the route's query schema. */
export interface AssignmentFilters {
  shiftId?: number;
  userId?: number;
  scheduleId?: number;
  departmentId?: number;
  status?: string;
  startDate?: string;
  endDate?: string;
}

/**
 * Rows an unpaginated listing may return before it refuses. Chosen to be large
 * enough for any plausible single-department, single-period view and far below
 * the point where the four-way join becomes a memory problem.
 */
const MAX_UNPAGINATED_ROWS = 5000;

/**
 * Builds the shared WHERE clause for the list and count queries.
 *
 * Both must apply exactly the same predicates, or the pagination envelope
 * reports a total that does not match the rows returned. Deriving them from one
 * function makes that impossible rather than merely unlikely.
 */
const buildAssignmentFilters = (
  filters?: AssignmentFilters
): { where: string; params: (string | number)[] } => {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters?.shiftId) { conditions.push('sa.shift_id = ?'); params.push(filters.shiftId); }
  if (filters?.userId) { conditions.push('sa.user_id = ?'); params.push(filters.userId); }
  if (filters?.scheduleId) { conditions.push('s.schedule_id = ?'); params.push(filters.scheduleId); }
  if (filters?.departmentId) { conditions.push('s.department_id = ?'); params.push(filters.departmentId); }
  if (filters?.status) { conditions.push('sa.status = ?'); params.push(filters.status); }
  if (filters?.startDate) { conditions.push('s.date >= ?'); params.push(filters.startDate); }
  if (filters?.endDate) { conditions.push('s.date <= ?'); params.push(filters.endDate); }

  return { where: conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '', params };
};

export class AssignmentService {
  private policyValidator: PolicyValidator;
  private validator: AssignmentValidator;
  private orchestrator: AssignmentOrchestrator;
  private audit: AuditLogService;

  constructor(private pool: Pool) {
    this.policyValidator = new PolicyValidator(pool);
    this.validator = new AssignmentValidator(pool);
    this.orchestrator = new AssignmentOrchestrator(pool);
    this.audit = new AuditLogService(pool);
  }

  async createAssignment(assignmentData: CreateAssignmentRequest): Promise<ShiftAssignment> {
    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();

      // Lock the shift row for the duration of the transaction so two
      // concurrent assignment requests for the same shift serialize on the
      // capacity check instead of both reading the same pre-insert count.
      const [shiftRows] = await connection.execute<RowDataPacket[]>(
        'SELECT * FROM shifts WHERE id = ? FOR UPDATE',
        [assignmentData.shiftId]
      );

      if (shiftRows.length === 0) throw new NotFoundError('Shift not found');

      const shift = shiftRows[0];

      const [countRows] = await connection.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS current_assignments
           FROM shift_assignments
          WHERE shift_id = ? AND status IN ('pending', 'confirmed')`,
        [assignmentData.shiftId]
      );
      const currentAssignments = Number((countRows[0] as any).current_assignments);

      if (currentAssignments >= shift.max_staff) throw new ConflictError('Shift is already at maximum capacity');

      const [userRows] = await connection.execute<RowDataPacket[]>(
        'SELECT id FROM users WHERE id = ? AND is_active = 1 LIMIT 1',
        [assignmentData.userId]
      );

      if (userRows.length === 0) throw new NotFoundError('User not found or inactive');

      const conflicts = await this.validator.checkConflicts(
        assignmentData.userId,
        shift.date,
        shift.start_time,
        shift.end_time,
        connection
      );

      if (conflicts.length > 0) {
        throw new ConflictError(`User has conflicting assignment: ${conflicts[0].shiftDate} ${conflicts[0].startTime}-${conflicts[0].endTime}`);
      }

      const isAvailable = await this.validator.checkUserAvailability(
        assignmentData.userId,
        shift.date,
        connection
      );

      if (!isAvailable) throw new ConflictError('User is not available during this time');

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
          throw new ConflictError('User does not have all required skills for this shift');
        }
      }

      // Block the assignment if it would exceed configured compliance limits.
      const compliance = await evaluateAssignmentCompliance(this.pool, assignmentData.userId, {
        date:
          typeof shift.date === 'string' ? shift.date : DateUtils.fromMySQLDate(shift.date),
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
      await this.audit.write({
        actorId: assignmentData.actorId ?? null,
        action: 'assignment.create',
        entityType: 'shift_assignment',
        entityId: assignmentId,
        description: `Assignment created: user ${assignmentData.userId} on shift ${assignmentData.shiftId}`,
        justification: assignmentData.reason ?? null,
        after: { shiftId: assignmentData.shiftId, userId: assignmentData.userId, status: 'pending' },
      });
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

  /**
   * Lists assignments matching the given filters.
   *
   * WHY THERE IS A HARD CAP: `shift_assignments` is the fastest-growing table
   * in the system — it gains a row per person per shift, forever — and this
   * query joins it four ways. An unbounded `SELECT` here loads the entire
   * operational history into memory on a single request. Callers that need
   * more than `MAX_UNPAGINATED_ROWS` must either narrow the filters or use
   * `?page`/`?pageSize`.
   *
   * WHY IT REFUSES INSTEAD OF TRUNCATING: silently returning the first N rows
   * of a list the caller believes is complete is the failure mode that hides
   * missing assignments — the same reasoning applied to the audit export. An
   * explicit error is recoverable; a short list that looks whole is not.
   */
  async getAllAssignments(
    filters?: AssignmentFilters,
    pagination?: { limit: number; offset: number }
  ): Promise<ShiftAssignment[]> {
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

      const { where, params } = buildAssignmentFilters(filters);
      query += where;
      query += ' ORDER BY s.date ASC, s.start_time ASC';

      if (pagination) {
        query += ' LIMIT ? OFFSET ?';
        params.push(pagination.limit, pagination.offset);
      } else {
        // Fetch one row beyond the cap so an overflow is detectable rather
        // than indistinguishable from an exactly-full page.
        query += ` LIMIT ${MAX_UNPAGINATED_ROWS + 1}`;
      }

      const [rows] = await this.pool.execute<RowDataPacket[]>(query, params);

      if (!pagination && rows.length > MAX_UNPAGINATED_ROWS) {
        throw new ValidationError(
          `Too many assignments match this query (more than ${MAX_UNPAGINATED_ROWS}). ` +
            'Narrow the filters or request a page with ?page and ?pageSize.'
        );
      }

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

  /** Total rows matching the same filters, for the pagination envelope. */
  async countAssignments(filters?: AssignmentFilters): Promise<number> {
    try {
      const { where, params } = buildAssignmentFilters(filters);
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS total
         FROM shift_assignments sa
         JOIN shifts s ON sa.shift_id = s.id${where}`,
        params
      );
      return Number(rows[0]?.total ?? 0);
    } catch (error) {
      logger.error('Failed to count assignments:', error);
      throw error;
    }
  }

  async deleteAssignment(id: number, actorId?: number, reason?: string): Promise<boolean> {
    const snapshot = await this.getAssignmentById(id);
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute<ResultSetHeader>(
        'DELETE FROM shift_assignments WHERE id = ?',
        [id]
      );
      if (result.affectedRows === 0) throw new NotFoundError('Assignment not found');
      await connection.commit();
      logger.info(`Assignment deleted successfully: ${id}`);
      await this.audit.write({
        actorId: actorId ?? null,
        action: 'assignment.delete',
        entityType: 'shift_assignment',
        entityId: id,
        description: `Assignment deleted`,
        justification: reason ?? null,
        before: snapshot ? { shiftId: snapshot.shiftId, userId: snapshot.userId, status: snapshot.status } : null,
      });
      return true;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to delete assignment:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  async updateAssignment(id: number, updateData: { status?: string; notes?: string; actorId?: number; reason?: string }): Promise<ShiftAssignment> {
    try {
      const existing = await this.getAssignmentById(id);
      if (!existing) throw new NotFoundError('Assignment not found');

      const updates: string[] = [];
      const values: any[] = [];

      if (updateData.status) { updates.push('status = ?'); values.push(updateData.status); }
      if (updateData.notes !== undefined) { updates.push('notes = ?'); values.push(updateData.notes); }

      if (updates.length === 0) return existing;

      values.push(id);
      await this.pool.execute(
        `UPDATE shift_assignments SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        values
      );

      const updated = await this.getAssignmentById(id);
      if (!updated) throw new Error('Failed to retrieve updated assignment');
      logger.info(`Assignment ${id} updated successfully`);
      await this.audit.write({
        actorId: updateData.actorId ?? null,
        action: 'assignment.update',
        entityType: 'shift_assignment',
        entityId: id,
        description: `Assignment updated`,
        justification: updateData.reason ?? null,
        before: existing ? { status: existing.status, notes: existing.notes } : null,
        after: { status: updated.status, notes: updated.notes },
      });
      return updated;
    } catch (error) {
      logger.error('Error updating assignment:', error);
      throw error;
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

  async checkUserAvailability(userId: number, date: string): Promise<boolean> {
    return this.validator.checkUserAvailability(userId, date);
  }

  // ── Delegated to AssignmentOrchestrator ───────────────────────────────────

  async confirmAssignment(id: number, actorId?: number): Promise<ShiftAssignment> {
    const result = await this.orchestrator.confirmAssignment(id);
    await this.audit.write({
      actorId: actorId ?? null,
      action: 'assignment.confirm',
      entityType: 'shift_assignment',
      entityId: id,
      description: `Assignment confirmed by user`,
      after: { status: 'confirmed' },
    });
    return result;
  }

  async cancelAssignment(id: number, actorId?: number, reason?: string): Promise<ShiftAssignment> {
    const snapshot = await this.getAssignmentById(id);
    const result = await this.orchestrator.cancelAssignment(id);
    await this.audit.write({
      actorId: actorId ?? null,
      action: 'assignment.cancel',
      entityType: 'shift_assignment',
      entityId: id,
      description: `Assignment cancelled`,
      justification: reason ?? null,
      before: snapshot ? { status: snapshot.status } : null,
      after: { status: 'cancelled' },
    });
    return result;
  }

  async declineAssignment(id: number, actorId?: number): Promise<ShiftAssignment> {
    const result = await this.orchestrator.declineAssignment(id);
    await this.audit.write({
      actorId: actorId ?? null,
      action: 'assignment.decline',
      entityType: 'shift_assignment',
      entityId: id,
      description: `Assignment declined by user`,
      after: { status: 'declined' },
    });
    return result;
  }

  async completeAssignment(id: number, actorId?: number): Promise<ShiftAssignment> {
    const result = await this.orchestrator.completeAssignment(id);
    await this.audit.write({
      actorId: actorId ?? null,
      action: 'assignment.complete',
      entityType: 'shift_assignment',
      entityId: id,
      description: `Assignment marked complete`,
      after: { status: 'completed' },
    });
    return result;
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
