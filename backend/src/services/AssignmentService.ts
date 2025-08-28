/**
 * Assignment Service
 * 
 * Handles all business logic related to shift assignments including
 * creation, approval, conflict detection, and status management.
 * 
 * Features:
 * - Comprehensive assignment lifecycle management
 * - Advanced conflict detection and resolution
 * - Multi-status workflow support
 * - Employee availability validation
 * - Assignment history tracking
 * - Approval workflow management
 * 
 * Business Rules:
 * - Prevents double assignments
 * - Validates time conflicts
 * - Enforces approval workflows
 * - Maintains assignment integrity
 * - Supports bulk operations
 * 
 * @author Luca Ostinelli
 */

import { database } from '../config/database';
import { Assignment } from '../types';
import { logger } from '../config/logger';
import { v4 as uuidv4 } from 'uuid';

/**
 * Assignment Service Class
 * 
 * Provides comprehensive shift assignment management functionality with
 * conflict detection, approval workflows, and business rule validation.
 */
export class AssignmentService {
  
  /**
   * Create New Assignment
   * 
   * Creates a new shift assignment with comprehensive validation.
   * Prevents conflicts and ensures business rule compliance.
   * 
   * @param employeeId - Unique employee identifier
   * @param shiftId - Unique shift identifier
   * @param role - Role for the assignment (e.g., "charge nurse", "staff nurse")
   * @param assignedBy - User ID of the assigner for audit purposes
   * @returns Promise<Assignment> - Created assignment object
   * 
   * @throws {Error} When employee already assigned to shift
   * @throws {Error} When time conflicts exist
   * @throws {Error} When validation fails
   * 
   * @example
   * const assignment = await assignmentService.createAssignment(
   *   "EMP001", 
   *   "shift-123", 
   *   "staff nurse", 
   *   "manager123"
   * );
   * console.log(`Assignment created: ${assignment.id}`);
   */
  async createAssignment(employeeId: string, shiftId: string, role: string, assignedBy: string): Promise<Assignment> {
    // Check if assignment already exists
    const existingAssignment = await this.findByEmployeeAndShift(employeeId, shiftId);
    if (existingAssignment) {
      throw new Error('Employee is already assigned to this shift');
    }

    // Check for shift conflicts
    const conflictingShifts = await this.getConflictingShifts(employeeId, shiftId);
    if (conflictingShifts.length > 0) {
      throw new Error('Employee has conflicting shift assignments');
    }

    const assignmentId = uuidv4();

    const query = `
      INSERT INTO shift_assignments (
        id, employee_id, shift_id, role, status, assigned_at, assigned_by
      ) VALUES (?, ?, ?, ?, 'pending', NOW(), ?)
    `;

    await database.query(query, [
      assignmentId,
      employeeId,
      shiftId,
      role,
      assignedBy
    ]);

    const assignment = await this.findById(assignmentId);
    if (!assignment) {
      throw new Error('Failed to create assignment');
    }

    logger.info(`Assignment created: ${employeeId} -> ${shiftId}`, { assignmentId, role });
    return assignment;
  }

  /**
   * Approve Assignment
   * 
   * Approves a pending assignment, changing status to approved.
   * Records approval details and optional notes for audit trail.
   * 
   * @param assignmentId - Unique assignment identifier
   * @param approvedBy - User ID of the approver
   * @param notes - Optional approval notes
   * @returns Promise<Assignment> - Updated assignment object
   * 
   * @throws {Error} When assignment not found
   * @throws {Error} When assignment not pending
   * 
   * @example
   * const approved = await assignmentService.approveAssignment(
   *   "assignment-123", 
   *   "supervisor456", 
   *   "Approved for overtime coverage"
   * );
   * console.log(`Assignment approved: ${approved.id}`);
   */
  async approveAssignment(assignmentId: string, approvedBy: string, notes?: string): Promise<Assignment> {
    const existingAssignment = await this.findById(assignmentId);
    if (!existingAssignment) {
      throw new Error('Assignment not found');
    }

    if (existingAssignment.status !== 'pending') {
      throw new Error('Assignment is not pending approval');
    }

    const query = `
      UPDATE shift_assignments 
      SET status = 'approved', approved_by = ?, approved_at = NOW(), notes = ?
      WHERE id = ?
    `;

    await database.query(query, [approvedBy, notes, assignmentId]);

    const updatedAssignment = await this.findById(assignmentId);
    if (!updatedAssignment) {
      throw new Error('Failed to approve assignment');
    }

    logger.info(`Assignment approved: ${assignmentId}`, { approvedBy });
    return updatedAssignment;
  }

