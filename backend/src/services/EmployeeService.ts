import { database } from '../config/database';
import { Employee, CreateEmployeeRequest, UpdateEmployeeRequest, EmployeeFilters, PaginationParams } from '../types';
import { logger } from '../config/logger';

export class EmployeeService {
  async createEmployee(employeeData: CreateEmployeeRequest): Promise<Employee> {
    const {
      employeeId,
      firstName,
      lastName,
      email,
      phone,
      position,
      department,
      hireDate,
      contractFrom,
      contractTo,
      workPatterns,
      skills,
      preferences,
      emergencyContact,
      primarySupervisor
    } = employeeData;

    // Check if employee already exists
    const existingEmployee = await this.findByEmployeeId(employeeId);
    if (existingEmployee) {
      throw new Error('Employee ID already exists');
    }

    // Check if email already exists
    const existingEmail = await this.findByEmail(email);
    if (existingEmail) {
      throw new Error('Email already in use');
    }

    const query = `
      INSERT INTO employees (
        employee_id, first_name, last_name, email, phone, position, department,
        hire_date, contract_from, contract_to, work_patterns, skills,
        preferences, emergency_contact, primary_supervisor, hierarchy_path,
        is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true, NOW(), NOW())
    `;

    await database.query(query, [
      employeeId,
      firstName,
      lastName,
      email,
      phone,
      position,
      department,
      hireDate,
      contractFrom,
      contractTo,
      JSON.stringify(workPatterns),
      JSON.stringify(skills),
      JSON.stringify(preferences),
      JSON.stringify(emergencyContact),
      primarySupervisor,
      '0', // Default hierarchy path
    ]);

    const employee = await this.findByEmployeeId(employeeId);
    if (!employee) {
      throw new Error('Failed to create employee');
    }

    logger.info(`Employee created: ${firstName} ${lastName}`, { employeeId, email });
    return employee;
  }

  async updateEmployee(employeeId: string, updateData: UpdateEmployeeRequest): Promise<Employee> {
    const existingEmployee = await this.findByEmployeeId(employeeId);
    if (!existingEmployee) {
      throw new Error('Employee not found');
    }

    const fields = [];
    const values = [];

    if (updateData.firstName !== undefined) {
      fields.push('first_name = ?');
      values.push(updateData.firstName);
    }
    if (updateData.lastName !== undefined) {
      fields.push('last_name = ?');
      values.push(updateData.lastName);
    }
    if (updateData.email !== undefined) {
      fields.push('email = ?');
      values.push(updateData.email);
    }
    if (updateData.phone !== undefined) {
      fields.push('phone = ?');
      values.push(updateData.phone);
    }
    if (updateData.position !== undefined) {
      fields.push('position = ?');
      values.push(updateData.position);
    }
    if (updateData.department !== undefined) {
      fields.push('department = ?');
      values.push(updateData.department);
    }
    if (updateData.contractFrom !== undefined) {
      fields.push('contract_from = ?');
      values.push(updateData.contractFrom);
    }
    if (updateData.contractTo !== undefined) {
      fields.push('contract_to = ?');
      values.push(updateData.contractTo);
    }
    if (updateData.workPatterns !== undefined) {
      fields.push('work_patterns = ?');
      values.push(JSON.stringify(updateData.workPatterns));
    }
    if (updateData.skills !== undefined) {
      fields.push('skills = ?');
      values.push(JSON.stringify(updateData.skills));
    }
    if (updateData.preferences !== undefined) {
      fields.push('preferences = ?');
      values.push(JSON.stringify(updateData.preferences));
    }

    if (fields.length === 0) {
      return existingEmployee;
    }

    fields.push('updated_at = NOW()');
    values.push(employeeId);

    const query = `UPDATE employees SET ${fields.join(', ')} WHERE employee_id = ?`;
    await database.query(query, values);

    const updatedEmployee = await this.findByEmployeeId(employeeId);
    if (!updatedEmployee) {
      throw new Error('Failed to update employee');
    }

    logger.info(`Employee updated: ${employeeId}`);
    return updatedEmployee;
  }

