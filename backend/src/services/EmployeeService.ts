/**
 * Employee Service
 * 
 * Specialized service for managing employee users. This service provides
 * employee-specific methods that wrap UserService functionality with
 * role filtering for employees only.
 * 
 * @module services/EmployeeService
 * @author Staff Scheduler Team
 */

import { Pool } from 'mysql2/promise';
import { UserService } from './UserService';
import { User } from '../types';
import { logger } from '../config/logger';

/**
 * EmployeeService Class
 * 
 * Provides employee-specific operations by filtering UserService results
 * to only include users with the 'employee' role.
 */
export class EmployeeService {
  private userService: UserService;

  /**
   * Creates a new EmployeeService instance
   * 
   * @param pool - MySQL connection pool for database operations
   */
  constructor(private pool: Pool) {
    this.userService = new UserService(pool);
  }

  /**
   * Gets all employees (users with role 'employee')
   * 
   * @param filters - Optional filters (department, active status)
   * @returns Promise resolving to array of employee users
   */
  async getAllEmployees(filters?: {
    departmentId?: number;
    isActive?: boolean;
    search?: string;
  }): Promise<User[]> {
    try {
      return await this.userService.getAllUsers({
        ...filters,
        role: 'employee'
      });
    } catch (error) {
      logger.error('Error getting all employees:', error);
      throw error;
    }
  }

  /**
   * Gets an employee by ID
   * 
   * Validates that the user is an employee before returning.
   * 
   * @param id - Employee ID
   * @returns Promise resolving to employee user or null
   */
  async getEmployeeById(id: number): Promise<User | null> {
    try {
      const user = await this.userService.getUserById(id);
      if (user && user.role !== 'employee') {
        return null;
      }
      return user;
    } catch (error) {
      logger.error('Error getting employee by ID:', error);
      throw error;
    }
  }

  /**
   * Gets employees by department
   * 
   * @param departmentId - Department ID
   * @returns Promise resolving to array of employees
   */
  async getEmployeesByDepartment(departmentId: number): Promise<User[]> {
    try {
      return await this.userService.getUsersByDepartment(departmentId);
    } catch (error) {
      logger.error('Error getting employees by department:', error);
      throw error;
    }
  }

  /**
   * Gets employee statistics
   * 
   * @returns Promise resolving to employee statistics
   */
  async getEmployeeStatistics(): Promise<{
    total: number;
    active: number;
    inactive: number;
  }> {
    try {
      const stats = await this.userService.getUserStatistics();
      const employeeCount = stats.byRole.find(r => r.role === 'employee')?.count || 0;
      
      // Calculate active/inactive employees only
      const employees = await this.getAllEmployees();
      const activeCount = employees.filter(e => e.isActive).length;
      
      return {
        total: employeeCount,
        active: activeCount,
        inactive: employeeCount - activeCount
      };
    } catch (error) {
      logger.error('Error getting employee statistics:', error);
      throw error;
    }
  }

  /**
   * Gets available employees for a shift
   * 
   * Returns employees who are not assigned to any shift that conflicts
   * with the given time range.
   * 
   * @param departmentId - Department ID
   * @param date - Shift date
   * @param startTime - Shift start time
   * @param endTime - Shift end time
   * @returns Promise resolving to array of available employees
   */
  async getAvailableEmployees(
    departmentId: number,
    date: string,
    startTime: string,
    endTime: string
  ): Promise<User[]> {
    try {
      // This is a simplified version. In a real implementation, you would
      // check against assignments, availability preferences, and time-off requests
      return await this.getAllEmployees({ 
        departmentId, 
        isActive: true 
      });
    } catch (error) {
      logger.error('Error getting available employees:', error);
      throw error;
    }
  }

  /**
   * Creates a new employee user
   * 
   * @param userData - Employee creation data
   * @returns Promise resolving to the created employee
   */
  async createEmployee(userData: any): Promise<User> {
    try {
      return await this.userService.createUser({
        ...userData,
        role: 'employee'
      });
    } catch (error) {
      logger.error('Error creating employee:', error);
      throw error;
    }
  }

  /**
   * Updates an employee user
   * 
   * @param id - Employee ID
   * @param userData - Employee update data
   * @returns Promise resolving to the updated employee
   */
  async updateEmployee(id: number, userData: any): Promise<User> {
    try {
      const employee = await this.getEmployeeById(id);
      if (!employee) {
        throw new Error('Employee not found');
      }
      return await this.userService.updateUser(id, userData);
    } catch (error) {
      logger.error('Error updating employee:', error);
      throw error;
    }
  }

  /**
   * Deletes (soft deletes) an employee user
   * 
   * @param id - Employee ID
   * @returns Promise resolving to success boolean
   */
  async deleteEmployee(id: number): Promise<boolean> {
    try {
      const employee = await this.getEmployeeById(id);
      if (!employee) {
        throw new Error('Employee not found');
      }
      return await this.userService.deleteUser(id);
    } catch (error) {
      logger.error('Error deleting employee:', error);
      throw error;
    }
  }

  /**
   * Gets skills for an employee
   * 
   * @param employeeId - Employee ID
   * @returns Promise resolving to array of skills
   */
  async getEmployeeSkills(employeeId: number): Promise<any[]> {
    try {
      const [rows] = await this.pool.execute<any[]>(
        `SELECT 
          s.id,
          s.name,
          s.description,
          us.proficiency_level AS proficiencyLevel
        FROM user_skills us
        INNER JOIN skills s ON us.skill_id = s.id
        WHERE us.user_id = ?
        ORDER BY s.name`,
        [employeeId]
      );
      return rows;
    } catch (error) {
      logger.error('Error getting employee skills:', error);
      throw error;
    }
  }

  /**
   * Adds a skill to an employee
   * 
   * @param employeeId - Employee ID
   * @param skillId - Skill ID
   * @param proficiencyLevel - Proficiency level (1-5)
   * @returns Promise resolving when complete
   */
  async addEmployeeSkill(employeeId: number, skillId: number, proficiencyLevel?: number): Promise<void> {
    try {
      await this.pool.execute(
        `INSERT INTO user_skills (user_id, skill_id, proficiency_level)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE proficiency_level = VALUES(proficiency_level)`,
        [employeeId, skillId, proficiencyLevel || 1]
      );
      logger.info(`Skill ${skillId} added to employee ${employeeId}`);
    } catch (error) {
      logger.error('Error adding employee skill:', error);
      throw error;
    }
  }

  /**
   * Removes a skill from an employee
   * 
   * @param employeeId - Employee ID
   * @param skillId - Skill ID
   * @returns Promise resolving when complete
   */
  async removeEmployeeSkill(employeeId: number, skillId: number): Promise<void> {
    try {
      await this.pool.execute(
        'DELETE FROM user_skills WHERE user_id = ? AND skill_id = ?',
        [employeeId, skillId]
      );
      logger.info(`Skill ${skillId} removed from employee ${employeeId}`);
    } catch (error) {
      logger.error('Error removing employee skill:', error);
      throw error;
    }
  }
}
