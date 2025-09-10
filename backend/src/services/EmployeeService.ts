import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { Employee, CreateEmployeeRequest, UpdateEmployeeRequest } from '../types';

export class EmployeeService {
  constructor(private pool: Pool) {}

  async getAllEmployees(): Promise<Employee[]> {
    const query = `
      SELECT 
        u.user_id as id,
        u.username,
        u.email,
        u.first_name as firstName,
        u.last_name as lastName,
        u.role,
        u.phone,
        u.is_active as isActive,
        u.created_at as createdAt,
        u.updated_at as updatedAt,
        e.employee_number as employeeId,
        e.department_id,
        e.hire_date,
        e.salary,
        e.status,
        e.position,
        e.address,
        e.emergency_contact,
        e.notes,
        d.name as department_name
      FROM users u
      LEFT JOIN employees e ON u.user_id = e.user_id
      LEFT JOIN departments d ON e.department_id = d.department_id
      WHERE u.role IN ('employee', 'department_manager', 'manager') 
      AND u.is_active = 1
      ORDER BY u.last_name, u.first_name
    `;
    
    const [rows] = await this.pool.execute<RowDataPacket[]>(query);
    return rows.map(row => ({
      id: row.id,
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      role: row.role,
      employeeId: row.employeeId,
      phone: row.phone,
      isActive: row.isActive === 1,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }));
  }