  async findByEmployeeId(employeeId: string): Promise<Employee | null> {
    const query = `
      SELECT e.*, u.first_name as supervisor_first_name, u.last_name as supervisor_last_name
      FROM employees e
      LEFT JOIN users u ON e.primary_supervisor = u.id
      WHERE e.employee_id = ? AND e.is_active = true
    `;

    const results = await database.query(query, [employeeId]);
    const rows = results as any[];

    if (rows.length === 0) {
      return null;
    }

    return this.mapRowToEmployee(rows[0]);
  }

  async findByEmail(email: string): Promise<Employee | null> {
    const query = `
      SELECT e.*, u.first_name as supervisor_first_name, u.last_name as supervisor_last_name
      FROM employees e
      LEFT JOIN users u ON e.primary_supervisor = u.id
      WHERE e.email = ? AND e.is_active = true
    `;

    const results = await database.query(query, [email]);
    const rows = results as any[];

    if (rows.length === 0) {
      return null;
    }

    return this.mapRowToEmployee(rows[0]);
  }

  async findAll(filters: EmployeeFilters = {}, pagination: PaginationParams = { page: 1, limit: 20 }): Promise<{ employees: Employee[], total: number }> {
    let whereClause = 'WHERE e.is_active = true';
    const params: any[] = [];

    // Build dynamic WHERE clause
    if (filters.department) {
      whereClause += ' AND e.department = ?';
      params.push(filters.department);
    }

    if (filters.position) {
      whereClause += ' AND e.position = ?';
      params.push(filters.position);
    }

    if (filters.search) {
      whereClause += ` AND (
        e.first_name LIKE ? OR 
        e.last_name LIKE ? OR 
        e.email LIKE ? OR
        e.employee_id LIKE ?
      )`;
      const searchTerm = `%${filters.search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    // Count total for pagination
    const countQuery = `SELECT COUNT(*) as total FROM employees e ${whereClause}`;
    const countResult = await database.query(countQuery, params);
    const total = (countResult as any[])[0]?.total || 0;

    // Build main query with sorting and pagination
    const sortBy = pagination.sortBy || 'first_name';
    const sortOrder = pagination.sortOrder || 'asc';
    const offset = (pagination.page - 1) * pagination.limit;

    const query = `
      SELECT e.*, u.first_name as supervisor_first_name, u.last_name as supervisor_last_name
      FROM employees e
      LEFT JOIN users u ON e.primary_supervisor = u.id
      ${whereClause}
      ORDER BY e.${sortBy} ${sortOrder}
      LIMIT ? OFFSET ?
    `;

    params.push(pagination.limit, offset);
    const results = await database.query(query, params);
    const employees = (results as any[]).map(row => this.mapRowToEmployee(row));

    return { employees, total };
  }

  async deleteEmployee(employeeId: string): Promise<void> {
    const existingEmployee = await this.findByEmployeeId(employeeId);
    if (!existingEmployee) {
      throw new Error('Employee not found');
    }

    // Soft delete
    const query = 'UPDATE employees SET is_active = false, updated_at = NOW() WHERE employee_id = ?';
    await database.query(query, [employeeId]);

    logger.info(`Employee deleted: ${employeeId}`);
  }

  private mapRowToEmployee(row: any): Employee {
    return {
      employeeId: row.employee_id,
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
      phone: row.phone,
      position: row.position,
      department: row.department,
      hireDate: row.hire_date,
      contractFrom: row.contract_from,
      contractTo: row.contract_to,
      workPatterns: JSON.parse(row.work_patterns),
      skills: JSON.parse(row.skills),
      preferences: JSON.parse(row.preferences),
      emergencyContact: JSON.parse(row.emergency_contact),
      primarySupervisor: row.primary_supervisor,
      hierarchyPath: row.hierarchy_path,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      supervisorName: row.supervisor_first_name && row.supervisor_last_name 
        ? `${row.supervisor_first_name} ${row.supervisor_last_name}` 
        : null
    };
  }
}

export const employeeService = new EmployeeService();