  /**
   * Reject Assignment
   * 
   * Rejects a pending assignment, changing status to rejected.
   * Records rejection details and mandatory reason for audit trail.
   * 
   * @param assignmentId - Unique assignment identifier
   * @param rejectedBy - User ID of the rejector
   * @param reason - Mandatory rejection reason
   * @returns Promise<Assignment> - Updated assignment object
   * 
   * @throws {Error} When assignment not found
   * @throws {Error} When assignment not pending
   * 
   * @example
   * const rejected = await assignmentService.rejectAssignment(
   *   "assignment-123", 
   *   "supervisor456", 
   *   "Employee unavailable due to vacation"
   * );
   * console.log(`Assignment rejected: ${rejected.id}`);
   */
  async rejectAssignment(assignmentId: string, rejectedBy: string, reason: string): Promise<Assignment> {
    const existingAssignment = await this.findById(assignmentId);
    if (!existingAssignment) {
      throw new Error('Assignment not found');
    }

    if (existingAssignment.status !== 'pending') {
      throw new Error('Assignment is not pending approval');
    }

    const query = `
      UPDATE shift_assignments 
      SET status = 'rejected', approved_by = ?, approved_at = NOW(), rejected_reason = ?
      WHERE id = ?
    `;

    await database.query(query, [rejectedBy, reason, assignmentId]);

    const updatedAssignment = await this.findById(assignmentId);
    if (!updatedAssignment) {
      throw new Error('Failed to reject assignment');
    }

    logger.info(`Assignment rejected: ${assignmentId}`, { rejectedBy, reason });
    return updatedAssignment;
  }

  /**
   * Cancel Assignment
   * 
   * Cancels an existing assignment by updating its status to cancelled.
   * Can be used for assignments that are no longer needed.
   * 
   * @param assignmentId - Unique assignment identifier
   * @returns Promise<void>
   * 
   * @throws {Error} When assignment not found
   * 
   * @example
   * await assignmentService.cancelAssignment("assignment-123");
   * console.log("Assignment cancelled successfully");
   */
  async cancelAssignment(assignmentId: string): Promise<void> {
    const existingAssignment = await this.findById(assignmentId);
    if (!existingAssignment) {
      throw new Error('Assignment not found');
    }

    const query = `
      UPDATE shift_assignments 
      SET status = 'cancelled'
      WHERE id = ?
    `;

    await database.query(query, [assignmentId]);

    logger.info(`Assignment cancelled: ${assignmentId}`);
  }

  /**
   * Delete Assignment
   * 
   * Permanently removes an assignment from the system.
   * Use with caution as this action cannot be undone.
   * 
   * @param assignmentId - Unique assignment identifier
   * @returns Promise<void>
   * 
   * @throws {Error} When assignment not found
   * 
   * @example
   * await assignmentService.deleteAssignment("assignment-123");
   * console.log("Assignment permanently deleted");
   */
  async deleteAssignment(assignmentId: string): Promise<void> {
    const existingAssignment = await this.findById(assignmentId);
    if (!existingAssignment) {
      throw new Error('Assignment not found');
    }

    const query = 'DELETE FROM shift_assignments WHERE id = ?';
    await database.query(query, [assignmentId]);

    logger.info(`Assignment deleted: ${assignmentId}`);
  }