  async getEmployeeById(id: number): Promise<Employee | null> {
    const query = `
      SELECT 
        u.user_id as id,
        u.username,
        u.email,
        u.first_name as firstName,
        u.last_name as lastName,
        u.role,
        u.phone,
        u.is_active as isActive,
        u.created_at as createdAt,
        u.updated_at as updatedAt,
        e.employee_number as employeeId,
        e.department_id,
        e.hire_date,
        e.salary,
        e.status,
        e.position,
        e.address,
        e.emergency_contact,
        e.notes,
        d.name as department_name
      FROM users u
      LEFT JOIN employees e ON u.user_id = e.user_id
      LEFT JOIN departments d ON e.department_id = d.department_id
      WHERE u.user_id = ?
    `;
    
    const [rows] = await this.pool.execute<RowDataPacket[]>(query, [id]);
    if (rows.length === 0) return null;
    
    const row = rows[0];
    return {
      id: row.id,
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      role: row.role,
      employeeId: row.employeeId,
      phone: row.phone,
      isActive: row.isActive === 1,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  async createEmployee(employeeData: CreateEmployeeRequest): Promise<number> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      // First create the user
      const userQuery = `
        INSERT INTO users (email, password_hash, first_name, last_name, role, phone, is_active)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `;
      
      const [userResult] = await connection.execute<ResultSetHeader>(userQuery, [
        employeeData.email,
        '$2b$10$defaulthash', // Should be hashed password
        employeeData.firstName,
        employeeData.lastName,
        employeeData.role,
        employeeData.phone || null
      ]);

      const userId = userResult.insertId;

      // Create employee record if needed
      if (employeeData.employeeId || employeeData.departmentIds?.length) {
        // Get the next employee number if not provided
        let employeeNumber = employeeData.employeeId;
        if (!employeeNumber) {
          const [numberRows] = await connection.execute<RowDataPacket[]>(
            'SELECT COALESCE(MAX(CAST(employee_number AS UNSIGNED)), 0) + 1 as next_number FROM employees'
          );
          employeeNumber = numberRows[0].next_number.toString().padStart(6, '0');
        }

        const empQuery = `
          INSERT INTO employees (user_id, employee_number, department_id, hire_date, status)
          VALUES (?, ?, ?, ?, 'active')
        `;
        
        await connection.execute(empQuery, [
          userId,
          employeeNumber,
          employeeData.departmentIds?.[0] || null,
          new Date()
        ]);
      }

      // Add department assignments
      if (employeeData.departmentIds?.length) {
        for (const deptId of employeeData.departmentIds) {
          const deptQuery = `
            INSERT INTO user_departments (user_id, department_id, is_manager)
            VALUES (?, ?, ?)
          `;
          await connection.execute(deptQuery, [
            userId, 
            deptId, 
            employeeData.role === 'department_manager' ? 1 : 0
          ]);
        }
      }

      await connection.commit();
      return userId;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async updateEmployee(id: number, employeeData: UpdateEmployeeRequest): Promise<boolean> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      // Update user table
      const userUpdates: string[] = [];
      const userValues: any[] = [];
      
      if (employeeData.email !== undefined) {
        userUpdates.push('email = ?');
        userValues.push(employeeData.email);
      }
      if (employeeData.firstName !== undefined) {
        userUpdates.push('first_name = ?');
        userValues.push(employeeData.firstName);
      }
      if (employeeData.lastName !== undefined) {
        userUpdates.push('last_name = ?');
        userValues.push(employeeData.lastName);
      }
      if (employeeData.role !== undefined) {
        userUpdates.push('role = ?');
        userValues.push(employeeData.role);
      }
      if (employeeData.phone !== undefined) {
        userUpdates.push('phone = ?');
        userValues.push(employeeData.phone);
      }
      if (employeeData.isActive !== undefined) {
        userUpdates.push('is_active = ?');
        userValues.push(employeeData.isActive ? 1 : 0);
      }
      
      if (userUpdates.length > 0) {
        userValues.push(id);
        const userQuery = `UPDATE users SET ${userUpdates.join(', ')} WHERE user_id = ?`;
        await connection.execute(userQuery, userValues);
      }

      // Update department assignments if provided
      if (employeeData.departmentIds !== undefined) {
        // Remove existing assignments
        await connection.execute('DELETE FROM user_departments WHERE user_id = ?', [id]);
        
        // Add new assignments
        for (const deptId of employeeData.departmentIds) {
          const deptQuery = `
            INSERT INTO user_departments (user_id, department_id, is_manager)
            VALUES (?, ?, ?)
          `;
          await connection.execute(deptQuery, [
            id, 
            deptId, 
            employeeData.role === 'department_manager' ? 1 : 0
          ]);
        }
      }

      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async deleteEmployee(id: number): Promise<boolean> {
    // Soft delete - set user as inactive
    const query = 'UPDATE users SET is_active = 0 WHERE user_id = ?';
    const [result] = await this.pool.execute<ResultSetHeader>(query, [id]);
    return result.affectedRows > 0;
  }

  async getEmployeesByDepartment(departmentId: number): Promise<Employee[]> {
    const query = `
      SELECT 
        u.user_id as id,
        u.username,
        u.email,
        u.first_name as firstName,
        u.last_name as lastName,
        u.role,
        u.phone,
        u.is_active as isActive,
        u.created_at as createdAt,
        u.updated_at as updatedAt,
        e.employee_number as employeeId
      FROM users u
      LEFT JOIN employees e ON u.user_id = e.user_id
      INNER JOIN user_departments ud ON u.user_id = ud.user_id
      WHERE ud.department_id = ? AND u.is_active = 1
      ORDER BY u.last_name, u.first_name
    `;
    
    const [rows] = await this.pool.execute<RowDataPacket[]>(query, [departmentId]);
    return rows.map(row => ({
      id: row.id,
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      role: row.role,
      employeeId: row.employeeId,
      phone: row.phone,
      isActive: row.isActive === 1,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }));
  }

  async getEmployeeSkills(employeeId: number): Promise<any[]> {
    const query = `
      SELECT 
        us.skill_id as skillId,
        us.proficiency_level as proficiencyLevel,
        s.name as skillName,
        s.description,
        s.category
      FROM user_skills us
      LEFT JOIN skills s ON us.skill_id = s.skill_id
      WHERE us.user_id = ? AND s.is_active = 1
      ORDER BY s.category, s.name
    `;
    
    const [rows] = await this.pool.execute<RowDataPacket[]>(query, [employeeId]);
    return rows;
  }

  async addEmployeeSkill(employeeId: number, skillId: number, proficiencyLevel: number): Promise<boolean> {
    const query = `
      INSERT INTO user_skills (user_id, skill_id, proficiency_level)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE proficiency_level = VALUES(proficiency_level)
    `;
    
    const [result] = await this.pool.execute<ResultSetHeader>(query, [employeeId, skillId, proficiencyLevel]);
    return result.affectedRows > 0;
  }

  async removeEmployeeSkill(employeeId: number, skillId: number): Promise<boolean> {
    const query = 'DELETE FROM user_skills WHERE user_id = ? AND skill_id = ?';
    const [result] = await this.pool.execute<ResultSetHeader>(query, [employeeId, skillId]);
    return result.affectedRows > 0;
  }
}
