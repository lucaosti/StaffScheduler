import { Pool, RowDataPacket } from 'mysql2/promise';
import { Department, CreateDepartmentRequest, UpdateDepartmentRequest } from '../types';

export class DepartmentService {
  constructor(private pool: Pool) {}

  async getAllDepartments(): Promise<Department[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT 
        d.id,
        d.name,
        d.description,
        d.location,
        d.budget,
        d.isActive,
        d.createdAt,
        d.updatedAt,
        COUNT(DISTINCT ud.userId) as employeeCount,
        GROUP_CONCAT(
          CASE WHEN ud.isManager = 1 
          THEN CONCAT(u.firstName, ' ', u.lastName) 
          END
        ) as managers
      FROM departments d
      LEFT JOIN user_departments ud ON d.id = ud.departmentId
      LEFT JOIN users u ON ud.userId = u.id AND ud.isManager = 1
      WHERE d.isActive = 1
      GROUP BY d.id
      ORDER BY d.name`
    );

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      location: row.location,
      budget: parseFloat(row.budget || '0'),
      isActive: Boolean(row.isActive),
      employeeCount: row.employeeCount,
      managers: row.managers ? row.managers.split(',') : [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }));
  }

  async getDepartmentById(id: number): Promise<Department | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT 
        d.*,
        COUNT(DISTINCT ud.userId) as employeeCount
      FROM departments d
      LEFT JOIN user_departments ud ON d.id = ud.departmentId
      WHERE d.id = ? AND d.isActive = 1
      GROUP BY d.id`,
      [id]
    );

    if (rows.length === 0) return null;

    const department = rows[0];