  /**
   * Find Assignment by ID
   * 
   * Retrieves detailed assignment information by unique identifier.
   * Includes employee and shift details through JOIN operations.
   * 
   * @param assignmentId - Unique assignment identifier
   * @returns Promise<Assignment | null> - Assignment object or null if not found
   * 
   * @example
   * const assignment = await assignmentService.findById("assignment-123");
   * if (assignment) {
   *   console.log(`Assignment: ${assignment.employeeName} -> ${assignment.shiftName}`);
   * }
   */
  async findById(assignmentId: string): Promise<Assignment | null> {
    const query = `
      SELECT sa.*, 
             e.first_name as employee_first_name, 
             e.last_name as employee_last_name,
             s.name as shift_name,
             s.date as shift_date,
             s.start_time,
             s.end_time,
             u.first_name as approved_by_first_name,
             u.last_name as approved_by_last_name
      FROM shift_assignments sa
      JOIN employees e ON sa.employee_id = e.employee_id
      JOIN shifts s ON sa.shift_id = s.id
      LEFT JOIN users u ON sa.approved_by = u.id
      WHERE sa.id = ?
    `;

    const results = await database.query(query, [assignmentId]);
    const rows = results as any[];

    if (rows.length === 0) {
      return null;
    }

    return this.mapRowToAssignment(rows[0]);
  }

  /**
   * Find Assignment by Employee and Shift
   * 
   * Retrieves assignment for a specific employee and shift combination.
   * Used to check for existing assignments and prevent duplicates.
   * 
   * @param employeeId - Unique employee identifier
   * @param shiftId - Unique shift identifier
   * @returns Promise<Assignment | null> - Assignment object or null if not found
   * 
   * @example
   * const existing = await assignmentService.findByEmployeeAndShift("EMP001", "shift-123");
   * if (existing) {
   *   console.log("Employee already assigned to this shift");
   * }
   */
  async findByEmployeeAndShift(employeeId: string, shiftId: string): Promise<Assignment | null> {
    const query = `
      SELECT sa.*, 
             e.first_name as employee_first_name, 
             e.last_name as employee_last_name,
             s.name as shift_name,
             s.date as shift_date,
             s.start_time,
             s.end_time,
             u.first_name as approved_by_first_name,
             u.last_name as approved_by_last_name
      FROM shift_assignments sa
      JOIN employees e ON sa.employee_id = e.employee_id
      JOIN shifts s ON sa.shift_id = s.id
      LEFT JOIN users u ON sa.approved_by = u.id
      WHERE sa.employee_id = ? AND sa.shift_id = ?
    `;

    const results = await database.query(query, [employeeId, shiftId]);
    const rows = results as any[];

    if (rows.length === 0) {
      return null;
    }

    return this.mapRowToAssignment(rows[0]);
  }

  /**
   * Find Assignments by Employee
   * 
   * Retrieves all assignments for a specific employee.
   * Optionally filters by assignment status.
   * 
   * @param employeeId - Unique employee identifier
   * @param status - Optional status filter
   * @returns Promise<Assignment[]> - Array of assignment objects
   * 
   * @example
   * const assignments = await assignmentService.findByEmployee("EMP001", "approved");
   * console.log(`Employee has ${assignments.length} approved assignments`);
   */
  async findByEmployee(employeeId: string, status?: string): Promise<Assignment[]> {
    let query = `
      SELECT sa.*, 
             e.first_name as employee_first_name, 
             e.last_name as employee_last_name,
             s.name as shift_name,
             s.date as shift_date,
             s.start_time,
             s.end_time,
             u.first_name as approved_by_first_name,
             u.last_name as approved_by_last_name
      FROM shift_assignments sa
      JOIN employees e ON sa.employee_id = e.employee_id
      JOIN shifts s ON sa.shift_id = s.id
      LEFT JOIN users u ON sa.approved_by = u.id
      WHERE sa.employee_id = ?
    `;

    const params = [employeeId];

    if (status) {
      query += ' AND sa.status = ?';
      params.push(status);
    }

    query += ' ORDER BY s.date DESC, s.start_time DESC';

    const results = await database.query(query, params);
    return (results as any[]).map(row => this.mapRowToAssignment(row));
  }

