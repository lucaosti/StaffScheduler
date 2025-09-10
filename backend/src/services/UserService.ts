import { Pool, RowDataPacket } from 'mysql2/promise';
import bcrypt from 'bcrypt';
import { User, CreateUserRequest, UpdateUserRequest } from '../types';

export class UserService {
  constructor(private pool: Pool) {}

  async createUser(userData: CreateUserRequest): Promise<User> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      // Hash password
      const passwordHash = await bcrypt.hash(userData.password, 12);

      // Create user
      const [result] = await connection.execute(`
        INSERT INTO users (
          email, password_hash, first_name, last_name, role, phone, employee_id, salt
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        userData.email,
        passwordHash,
        userData.firstName,
        userData.lastName,
        userData.role,
        userData.phone || null,
        userData.employeeId || null,
        'defaultsalt' // TODO: generate random salt
      ]);

      const userId = (result as any).insertId;

      // Insert department assignments
      if (userData.departmentIds && userData.departmentIds.length > 0) {
        for (const departmentId of userData.departmentIds) {
          await connection.execute(
            'INSERT INTO user_departments (userId, departmentId, isManager) VALUES (?, ?, ?)',
            [userId, departmentId, false]
          );
        }
      }

      // Insert skill assignments
      if (userData.skillIds && userData.skillIds.length > 0) {
        for (const skillId of userData.skillIds) {
          await connection.execute(
            'INSERT INTO user_skills (userId, skillId, proficiencyLevel) VALUES (?, ?, ?)',
            [userId, skillId, 1]
          );
        }
      }

      await connection.commit();

      const newUser = await this.getUserById(userId);
      if (!newUser) {
        throw new Error('Failed to retrieve created user');
      }

      return newUser;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async getUserById(id: number): Promise<User | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT 
        u.id,
        u.email,
        u.first_name,
        u.last_name,
        u.role,
        u.employee_id,
        u.phone,
        u.is_active,
        u.created_at,
        u.updated_at
      FROM users u
      WHERE u.id = ? AND u.is_active = 1`,
      [id]
    );

    if (rows.length === 0) return null;

    const user = rows[0];

    // Get user departments
    const [deptRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT 
        d.id as departmentId,
        d.name as departmentName,
        ud.is_manager as isManager
      FROM user_departments ud
      JOIN departments d ON ud.department_id = d.id
      WHERE ud.user_id = ? AND d.is_active = 1`,
      [id]
    );

    // Get user skills
    const [skillRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT 
        s.id as skillId,
        s.name as skillName,
        us.proficiencyLevel
      FROM user_skills us
      JOIN skills s ON us.skillId = s.id
      WHERE us.userId = ? AND s.isActive = 1`,
      [id]
    );

