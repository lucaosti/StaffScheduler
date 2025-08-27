import { database } from '../config/database';
import { Assignment } from '../types';
import { logger } from '../config/logger';
import { v4 as uuidv4 } from 'uuid';

export class AssignmentService {
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

  async deleteAssignment(assignmentId: string): Promise<void> {
    const existingAssignment = await this.findById(assignmentId);
    if (!existingAssignment) {
      throw new Error('Assignment not found');
    }

    const query = 'DELETE FROM shift_assignments WHERE id = ?';
    await database.query(query, [assignmentId]);

    logger.info(`Assignment deleted: ${assignmentId}`);
  }

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

export const assignmentService = new AssignmentService();