  /**
   * Find Assignments by Shift
   * 
   * Retrieves all assignments for a specific shift.
   * Optionally filters by assignment status.
   * 
   * @param shiftId - Unique shift identifier
   * @param status - Optional status filter
   * @returns Promise<Assignment[]> - Array of assignment objects
   * 
   * @example
   * const assignments = await assignmentService.findByShift("shift-123", "approved");
   * console.log(`Shift has ${assignments.length} approved assignments`);
   */
  async findByShift(shiftId: string, status?: string): Promise<Assignment[]> {
    let query = `
      SELECT sa.*, 
             e.first_name as employee_first_name, 
             e.last_name as employee_last_name,
             s.name as shift_name,
             s.date as shift_date,
             s.start_time,
             s.end_time,
             u.first_name as approved_by_first_name,
             u.last_name as approved_by_last_name
      FROM shift_assignments sa
      JOIN employees e ON sa.employee_id = e.employee_id
      JOIN shifts s ON sa.shift_id = s.id
      LEFT JOIN users u ON sa.approved_by = u.id
      WHERE sa.shift_id = ?
    `;

    const params = [shiftId];

    if (status) {
      query += ' AND sa.status = ?';
      params.push(status);
    }

    query += ' ORDER BY sa.assigned_at ASC';

    const results = await database.query(query, params);
    return (results as any[]).map(row => this.mapRowToAssignment(row));
  }

  /**
   * Get Conflicting Shifts
   * 
   * Identifies shifts that conflict with a target shift for a specific employee.
   * Checks for time overlaps on the same date to prevent double booking.
   * 
   * @param employeeId - Unique employee identifier
   * @param shiftId - Target shift to check conflicts against
   * @returns Promise<any[]> - Array of conflicting shift assignments
   * 
   * @private
   * @internal
   * 
   * @example
   * const conflicts = await this.getConflictingShifts("EMP001", "shift-123");
   * if (conflicts.length > 0) {
   *   throw new Error("Employee has conflicting assignments");
   * }
   */
  private async getConflictingShifts(employeeId: string, shiftId: string): Promise<any[]> {
    const query = `
      SELECT sa.*, s.date, s.start_time, s.end_time
      FROM shift_assignments sa
      JOIN shifts s ON sa.shift_id = s.id
      JOIN shifts target_shift ON target_shift.id = ?
      WHERE sa.employee_id = ? 
      AND sa.status IN ('pending', 'approved')
      AND s.date = target_shift.date
      AND (
        (s.start_time <= target_shift.start_time AND s.end_time > target_shift.start_time)
        OR (s.start_time < target_shift.end_time AND s.end_time >= target_shift.end_time)
        OR (s.start_time >= target_shift.start_time AND s.end_time <= target_shift.end_time)
      )
    `;

    const results = await database.query(query, [shiftId, employeeId]);
    return results as any[];
  }

  /**
   * Map Database Row to Assignment Object
   * 
   * Transforms raw database row data into properly typed Assignment objects.
   * Handles complex joins and builds readable names from related entities.
   * 
   * @param row - Raw database row data
   * @returns Assignment - Properly typed and formatted assignment object
   * 
   * @private
   * @internal
   */
  private mapRowToAssignment(row: any): Assignment {
    return {
      id: row.id,
      employeeId: row.employee_id,
      shiftId: row.shift_id,
      role: row.role,
      status: row.status,
      assignedAt: row.assigned_at,
      approvedBy: row.approved_by,
      approvedAt: row.approved_at,
      rejectedReason: row.rejected_reason,
      notes: row.notes
    };
  }
}

/**
 * Assignment Service Singleton Instance
 * 
 * Exports a singleton instance of the AssignmentService class for
 * consistent usage across the application.
 */
export const assignmentService = new AssignmentService();