    return {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role,
      employeeId: user.employee_id,
      phone: user.phone,
      isActive: Boolean(user.is_active),
      departments: deptRows.map(row => ({
        departmentId: row.departmentId,
        departmentName: row.departmentName,
        isManager: Boolean(row.isManager)
      })),
      skills: skillRows.map(row => ({
        skillId: row.skillId,
        skillName: row.skillName,
        proficiencyLevel: row.proficiencyLevel
      })),
      createdAt: user.created_at,
      updatedAt: user.updated_at
    };
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT 
        u.id,
        u.email,
        u.password_hash,
        u.first_name,
        u.last_name,
        u.role,
        u.employee_id,
        u.phone,
        u.is_active,
        u.created_at,
        u.updated_at
      FROM users u
      WHERE u.email = ? AND u.is_active = 1`,
      [email]
    );

    if (rows.length === 0) return null;

    const user = rows[0];

    return {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role,
      employeeId: user.employee_id,
      phone: user.phone,
      isActive: Boolean(user.is_active),
      createdAt: user.created_at,
      updatedAt: user.updated_at
    };
  }

  async updateUser(id: number, userData: UpdateUserRequest): Promise<User> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      // Update basic user info
      const updateFields: string[] = [];
      const updateValues: any[] = [];

      if (userData.email !== undefined) {
        updateFields.push('email = ?');
        updateValues.push(userData.email);
      }
      if (userData.firstName !== undefined) {
        updateFields.push('firstName = ?');
        updateValues.push(userData.firstName);
      }
      if (userData.lastName !== undefined) {
        updateFields.push('lastName = ?');
        updateValues.push(userData.lastName);
      }
      if (userData.role !== undefined) {
        updateFields.push('role = ?');
        updateValues.push(userData.role);
      }
      if (userData.employeeId !== undefined) {
        updateFields.push('employeeId = ?');
        updateValues.push(userData.employeeId);
      }
      if (userData.phone !== undefined) {
        updateFields.push('phone = ?');
        updateValues.push(userData.phone);
      }
      if (userData.isActive !== undefined) {
        updateFields.push('isActive = ?');
        updateValues.push(userData.isActive);
      }

      if (updateFields.length > 0) {
        updateFields.push('updatedAt = CURRENT_TIMESTAMP');
        updateValues.push(id);

        await connection.execute(
          `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
          updateValues
        );
      }

      // Update department assignments if provided
      if (userData.departmentIds !== undefined) {
        // Remove existing department assignments
        await connection.execute(
          'DELETE FROM user_departments WHERE userId = ?',
          [id]
        );

        // Add new department assignments
        if (userData.departmentIds.length > 0) {
          for (const departmentId of userData.departmentIds) {
            await connection.execute(
              'INSERT INTO user_departments (userId, departmentId, isManager) VALUES (?, ?, ?)',
              [id, departmentId, false]
            );
          }
        }
      }

      // Update skill assignments if provided
      if (userData.skillIds !== undefined) {
        // Remove existing skill assignments
        await connection.execute(
          'DELETE FROM user_skills WHERE userId = ?',
          [id]
        );

        // Add new skill assignments
        if (userData.skillIds.length > 0) {
          for (const skillId of userData.skillIds) {
            await connection.execute(
              'INSERT INTO user_skills (userId, skillId, proficiencyLevel) VALUES (?, ?, ?)',
              [id, skillId, 1]
            );
          }
        }
      }

      await connection.commit();

      const updatedUser = await this.getUserById(id);
      if (!updatedUser) {
        throw new Error('Failed to retrieve updated user');
      }

      return updatedUser;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async deleteUser(id: number): Promise<void> {
    await this.pool.execute(
      'UPDATE users SET isActive = 0, updatedAt = CURRENT_TIMESTAMP WHERE id = ?',
      [id]
    );
  }

  async getAllUsers(filters?: { search?: string; department?: string; role?: string }): Promise<User[]> {
    let query = `
      SELECT DISTINCT
        u.id,
        u.email,
        u.firstName,
        u.lastName,
        u.role,
        u.employeeId,
        u.phone,
        u.isActive,
        u.createdAt,
        u.updatedAt
      FROM users u
      LEFT JOIN user_departments ud ON u.id = ud.userId
      LEFT JOIN departments d ON ud.departmentId = d.id
      WHERE u.isActive = 1
    `;
    
    const params: any[] = [];

    if (filters?.search) {
      query += ` AND (u.firstName LIKE ? OR u.lastName LIKE ? OR u.email LIKE ? OR u.employeeId LIKE ?)`;
      const searchTerm = `%${filters.search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    if (filters?.department) {
      query += ` AND d.id = ?`;
      params.push(parseInt(filters.department));
    }

    if (filters?.role) {
      query += ` AND u.role = ?`;
      params.push(filters.role);
    }

    query += ` ORDER BY u.lastName, u.firstName`;

    const [rows] = await this.pool.execute<RowDataPacket[]>(query, params);

    // Get users with their departments and skills
    const users: User[] = [];
    for (const row of rows) {
      const user = await this.getUserById(row.id);
      if (user) {
        users.push(user);
      }
    }

    return users;
  }

  async getUsersForManager(managerId: number, managerRole: string): Promise<User[]> {
    if (managerRole === 'admin') {
      return this.getAllUsers();
    }

    // Get departments managed by this manager
    const [deptRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT departmentId FROM user_departments WHERE userId = ? AND isManager = 1`,
      [managerId]
    );

    if (deptRows.length === 0) {
      return [];
    }

    const managedDeptIds = deptRows.map(row => row.departmentId);
    const placeholders = managedDeptIds.map(() => '?').join(',');

    const [userRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT DISTINCT u.id
       FROM users u
       JOIN user_departments ud ON u.id = ud.userId
       WHERE ud.departmentId IN (${placeholders}) AND u.isActive = 1`,
      managedDeptIds
    );

    const users: User[] = [];
    for (const row of userRows) {
      const user = await this.getUserById(row.id);
      if (user) {
        users.push(user);
      }
    }

    return users;
  }

  async validatePassword(email: string, password: string): Promise<User | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT id, email, password_hash, first_name, last_name, role FROM users WHERE email = ? AND is_active = 1',
      [email]
    );

    if (rows.length === 0) return null;

    const user = rows[0];
    const isValid = await bcrypt.compare(password, user.password_hash);

    if (!isValid) return null;

    return {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}
