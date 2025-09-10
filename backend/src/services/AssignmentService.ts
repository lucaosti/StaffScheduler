import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { Assignment, CreateAssignmentRequest, UpdateAssignmentRequest } from '../types';

export class AssignmentService {
  constructor(private pool: Pool) {}

  async getAllAssignments(): Promise<Assignment[]> {
    const query = `
      SELECT 
        a.assignment_id as id,
        a.shift_id as shiftId,
        a.user_id as userId,
        a.status,
        a.notes,
        a.created_at as createdAt,
        a.updated_at as updatedAt,
        u.first_name,
        u.last_name,
        u.email,
        s.shift_date,
        s.start_time,
        s.end_time,
        d.name as departmentName
      FROM assignments a
      LEFT JOIN users u ON a.user_id = u.user_id
      LEFT JOIN shifts s ON a.shift_id = s.shift_id
      LEFT JOIN departments d ON s.department_id = d.department_id
      ORDER BY s.shift_date, s.start_time, u.last_name
    `;
    
    const [rows] = await this.pool.execute<RowDataPacket[]>(query);
    return rows.map(row => ({
      id: row.id,
      shiftId: row.shiftId,
      userId: row.userId,
      status: row.status,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }));
  }

  async getAssignmentById(id: number): Promise<Assignment | null> {
    const query = `
      SELECT 
        a.assignment_id as id,
        a.shift_id as shiftId,
        a.user_id as userId,
        a.status,
        a.notes,
        a.created_at as createdAt,
        a.updated_at as updatedAt,
        u.first_name,
        u.last_name,
        u.email,
        s.shift_date,
        s.start_time,
        s.end_time
      FROM assignments a
      LEFT JOIN users u ON a.user_id = u.user_id
      LEFT JOIN shifts s ON a.shift_id = s.shift_id
      WHERE a.assignment_id = ?
    `;
    
    const [rows] = await this.pool.execute<RowDataPacket[]>(query, [id]);
    if (rows.length === 0) return null;
    
    const row = rows[0];
    return {
      id: row.id,
      shiftId: row.shiftId,
      userId: row.userId,
      status: row.status,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  async createAssignment(assignmentData: CreateAssignmentRequest): Promise<number> {
    // Check if user is already assigned to this shift
    const [existingRows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT assignment_id FROM assignments WHERE shift_id = ? AND user_id = ?',
      [assignmentData.shiftId, assignmentData.userId]
    );
    
    if (existingRows.length > 0) {
      throw new Error('User is already assigned to this shift');
    }

    // Check if shift is already full
    const [shiftRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT s.required_staff, COUNT(a.assignment_id) as current_assignments
       FROM shifts s
       LEFT JOIN assignments a ON s.shift_id = a.shift_id AND a.status IN ('scheduled', 'confirmed')
       WHERE s.shift_id = ?
       GROUP BY s.shift_id`,
      [assignmentData.shiftId]
    );
    
    if (shiftRows.length > 0) {
      const shift = shiftRows[0];
      if (shift.current_assignments >= shift.required_staff) {
        throw new Error('Shift is already fully staffed');
      }
    }

    const query = `
      INSERT INTO assignments (shift_id, user_id, status, notes)
      VALUES (?, ?, 'scheduled', ?)
    `;
    
    const [result] = await this.pool.execute<ResultSetHeader>(query, [
      assignmentData.shiftId,
      assignmentData.userId,
      assignmentData.notes || null
    ]);
    
    // Update shift status based on staffing level
    await this.updateShiftStatus(assignmentData.shiftId);
    
    return result.insertId;
  }

  async updateAssignment(id: number, assignmentData: UpdateAssignmentRequest): Promise<boolean> {
    const updates: string[] = [];
    const values: any[] = [];
    
    if (assignmentData.status !== undefined) {
      updates.push('status = ?');
      values.push(assignmentData.status);
    }
    if (assignmentData.notes !== undefined) {
      updates.push('notes = ?');
      values.push(assignmentData.notes);
    }
    
    if (updates.length === 0) return false;
    
    values.push(id);
    const query = `UPDATE assignments SET ${updates.join(', ')} WHERE assignment_id = ?`;
    
    const [result] = await this.pool.execute<ResultSetHeader>(query, values);
    
    if (result.affectedRows > 0) {
      // Get shift ID to update status
      const [assignmentRows] = await this.pool.execute<RowDataPacket[]>(
        'SELECT shift_id FROM assignments WHERE assignment_id = ?',
        [id]
      );
      
      if (assignmentRows.length > 0) {
        await this.updateShiftStatus(assignmentRows[0].shift_id);
      }
    }
    
    return result.affectedRows > 0;
  }

  async deleteAssignment(id: number): Promise<boolean> {
    // Get shift ID before deleting
    const [assignmentRows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT shift_id FROM assignments WHERE assignment_id = ?',
      [id]
    );
    
    const query = 'DELETE FROM assignments WHERE assignment_id = ?';
    const [result] = await this.pool.execute<ResultSetHeader>(query, [id]);
    
    if (result.affectedRows > 0 && assignmentRows.length > 0) {
      await this.updateShiftStatus(assignmentRows[0].shift_id);
    }
    
    return result.affectedRows > 0;
  }

  async getAssignmentsByUser(userId: number): Promise<Assignment[]> {
    const query = `
      SELECT 
        a.assignment_id as id,
        a.shift_id as shiftId,
        a.user_id as userId,
        a.status,
        a.notes,
        a.created_at as createdAt,
        a.updated_at as updatedAt,
        s.shift_date,
        s.start_time,
        s.end_time,
        d.name as departmentName
      FROM assignments a
      LEFT JOIN shifts s ON a.shift_id = s.shift_id
      LEFT JOIN departments d ON s.department_id = d.department_id
      WHERE a.user_id = ?
      ORDER BY s.shift_date, s.start_time
    `;
    
    const [rows] = await this.pool.execute<RowDataPacket[]>(query, [userId]);
    return rows.map(row => ({
      id: row.id,
      shiftId: row.shiftId,
      userId: row.userId,
      status: row.status,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }));
  }

  async getAssignmentsByShift(shiftId: number): Promise<Assignment[]> {
    const query = `
      SELECT 
        a.assignment_id as id,
        a.shift_id as shiftId,
        a.user_id as userId,
        a.status,
        a.notes,
        a.created_at as createdAt,
        a.updated_at as updatedAt,
        u.first_name,
        u.last_name,
        u.email,
        u.role
      FROM assignments a
      LEFT JOIN users u ON a.user_id = u.user_id
      WHERE a.shift_id = ?
      ORDER BY u.last_name, u.first_name
    `;
    
    const [rows] = await this.pool.execute<RowDataPacket[]>(query, [shiftId]);
    return rows.map(row => ({
      id: row.id,
      shiftId: row.shiftId,
      userId: row.userId,
      status: row.status,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }));
  }

  async getAssignmentsByDepartment(departmentId: number, startDate?: string, endDate?: string): Promise<Assignment[]> {
    let query = `
      SELECT 
        a.assignment_id as id,
        a.shift_id as shiftId,
        a.user_id as userId,
        a.status,
        a.notes,
        a.created_at as createdAt,
        a.updated_at as updatedAt,
        u.first_name,
        u.last_name,
        u.email,
        s.shift_date,
        s.start_time,
        s.end_time
      FROM assignments a
      LEFT JOIN users u ON a.user_id = u.user_id
      LEFT JOIN shifts s ON a.shift_id = s.shift_id
      WHERE s.department_id = ?
    `;
    
    const params: any[] = [departmentId];
    
    if (startDate) {
      query += ' AND s.shift_date >= ?';
      params.push(startDate);
    }
    
    if (endDate) {
      query += ' AND s.shift_date <= ?';
      params.push(endDate);
    }
    
    query += ' ORDER BY s.shift_date, s.start_time, u.last_name';
    
    const [rows] = await this.pool.execute<RowDataPacket[]>(query, params);
    return rows.map(row => ({
      id: row.id,
      shiftId: row.shiftId,
      userId: row.userId,
      status: row.status,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }));
  }

  async bulkCreateAssignments(assignments: CreateAssignmentRequest[]): Promise<number[]> {
    const connection = await this.pool.getConnection();
    const results: number[] = [];
    
    try {
      await connection.beginTransaction();
      
      for (const assignmentData of assignments) {
        // Check if user is already assigned to this shift
        const [existingRows] = await connection.execute<RowDataPacket[]>(
          'SELECT assignment_id FROM assignments WHERE shift_id = ? AND user_id = ?',
          [assignmentData.shiftId, assignmentData.userId]
        );
        
        if (existingRows.length > 0) {
          continue; // Skip if already assigned
        }

        const query = `
          INSERT INTO assignments (shift_id, user_id, status, notes)
          VALUES (?, ?, 'scheduled', ?)
        `;
        
        const [result] = await connection.execute<ResultSetHeader>(query, [
          assignmentData.shiftId,
          assignmentData.userId,
          assignmentData.notes || null
        ]);
        
        results.push(result.insertId);
        
        // Update shift status
        await this.updateShiftStatus(assignmentData.shiftId);
      }
      
      await connection.commit();
      return results;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async confirmAssignment(id: number): Promise<boolean> {
    return this.updateAssignment(id, { status: 'confirmed' });
  }

  async declineAssignment(id: number, notes?: string): Promise<boolean> {
    return this.updateAssignment(id, { status: 'declined', notes });
  }

  async completeAssignment(id: number): Promise<boolean> {
    return this.updateAssignment(id, { status: 'completed' });
  }

  private async updateShiftStatus(shiftId: number): Promise<void> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT s.required_staff, COUNT(a.assignment_id) as current_assignments
       FROM shifts s
       LEFT JOIN assignments a ON s.shift_id = a.shift_id AND a.status IN ('scheduled', 'confirmed')
       WHERE s.shift_id = ?
       GROUP BY s.shift_id`,
      [shiftId]
    );
    
    if (rows.length > 0) {
      const shift = rows[0];
      let status = 'open';
      
      if (shift.current_assignments === shift.required_staff) {
        status = 'filled';
      } else if (shift.current_assignments > shift.required_staff) {
        status = 'overstaffed';
      }
      
      await this.pool.execute(
        'UPDATE shifts SET status = ? WHERE shift_id = ?',
        [status, shiftId]
      );
    }
  }

  async getAvailableEmployeesForShift(shiftId: number): Promise<any[]> {
    const query = `
      SELECT 
        u.user_id as id,
        u.first_name as firstName,
        u.last_name as lastName,
        u.email,
        u.role,
        e.employee_number as employeeId
      FROM users u
      LEFT JOIN employees e ON u.user_id = e.user_id
      WHERE u.role IN ('employee', 'department_manager', 'manager') 
      AND u.is_active = 1
      AND u.user_id NOT IN (
        SELECT a.user_id 
        FROM assignments a 
        WHERE a.shift_id = ?
      )
      AND u.user_id NOT IN (
        -- Check for conflicts with other shifts on the same day
        SELECT a2.user_id
        FROM assignments a2
        INNER JOIN shifts s2 ON a2.shift_id = s2.shift_id
        INNER JOIN shifts s1 ON s1.shift_id = ?
        WHERE s2.shift_date = s1.shift_date
        AND a2.status IN ('scheduled', 'confirmed')
        AND (
          (s2.start_time <= s1.start_time AND s2.end_time > s1.start_time) OR
          (s2.start_time < s1.end_time AND s2.end_time >= s1.end_time) OR
          (s2.start_time >= s1.start_time AND s2.end_time <= s1.end_time)
        )
      )
      ORDER BY u.last_name, u.first_name
    `;
    
    const [rows] = await this.pool.execute<RowDataPacket[]>(query, [shiftId, shiftId]);
    return rows;
  }
}
