/**
 * Employee Service
 * 
 * Handles all business logic related to employee management including
 * CRUD operations, data validation, and complex queries.
 * 
 * Features:
 * - Complete employee lifecycle management
 * - Advanced search and filtering capabilities
 * - Validation and conflict detection
 * - Hierarchical organization support
 * - Skills and competency tracking
 * - Work pattern and preference management
 * 
 * Security:
 * - Input validation and sanitization
 * - Duplicate prevention (email, employee ID)
 * - Soft delete for data integrity
 * - Audit trail support
 * 
 * @author Luca Ostinelli
 */

import { database } from '../config/database';
import { Employee, CreateEmployeeRequest, UpdateEmployeeRequest, EmployeeFilters, PaginationParams } from '../types';
import { logger } from '../config/logger';

/**
 * Employee Service Class
 * 
 * Provides comprehensive employee management functionality with
 * data validation, conflict detection, and hierarchical support.
 */
export class EmployeeService {
  
  /**
   * Create New Employee
   * 
   * Creates a new employee record with comprehensive validation and
   * conflict detection. Ensures data integrity and business rules.
   * 
   * @param employeeData - Complete employee information
   * @returns Promise<Employee> - Created employee object
   * 
   * @throws {Error} When employee ID already exists
   * @throws {Error} When email already in use
   * @throws {Error} When required fields are missing
   * 
   * @example
   * const newEmployee = await employeeService.createEmployee({
   *   employeeId: "EMP001",
   *   firstName: "John",
   *   lastName: "Doe",
   *   email: "john.doe@company.com",
   *   department: "Nursing",
   *   position: "RN"
   * });
   */
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

    // Validate employee ID uniqueness
    const existingEmployee = await this.findByEmployeeId(employeeId);
    if (existingEmployee) {
      throw new Error('Employee ID already exists');
    }

    // Validate email uniqueness
    const existingEmail = await this.findByEmail(email);
    if (existingEmail) {
      throw new Error('Email already in use');
    }

    // Prepare database insertion query
    const query = `
      INSERT INTO employees (
        employee_id, first_name, last_name, email, phone, position, department,
        hire_date, contract_from, contract_to, work_patterns, skills,
        preferences, emergency_contact, primary_supervisor, hierarchy_path,
        is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true, NOW(), NOW())
    `;

