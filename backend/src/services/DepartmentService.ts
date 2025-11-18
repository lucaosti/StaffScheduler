/**
 * Department Service
 * 
 * Handles all department-related business logic including CRUD operations,
 * employee management, and department statistics.
 * 
 * @module services/DepartmentService
 * @author Staff Scheduler Team
 */

import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { 
  Department, 
  CreateDepartmentRequest, 
  UpdateDepartmentRequest 
} from '../types';
import { logger } from '../config/logger';

/**
 * DepartmentService Class
 * 
 * Provides comprehensive department management functionality including:
 * - Department CRUD operations
 * - Employee assignment tracking
 * - Department statistics and reporting
 * - Manager assignment
 */
export class DepartmentService {
  /**
   * Creates a new DepartmentService instance
   * 
   * @param pool - MySQL connection pool for database operations
   */
  constructor(private pool: Pool) {}

  /**
   * Creates a new department
   * 
   * @param deptData - Department creation data
   * @returns Promise resolving to the created department
   * @throws Error if department name already exists or creation fails
   */
  async createDepartment(deptData: CreateDepartmentRequest): Promise<Department> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      // Check if department name already exists
      const [existing] = await connection.execute<RowDataPacket[]>(
        'SELECT id FROM departments WHERE name = ? LIMIT 1',
        [deptData.name]
      );

      if (existing.length > 0) {
        throw new Error('Department name already exists');
      }

      // Validate manager if provided
      if (deptData.managerId) {
        const [managerRows] = await connection.execute<RowDataPacket[]>(
          'SELECT id FROM users WHERE id = ? AND is_active = 1 LIMIT 1',
          [deptData.managerId]
        );

        if (managerRows.length === 0) {
          throw new Error('Invalid manager ID');
        }
      }

