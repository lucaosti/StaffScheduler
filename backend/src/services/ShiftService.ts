import { database } from '../config/database';
import { Shift, CreateShiftRequest, UpdateShiftRequest, ShiftFilters, PaginationParams } from '../types';
import { logger } from '../config/logger';
import { v4 as uuidv4 } from 'uuid';

export class ShiftService {
  async createShift(shiftData: CreateShiftRequest, createdBy: string): Promise<Shift> {
    const {
      name,
      startTime,
      endTime,
      date,
      department,
      position,
      requiredSkills,
      minimumStaff,
      maximumStaff,
      type = 'regular',
      specialType,
      priority = 1,
      location,
      description,
      rolesRequired
    } = shiftData;

    const shiftId = uuidv4();

    const query = `
      INSERT INTO shifts (
        id, name, start_time, end_time, date, department, position,
        required_skills, minimum_staff, maximum_staff, type, special_type,
        priority, location, description, status, roles_required,
        created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, NOW(), NOW())
    `;

    await database.query(query, [
      shiftId,
      name,
      startTime,
      endTime,
      date,
      department,
      position,
      JSON.stringify(requiredSkills),
      minimumStaff,
      maximumStaff,
      type,
      specialType,
      priority,
      location,
      description,
      JSON.stringify(rolesRequired),
      createdBy
    ]);

    const shift = await this.findById(shiftId);
    if (!shift) {
      throw new Error('Failed to create shift');
    }

    logger.info(`Shift created: ${name}`, { shiftId, department, date });
    return shift;
  }

  async updateShift(shiftId: string, updateData: UpdateShiftRequest): Promise<Shift> {
    const existingShift = await this.findById(shiftId);
    if (!existingShift) {
      throw new Error('Shift not found');
    }

    const fields = [];
    const values = [];

    if (updateData.name !== undefined) {
      fields.push('name = ?');
      values.push(updateData.name);
    }
    if (updateData.startTime !== undefined) {
      fields.push('start_time = ?');
      values.push(updateData.startTime);
    }
    if (updateData.endTime !== undefined) {
      fields.push('end_time = ?');
      values.push(updateData.endTime);
    }
    if (updateData.date !== undefined) {
      fields.push('date = ?');
      values.push(updateData.date);
    }
    if (updateData.department !== undefined) {
      fields.push('department = ?');
      values.push(updateData.department);
    }
    if (updateData.position !== undefined) {
      fields.push('position = ?');
      values.push(updateData.position);
    }
    if (updateData.requiredSkills !== undefined) {
      fields.push('required_skills = ?');
      values.push(JSON.stringify(updateData.requiredSkills));
    }
    if (updateData.minimumStaff !== undefined) {
      fields.push('minimum_staff = ?');
      values.push(updateData.minimumStaff);
    }
    if (updateData.maximumStaff !== undefined) {
      fields.push('maximum_staff = ?');
      values.push(updateData.maximumStaff);
    }
    if (updateData.type !== undefined) {
      fields.push('type = ?');
      values.push(updateData.type);
    }
    if (updateData.specialType !== undefined) {
      fields.push('special_type = ?');
      values.push(updateData.specialType);
    }
    if (updateData.priority !== undefined) {
      fields.push('priority = ?');
      values.push(updateData.priority);
    }
    if (updateData.location !== undefined) {
      fields.push('location = ?');
      values.push(updateData.location);
    }
    if (updateData.description !== undefined) {
      fields.push('description = ?');
      values.push(updateData.description);
    }
    if (updateData.status !== undefined) {
      fields.push('status = ?');
      values.push(updateData.status);
    }
    if (updateData.rolesRequired !== undefined) {
      fields.push('roles_required = ?');
      values.push(JSON.stringify(updateData.rolesRequired));
    }

    if (fields.length === 0) {
      return existingShift;
    }

    fields.push('updated_at = NOW()');
    values.push(shiftId);

    const query = `UPDATE shifts SET ${fields.join(', ')} WHERE id = ?`;
    await database.query(query, values);

    const updatedShift = await this.findById(shiftId);
    if (!updatedShift) {
      throw new Error('Failed to update shift');
    }

    logger.info(`Shift updated: ${shiftId}`);
    return updatedShift;
  }