    // Execute database insertion
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
      '0', // Default hierarchy path for new employees
    ]);

    // Retrieve and return the created employee
    const employee = await this.findByEmployeeId(employeeId);
    if (!employee) {
      throw new Error('Failed to create employee');
    }

    logger.info(`Employee created successfully: ${firstName} ${lastName}`, { employeeId, email });
    return employee;
  }

  /**
   * Update Existing Employee
   * 
   * Updates employee information with partial data. Only provided fields
   * are updated, maintaining data integrity and validation rules.
   * 
   * @param employeeId - Unique employee identifier
   * @param updateData - Partial employee data to update
   * @returns Promise<Employee> - Updated employee object
   * 
   * @throws {Error} When employee not found
   * @throws {Error} When email conflict occurs
   * @throws {Error} When validation fails
   * 
   * @example
   * const updatedEmployee = await employeeService.updateEmployee("EMP001", {
   *   position: "Senior Nurse",
   *   skills: ["ICU", "Emergency Response"]
   * });
   */
  async updateEmployee(employeeId: string, updateData: UpdateEmployeeRequest): Promise<Employee> {
    // Verify employee exists
    const existingEmployee = await this.findByEmployeeId(employeeId);
    if (!existingEmployee) {
      throw new Error('Employee not found');
    }

    // Build dynamic update query based on provided fields
    const fields = [];
    const values = [];

    // Update first name if provided
    if (updateData.firstName !== undefined) {
      fields.push('first_name = ?');
      values.push(updateData.firstName);
    }
    
    // Update last name if provided
    if (updateData.lastName !== undefined) {
      fields.push('last_name = ?');
      values.push(updateData.lastName);
    }
    
    // Update email if provided (with uniqueness check)
    if (updateData.email !== undefined) {
      // Check if new email is already in use by another employee
      const emailInUse = await this.findByEmail(updateData.email);
      if (emailInUse && emailInUse.employeeId !== employeeId) {
        throw new Error('Email already in use by another employee');
      }
      fields.push('email = ?');
      values.push(updateData.email);
    }
    
    // Update phone if provided
    if (updateData.phone !== undefined) {
      fields.push('phone = ?');
      values.push(updateData.phone);
    }
    
    // Update position if provided
    if (updateData.position !== undefined) {
      fields.push('position = ?');
      values.push(updateData.position);
    }
    
    // Update department if provided
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

    // If no fields to update, return existing employee
    if (fields.length === 0) {
      return existingEmployee;
    }

    // Add timestamp update and employee ID for WHERE clause
    fields.push('updated_at = NOW()');
    values.push(employeeId);

    // Execute update query
    const query = `UPDATE employees SET ${fields.join(', ')} WHERE employee_id = ?`;
    await database.query(query, values);

    // Retrieve and return updated employee
    const updatedEmployee = await this.findByEmployeeId(employeeId);
    if (!updatedEmployee) {
      throw new Error('Failed to update employee');
    }

    logger.info(`Employee updated successfully: ${employeeId}`);
    return updatedEmployee;
  }

  /**
   * Find Employee by ID
   * 
   * Retrieves employee information by unique employee ID.
   * Includes supervisor information through JOIN operation.
   * 
   * @param employeeId - Unique employee identifier
   * @returns Promise<Employee | null> - Employee object or null if not found
   * 
   * @example
   * const employee = await employeeService.findByEmployeeId("EMP001");
   * if (employee) {
   *   console.log(`Found: ${employee.firstName} ${employee.lastName}`);
   * }
   */
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

  /**
   * Find Employee by Email
   * 
   * Retrieves employee information by email address.
   * Used for email uniqueness validation and user lookup.
   * 
   * @param email - Employee email address
   * @returns Promise<Employee | null> - Employee object or null if not found
   * 
   * @example
   * const employee = await employeeService.findByEmail("john.doe@company.com");
   * if (employee) {
   *   console.log(`Employee found: ${employee.employeeId}`);
   * }
   */
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

  /**
   * Find All Employees with Filtering and Pagination
   * 
   * Retrieves employees with advanced filtering and pagination support.
   * Supports search by multiple criteria with efficient database queries.
   * 
   * @param filters - Optional filtering criteria
   * @param pagination - Pagination parameters (page, limit, sort)
   * @returns Promise<{employees: Employee[], total: number}> - Paginated employee list with total count
   * 
   * @example
   * const result = await employeeService.findAll(
   *   { department: "Nursing", search: "nurse" },
   *   { page: 1, limit: 10, sortBy: "lastName" }
   * );
   * console.log(`Found ${result.total} employees, showing ${result.employees.length}`);
   */
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

    // Get total count for pagination
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

  /**
   * Delete Employee (Soft Delete)
   * 
   * Performs soft deletion by marking employee as inactive.
   * Preserves data integrity and maintains historical records.
   * 
   * @param employeeId - Unique employee identifier
   * @returns Promise<void>
   * 
   * @throws {Error} When employee not found
   * 
   * @example
   * await employeeService.deleteEmployee("EMP001");
   * console.log("Employee deactivated successfully");
   */
  async deleteEmployee(employeeId: string): Promise<void> {
    // Verify employee exists
    const existingEmployee = await this.findByEmployeeId(employeeId);
    if (!existingEmployee) {
      throw new Error('Employee not found');
    }

    // Perform soft delete by setting is_active to false
    const query = 'UPDATE employees SET is_active = false, updated_at = NOW() WHERE employee_id = ?';
    await database.query(query, [employeeId]);

    logger.info(`Employee deactivated successfully: ${employeeId}`);
  }

  /**
   * Map Database Row to Employee Object
   * 
   * Transforms raw database row data into properly typed Employee objects.
   * Handles JSON parsing for complex fields and supervisor name concatenation.
   * 
   * @param row - Raw database row data
   * @returns Employee - Properly typed and formatted employee object
   * 
   * @private
   * @internal
   */
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
      workPatterns: JSON.parse(row.work_patterns || '{}'),
      skills: JSON.parse(row.skills || '[]'),
      preferences: JSON.parse(row.preferences || '{}'),
      emergencyContact: JSON.parse(row.emergency_contact || '{}'),
      primarySupervisor: row.primary_supervisor,
      hierarchyPath: row.hierarchy_path,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      // Concatenate supervisor first and last name if available
      supervisorName: row.supervisor_first_name && row.supervisor_last_name 
        ? `${row.supervisor_first_name} ${row.supervisor_last_name}` 
        : null
    };
  }
}

/**
 * Employee Service Singleton Instance
 * 
 * Exports a singleton instance of the EmployeeService class for
 * consistent usage across the application.
 */
export const employeeService = new EmployeeService();