      // Insert department record
      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO departments (name, description, manager_id, is_active)
         VALUES (?, ?, ?, ?)`,
        [
          deptData.name,
          deptData.description || null,
          deptData.managerId || null,
          true
        ]
      );

      const departmentId = result.insertId;

      await connection.commit();

      logger.info(`Department created successfully: ${deptData.name}`, { departmentId });

      // Retrieve and return the created department
      const newDepartment = await this.getDepartmentById(departmentId);
      if (!newDepartment) {
        throw new Error('Failed to retrieve created department');
      }

      return newDepartment;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to create department:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Retrieves a department by its unique identifier
   * 
   * Includes:
   * - Basic department information
   * - Manager details
   * - Employee count
   * 
   * @param id - Department ID
   * @returns Promise resolving to Department object or null if not found
   */
  async getDepartmentById(id: number): Promise<Department | null> {
    try {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT 
          d.id, d.name, d.description, d.manager_id, d.is_active,
          d.created_at, d.updated_at,
          u.first_name as manager_first_name,
          u.last_name as manager_last_name,
          COUNT(DISTINCT ud.user_id) as employee_count
        FROM departments d
        LEFT JOIN users u ON d.manager_id = u.id
        LEFT JOIN user_departments ud ON d.id = ud.department_id
        WHERE d.id = ?
        GROUP BY d.id`,
        [id]
      );

      if (rows.length === 0) {
        return null;
      }

      const row = rows[0];

      const department: Department = {
        id: row.id,
        name: row.name,
        description: row.description,
        managerId: row.manager_id,
        managerName: row.manager_first_name && row.manager_last_name
          ? `${row.manager_first_name} ${row.manager_last_name}`
          : undefined,
        isActive: Boolean(row.is_active),
        employeeCount: row.employee_count || 0,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };

      return department;
    } catch (error) {
      logger.error('Failed to get department by ID:', error);
      throw error;
    }
  }

  /**
   * Retrieves all departments with optional filtering
   * 
   * @param filters - Optional filters for active status and search
   * @returns Promise resolving to array of departments
   */
  async getAllDepartments(filters?: {
    isActive?: boolean;
    search?: string;
  }): Promise<Department[]> {
    try {
      let query = `
        SELECT 
          d.id, d.name, d.description, d.manager_id, d.is_active,
          d.created_at, d.updated_at,
          u.first_name as manager_first_name,
          u.last_name as manager_last_name,
          COUNT(DISTINCT ud.user_id) as employee_count
        FROM departments d
        LEFT JOIN users u ON d.manager_id = u.id
        LEFT JOIN user_departments ud ON d.id = ud.department_id
      `;

      const conditions: string[] = [];
      const params: any[] = [];

      if (filters?.isActive !== undefined) {
        conditions.push('d.is_active = ?');
        params.push(filters.isActive ? 1 : 0);
      }

      if (filters?.search) {
        conditions.push('(d.name LIKE ? OR d.description LIKE ?)');
        const searchTerm = `%${filters.search}%`;
        params.push(searchTerm, searchTerm);
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      query += ' GROUP BY d.id ORDER BY d.name ASC';

      const [rows] = await this.pool.execute<RowDataPacket[]>(query, params);

      const departments: Department[] = rows.map(row => ({
        id: row.id,
        name: row.name,
        description: row.description,
        managerId: row.manager_id,
        managerName: row.manager_first_name && row.manager_last_name
          ? `${row.manager_first_name} ${row.manager_last_name}`
          : undefined,
        isActive: Boolean(row.is_active),
        employeeCount: row.employee_count || 0,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));

      return departments;
    } catch (error) {
      logger.error('Failed to get all departments:', error);
      throw error;
    }
  }

  /**
   * Updates an existing department
   * 
   * Allows partial updates of department information.
   * 
   * @param id - Department ID
   * @param deptData - Partial department data to update
   * @returns Promise resolving to updated department
   * @throws Error if department not found or update fails
   */
  async updateDepartment(id: number, deptData: UpdateDepartmentRequest): Promise<Department> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      // Build dynamic update query
      const updates: string[] = [];
      const values: any[] = [];

      if (deptData.name !== undefined) {
        // Check name uniqueness if changing
        const [existing] = await connection.execute<RowDataPacket[]>(
          'SELECT id FROM departments WHERE name = ? AND id != ? LIMIT 1',
          [deptData.name, id]
        );
        if (existing.length > 0) {
          throw new Error('Department name already in use');
        }
        updates.push('name = ?');
        values.push(deptData.name);
      }

      if (deptData.description !== undefined) {
        updates.push('description = ?');
        values.push(deptData.description);
      }

      if (deptData.managerId !== undefined) {
        if (deptData.managerId !== null) {
          // Validate manager exists
          const [managerRows] = await connection.execute<RowDataPacket[]>(
            'SELECT id FROM users WHERE id = ? AND is_active = 1 LIMIT 1',
            [deptData.managerId]
          );
          if (managerRows.length === 0) {
            throw new Error('Invalid manager ID');
          }
        }
        updates.push('manager_id = ?');
        values.push(deptData.managerId);
      }

      if (deptData.isActive !== undefined) {
        updates.push('is_active = ?');
        values.push(deptData.isActive ? 1 : 0);
      }

      // Execute update if there are changes
      if (updates.length > 0) {
        values.push(id);
        await connection.execute(
          `UPDATE departments SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          values
        );
      }

      await connection.commit();

      logger.info(`Department updated successfully: ${id}`);

      // Retrieve and return updated department
      const updatedDepartment = await this.getDepartmentById(id);
      if (!updatedDepartment) {
        throw new Error('Department not found after update');
      }

      return updatedDepartment;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to update department:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Soft deletes a department by setting is_active to false
   * 
   * @param id - Department ID to delete
   * @returns Promise resolving to true if successful
   * @throws Error if department has active employees
   */
  async deleteDepartment(id: number): Promise<boolean> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      // Check if department has employees
      const [employeeRows] = await connection.execute<RowDataPacket[]>(
        'SELECT COUNT(*) as count FROM user_departments WHERE department_id = ?',
        [id]
      );

      if (employeeRows[0].count > 0) {
        throw new Error('Cannot delete department with assigned employees');
      }

      // Soft delete the department
      const [result] = await connection.execute<ResultSetHeader>(
        'UPDATE departments SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [id]
      );

      if (result.affectedRows === 0) {
        throw new Error('Department not found');
      }

      await connection.commit();

      logger.info(`Department deleted successfully: ${id}`);
      return true;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to delete department:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Gets all employees in a department
   * 
   * @param departmentId - Department ID
   * @returns Promise resolving to array of users
   */
  async getDepartmentEmployees(departmentId: number): Promise<Array<{
    id: number;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    employeeId?: string;
  }>> {
    try {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.employee_id
        FROM users u
        JOIN user_departments ud ON u.id = ud.user_id
        WHERE ud.department_id = ? AND u.is_active = 1
        ORDER BY u.last_name, u.first_name`,
        [departmentId]
      );

      return rows.map(row => ({
        id: row.id,
        email: row.email,
        firstName: row.first_name,
        lastName: row.last_name,
        role: row.role,
        employeeId: row.employee_id
      }));
    } catch (error) {
      logger.error('Failed to get department employees:', error);
      throw error;
    }
  }

  /**
   * Assigns multiple employees to a department
   * 
   * @param departmentId - Department ID
   * @param userIds - Array of user IDs to assign
   * @returns Promise resolving when complete
   */
  async assignEmployeesToDepartment(departmentId: number, userIds: number[]): Promise<void> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      // Verify department exists
      const [deptRows] = await connection.execute<RowDataPacket[]>(
        'SELECT id FROM departments WHERE id = ? AND is_active = 1 LIMIT 1',
        [departmentId]
      );

      if (deptRows.length === 0) {
        throw new Error('Department not found');
      }

      // Assign each user
      for (const userId of userIds) {
        // Check if user exists and is active
        const [userRows] = await connection.execute<RowDataPacket[]>(
          'SELECT id FROM users WHERE id = ? AND is_active = 1 LIMIT 1',
          [userId]
        );

        if (userRows.length === 0) {
          logger.warn(`Skipping invalid user: ${userId}`);
          continue;
        }

        // Check if already assigned
        const [existing] = await connection.execute<RowDataPacket[]>(
          'SELECT id FROM user_departments WHERE user_id = ? AND department_id = ? LIMIT 1',
          [userId, departmentId]
        );

        if (existing.length === 0) {
          await connection.execute(
            'INSERT INTO user_departments (user_id, department_id) VALUES (?, ?)',
            [userId, departmentId]
          );
        }
      }

      await connection.commit();
      logger.info(`Employees assigned to department: ${departmentId}`, { userIds });
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to assign employees to department:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Removes an employee from a department
   * 
   * @param departmentId - Department ID
   * @param userId - User ID to remove
   * @returns Promise resolving when complete
   */
  async removeEmployeeFromDepartment(departmentId: number, userId: number): Promise<void> {
    try {
      await this.pool.execute(
        'DELETE FROM user_departments WHERE user_id = ? AND department_id = ?',
        [userId, departmentId]
      );

      logger.info(`Employee removed from department: ${userId} from ${departmentId}`);
    } catch (error) {
      logger.error('Failed to remove employee from department:', error);
      throw error;
    }
  }

  /**
   * Gets department statistics
   * 
   * @returns Promise resolving to statistics object
   */
  async getDepartmentStatistics(): Promise<{
    total: number;
    active: number;
    inactive: number;
    totalEmployees: number;
    averageEmployeesPerDepartment: number;
  }> {
    try {
      const [totalRows] = await this.pool.execute<RowDataPacket[]>(
        'SELECT COUNT(*) as count FROM departments'
      );

      const [activeRows] = await this.pool.execute<RowDataPacket[]>(
        'SELECT COUNT(*) as count FROM departments WHERE is_active = 1'
      );

      const [employeeRows] = await this.pool.execute<RowDataPacket[]>(
        'SELECT COUNT(DISTINCT user_id) as count FROM user_departments'
      );

      const total = totalRows[0].count;
      const active = activeRows[0].count;
      const totalEmployees = employeeRows[0].count;

      return {
        total,
        active,
        inactive: total - active,
        totalEmployees,
        averageEmployeesPerDepartment: active > 0 ? Math.round(totalEmployees / active) : 0
      };
    } catch (error) {
      logger.error('Failed to get department statistics:', error);
      throw error;
    }
  }

  /**
   * Gets departments managed by a specific user
   * 
   * @param managerId - Manager user ID
   * @returns Promise resolving to array of departments
   */
  async getDepartmentsByManager(managerId: number): Promise<Department[]> {
    try {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT 
          d.id, d.name, d.description, d.manager_id, d.is_active,
          d.created_at, d.updated_at,
          u.first_name as manager_first_name,
          u.last_name as manager_last_name,
          COUNT(DISTINCT ud.user_id) as employee_count
        FROM departments d
        LEFT JOIN users u ON d.manager_id = u.id
        LEFT JOIN user_departments ud ON d.id = ud.department_id
        WHERE d.manager_id = ? AND d.is_active = 1
        GROUP BY d.id
        ORDER BY d.name ASC`,
        [managerId]
      );

      return rows.map(row => ({
        id: row.id,
        name: row.name,
        description: row.description,
        managerId: row.manager_id,
        managerName: row.manager_first_name && row.manager_last_name
          ? `${row.manager_first_name} ${row.manager_last_name}`
          : undefined,
        isActive: Boolean(row.is_active),
        employeeCount: row.employee_count || 0,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
    } catch (error) {
      logger.error('Failed to get departments by manager:', error);
      throw error;
    }
  }

  /**
   * Gets all departments for a specific user
   * 
   * @param userId - User ID
   * @returns Promise resolving to array of departments
   */
  async getDepartmentsForUser(userId: number): Promise<Department[]> {
    try {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT 
          d.id,
          d.name,
          d.description,
          d.manager_id AS managerId,
          d.is_active AS isActive,
          d.created_at AS createdAt,
          d.updated_at AS updatedAt,
          COUNT(DISTINCT ud.user_id) AS userCount,
          COUNT(DISTINCT s.id) AS shiftCount,
          CONCAT(u.first_name, ' ', u.last_name) AS managerName
        FROM departments d
        INNER JOIN user_departments ud2 ON d.id = ud2.department_id
        LEFT JOIN user_departments ud ON d.id = ud.department_id
        LEFT JOIN shifts s ON d.id = s.department_id
        LEFT JOIN users u ON d.manager_id = u.id
        WHERE ud2.user_id = ?
        GROUP BY d.id
        ORDER BY d.name`,
        [userId]
      );

      return rows as Department[];
    } catch (error) {
      logger.error('Error getting departments for user:', error);
      throw error;
    }
  }

  /**
   * Adds a user to a department
   * 
   * @param departmentId - Department ID
   * @param userId - User ID
   * @returns Promise resolving when complete
   */
  async addUserToDepartment(departmentId: number, userId: number): Promise<void> {
    return this.assignEmployeesToDepartment(departmentId, [userId]);
  }

  /**
   * Removes a user from a department
   * 
   * @param departmentId - Department ID
   * @param userId - User ID
   * @returns Promise resolving when complete
   */
  async removeUserFromDepartment(departmentId: number, userId: number): Promise<void> {
    return this.removeEmployeeFromDepartment(departmentId, userId);
  }

  /**
   * Gets department statistics (alias for getDepartmentStatistics)
   * 
   * @returns Promise resolving to department statistics
   */
  async getDepartmentStats(): Promise<{
    total: number;
    active: number;
    inactive: number;
    totalEmployees: number;
    averageEmployeesPerDepartment: number;
  }> {
    return this.getDepartmentStatistics();
  }
}