    // Get department users
    const [userRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT 
        u.id,
        u.firstName,
        u.lastName,
        u.email,
        u.role,
        ud.isManager
      FROM users u
      JOIN user_departments ud ON u.id = ud.userId
      WHERE ud.departmentId = ? AND u.isActive = 1
      ORDER BY ud.isManager DESC, u.lastName`,
      [id]
    );

    return {
      id: department.id,
      name: department.name,
      description: department.description,
      location: department.location,
      budget: parseFloat(department.budget || '0'),
      isActive: Boolean(department.isActive),
      employeeCount: department.employeeCount,
      employees: userRows.map(user => ({
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        isManager: Boolean(user.isManager)
      })),
      createdAt: department.createdAt,
      updatedAt: department.updatedAt
    };
  }

  async createDepartment(data: CreateDepartmentRequest): Promise<Department> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      // Create department
      const [result] = await connection.execute(
        'INSERT INTO departments (name, description, location, budget) VALUES (?, ?, ?, ?)',
        [data.name, data.description || null, data.location || null, data.budget || 0]
      );

      const departmentId = (result as any).insertId;

      // Assign manager if specified
      if (data.managerId) {
        await connection.execute(
          'INSERT INTO user_departments (userId, departmentId, isManager) VALUES (?, ?, 1)',
          [data.managerId, departmentId]
        );
      }

      await connection.commit();

      const newDepartment = await this.getDepartmentById(departmentId);
      if (!newDepartment) {
        throw new Error('Failed to retrieve created department');
      }

      return newDepartment;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async updateDepartment(id: number, data: UpdateDepartmentRequest): Promise<Department> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      // Update department basic info
      const updateFields: string[] = [];
      const updateValues: any[] = [];

      if (data.name !== undefined) {
        updateFields.push('name = ?');
        updateValues.push(data.name);
      }
      if (data.description !== undefined) {
        updateFields.push('description = ?');
        updateValues.push(data.description);
      }
      if (data.location !== undefined) {
        updateFields.push('location = ?');
        updateValues.push(data.location);
      }
      if (data.budget !== undefined) {
        updateFields.push('budget = ?');
        updateValues.push(data.budget);
      }

      if (updateFields.length > 0) {
        updateFields.push('updatedAt = CURRENT_TIMESTAMP');
        updateValues.push(id);

        await connection.execute(
          `UPDATE departments SET ${updateFields.join(', ')} WHERE id = ?`,
          updateValues
        );
      }

      // Update manager assignment if specified
      if (data.managerId !== undefined) {
        // Remove existing managers
        await connection.execute(
          'UPDATE user_departments SET isManager = 0 WHERE departmentId = ?',
          [id]
        );

        // Add new manager if specified
        if (data.managerId) {
          // Check if user is already in department
          const [existing] = await connection.execute<RowDataPacket[]>(
            'SELECT id FROM user_departments WHERE userId = ? AND departmentId = ?',
            [data.managerId, id]
          );

          if (existing.length === 0) {
            // Add user to department as manager
            await connection.execute(
              'INSERT INTO user_departments (userId, departmentId, isManager) VALUES (?, ?, 1)',
              [data.managerId, id]
            );
          } else {
            // Update existing assignment to manager
            await connection.execute(
              'UPDATE user_departments SET isManager = 1 WHERE userId = ? AND departmentId = ?',
              [data.managerId, id]
            );
          }
        }
      }

      await connection.commit();

      const updatedDepartment = await this.getDepartmentById(id);
      if (!updatedDepartment) {
        throw new Error('Failed to retrieve updated department');
      }

      return updatedDepartment;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async deleteDepartment(id: number): Promise<void> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      // Check if department has active users
      const [userCount] = await connection.execute<RowDataPacket[]>(
        'SELECT COUNT(*) as count FROM user_departments WHERE departmentId = ?',
        [id]
      );

      if (userCount[0].count > 0) {
        throw new Error('Cannot delete department with active users. Please reassign users first.');
      }

      // Soft delete the department
      await connection.execute(
        'UPDATE departments SET isActive = 0, updatedAt = CURRENT_TIMESTAMP WHERE id = ?',
        [id]
      );

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async getDepartmentsForUser(userId: number): Promise<Department[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT 
        d.id,
        d.name,
        d.description,
        d.location,
        d.budget,
        d.isActive,
        ud.isManager,
        d.createdAt,
        d.updatedAt
      FROM departments d
      JOIN user_departments ud ON d.id = ud.departmentId
      WHERE ud.userId = ? AND d.isActive = 1
      ORDER BY d.name`,
      [userId]
    );

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      location: row.location,
      budget: parseFloat(row.budget || '0'),
      isActive: Boolean(row.isActive),
      isManager: Boolean(row.isManager),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }));
  }

  async addUserToDepartment(userId: number, departmentId: number, isManager: boolean = false): Promise<void> {
    // Check if assignment already exists
    const [existing] = await this.pool.execute<RowDataPacket[]>(
      'SELECT id FROM user_departments WHERE userId = ? AND departmentId = ?',
      [userId, departmentId]
    );

    if (existing.length > 0) {
      // Update existing assignment
      await this.pool.execute(
        'UPDATE user_departments SET isManager = ? WHERE userId = ? AND departmentId = ?',
        [isManager ? 1 : 0, userId, departmentId]
      );
    } else {
      // Create new assignment
      await this.pool.execute(
        'INSERT INTO user_departments (userId, departmentId, isManager) VALUES (?, ?, ?)',
        [userId, departmentId, isManager ? 1 : 0]
      );
    }
  }

  async removeUserFromDepartment(userId: number, departmentId: number): Promise<void> {
    await this.pool.execute(
      'DELETE FROM user_departments WHERE userId = ? AND departmentId = ?',
      [userId, departmentId]
    );
  }

  async getDepartmentStats(departmentId: number): Promise<any> {
    // Get basic stats
    const [stats] = await this.pool.execute<RowDataPacket[]>(
      `SELECT 
        COUNT(DISTINCT ud.userId) as totalEmployees,
        COUNT(DISTINCT CASE WHEN ud.isManager = 1 THEN ud.userId END) as totalManagers,
        COUNT(DISTINCT CASE WHEN u.role = 'employee' THEN ud.userId END) as totalRegularEmployees
      FROM user_departments ud
      LEFT JOIN users u ON ud.userId = u.id
      WHERE ud.departmentId = ? AND u.isActive = 1`,
      [departmentId]
    );

    // Get skills distribution
    const [skills] = await this.pool.execute<RowDataPacket[]>(
      `SELECT 
        s.name as skillName,
        COUNT(us.userId) as employeeCount,
        AVG(us.proficiencyLevel) as avgProficiency
      FROM skills s
      LEFT JOIN user_skills us ON s.id = us.skillId
      LEFT JOIN user_departments ud ON us.userId = ud.userId
      WHERE ud.departmentId = ?
      GROUP BY s.id, s.name
      ORDER BY employeeCount DESC`,
      [departmentId]
    );

    return {
      ...stats[0],
      skills: skills
    };
  }
}