  async findById(shiftId: string): Promise<Shift | null> {
    const query = `
      SELECT s.*, u.first_name, u.last_name
      FROM shifts s
      LEFT JOIN users u ON s.created_by = u.id
      WHERE s.id = ?
    `;

    const results = await database.query(query, [shiftId]);
    const rows = results as any[];

    if (rows.length === 0) {
      return null;
    }

    return this.mapRowToShift(rows[0]);
  }

  async findAll(filters: ShiftFilters = {}, pagination: PaginationParams = { page: 1, limit: 20 }): Promise<{ shifts: Shift[], total: number }> {
    let whereClause = 'WHERE 1=1';
    const params: any[] = [];

    // Build dynamic WHERE clause
    if (filters.startDate && filters.endDate) {
      whereClause += ' AND s.date BETWEEN ? AND ?';
      params.push(filters.startDate, filters.endDate);
    } else if (filters.startDate) {
      whereClause += ' AND s.date >= ?';
      params.push(filters.startDate);
    } else if (filters.endDate) {
      whereClause += ' AND s.date <= ?';
      params.push(filters.endDate);
    }

    if (filters.department) {
      whereClause += ' AND s.department = ?';
      params.push(filters.department);
    }

    if (filters.position) {
      whereClause += ' AND s.position = ?';
      params.push(filters.position);
    }

    if (filters.type) {
      whereClause += ' AND s.type = ?';
      params.push(filters.type);
    }

    if (filters.status) {
      whereClause += ' AND s.status = ?';
      params.push(filters.status);
    }

    // Count total for pagination
    const countQuery = `SELECT COUNT(*) as total FROM shifts s ${whereClause}`;
    const countResult = await database.query(countQuery, params);
    const total = (countResult as any[])[0]?.total || 0;

    // Build main query with sorting and pagination
    const sortBy = pagination.sortBy || 'date';
    const sortOrder = pagination.sortOrder || 'asc';
    const offset = (pagination.page - 1) * pagination.limit;

    const query = `
      SELECT s.*, u.first_name, u.last_name
      FROM shifts s
      LEFT JOIN users u ON s.created_by = u.id
      ${whereClause}
      ORDER BY s.${sortBy} ${sortOrder}, s.start_time ASC
      LIMIT ? OFFSET ?
    `;

    params.push(pagination.limit, offset);
    const results = await database.query(query, params);
    const shifts = (results as any[]).map(row => this.mapRowToShift(row));

    return { shifts, total };
  }

  async deleteShift(shiftId: string): Promise<void> {
    const existingShift = await this.findById(shiftId);
    if (!existingShift) {
      throw new Error('Shift not found');
    }

    // Check if shift has assignments
    const assignmentQuery = 'SELECT COUNT(*) as count FROM shift_assignments WHERE shift_id = ?';
    const assignmentResult = await database.query(assignmentQuery, [shiftId]);
    const assignmentCount = (assignmentResult as any[])[0]?.count || 0;

    if (assignmentCount > 0) {
      throw new Error('Cannot delete shift with existing assignments');
    }

    const query = 'DELETE FROM shifts WHERE id = ?';
    await database.query(query, [shiftId]);

    logger.info(`Shift deleted: ${shiftId}`);
  }

  async publishShift(shiftId: string): Promise<Shift> {
    const shift = await this.updateShift(shiftId, { status: 'published' });
    logger.info(`Shift published: ${shiftId}`);
    return shift;
  }

  async getShiftAssignments(shiftId: string): Promise<any[]> {
    const query = `
      SELECT sa.*, e.first_name, e.last_name, e.employee_id
      FROM shift_assignments sa
      JOIN employees e ON sa.employee_id = e.employee_id
      WHERE sa.shift_id = ?
    `;

    const results = await database.query(query, [shiftId]);
    return results as any[];
  }

  private mapRowToShift(row: any): Shift {
    return {
      id: row.id,
      name: row.name,
      startTime: row.start_time,
      endTime: row.end_time,
      date: row.date,
      department: row.department,
      position: row.position,
      requiredSkills: JSON.parse(row.required_skills || '[]'),
      minimumStaff: row.minimum_staff,
      maximumStaff: row.maximum_staff,
      type: row.type,
      specialType: row.special_type,
      priority: row.priority,
      location: row.location,
      description: row.description,
      status: row.status,
      rolesRequired: JSON.parse(row.roles_required || '{}'),
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      createdByName: row.first_name && row.last_name 
        ? `${row.first_name} ${row.last_name}` 
        : null
    };
  }
}

export const shiftService = new ShiftService();
