/**
 * User Service
 * 
 * Handles all user-related business logic including user management,
 * authentication, permissions, and profile operations.
 */

import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import bcrypt from 'bcrypt';
import { User, CreateUserRequest, UpdateUserRequest } from '../types';
import { logger } from '../config/logger';

export class UserService {
  constructor(private pool: Pool) {}

  async createUser(userData: CreateUserRequest): Promise<User> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [existingUsers] = await connection.execute<RowDataPacket[]>(
        'SELECT id FROM users WHERE email = ? LIMIT 1',
        [userData.email]
      );
      if (existingUsers.length > 0) {
        throw new Error('Email already exists');
      }
      const passwordHash = await bcrypt.hash(userData.password, 12);
      const [result] = await connection.execute<ResultSetHeader>(
        'INSERT INTO users (email, password, first_name, last_name, role, phone, employee_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [userData.email, passwordHash, userData.firstName, userData.lastName, userData.role, userData.phone || null, userData.employeeId || null]
      );
      const userId = result.insertId;
      if (userData.departmentIds && userData.departmentIds.length > 0) {
        for (const departmentId of userData.departmentIds) {
          await connection.execute('INSERT INTO user_departments (user_id, department_id) VALUES (?, ?)', [userId, departmentId]);
        }
      }
      if (userData.skillIds && userData.skillIds.length > 0) {
        for (const skillId of userData.skillIds) {
          await connection.execute('INSERT INTO user_skills (user_id, skill_id) VALUES (?, ?)', [userId, skillId]);
        }
      }
      await connection.commit();
      logger.info('User created: ' + userId);
      const newUser = await this.getUserById(userId);
      if (!newUser) throw new Error('Failed to retrieve created user');
      return newUser;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to create user:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  async getUserById(id: number): Promise<User | null> {
    try {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        'SELECT id, email, first_name, last_name, role, employee_id, phone, is_active, last_login, created_at, updated_at FROM users WHERE id = ?',
        [id]
      );
      if (rows.length === 0) return null;
      const row = rows[0];
      const [deptRows] = await this.pool.execute<RowDataPacket[]>(
        'SELECT d.id, d.name FROM departments d JOIN user_departments ud ON d.id = ud.department_id WHERE ud.user_id = ?',
        [id]
      );
      const [skillRows] = await this.pool.execute<RowDataPacket[]>(
        'SELECT s.id, s.name, s.description, s.is_active, s.created_at FROM skills s JOIN user_skills us ON s.id = us.skill_id WHERE us.user_id = ?',
        [id]
      );
      return {
        id: row.id,
        email: row.email,
        firstName: row.first_name,
        lastName: row.last_name,
        role: row.role,
        employeeId: row.employee_id,
        phone: row.phone,
        isActive: Boolean(row.is_active),
        lastLogin: row.last_login,
        departments: deptRows.map((d: any) => ({ id: d.id, name: d.name })),
        skills: skillRows.map((s: any) => ({ id: s.id, name: s.name, description: s.description, isActive: Boolean(s.is_active), createdAt: s.created_at })),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    } catch (error) {
      logger.error('Failed to get user by ID:', error);
      throw error;
    }
  }

  async getUserByEmail(email: string): Promise<User | null> {
    try {
      const [rows] = await this.pool.execute<RowDataPacket[]>('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
      if (rows.length === 0) return null;
      return this.getUserById(rows[0].id);
    } catch (error) {
      logger.error('Failed to get user by email:', error);
      throw error;
    }
  }

  async getAllUsers(filters?: { role?: string; departmentId?: number; isActive?: boolean; search?: string }): Promise<User[]> {
    try {
      let query = 'SELECT DISTINCT u.id, u.email, u.first_name, u.last_name, u.role, u.employee_id, u.phone, u.is_active, u.last_login, u.created_at, u.updated_at FROM users u';
      const conditions: string[] = [];
      const params: any[] = [];
      if (filters?.departmentId) {
        query += ' JOIN user_departments ud ON u.id = ud.user_id';
        conditions.push('ud.department_id = ?');
        params.push(filters.departmentId);
      }
      if (filters?.role) {
        conditions.push('u.role = ?');
        params.push(filters.role);
      }
      if (filters?.isActive !== undefined) {
        conditions.push('u.is_active = ?');
        params.push(filters.isActive ? 1 : 0);
      }
      if (filters?.search) {
        conditions.push('(u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ? OR u.employee_id LIKE ?)');
        const searchPattern = `%${filters.search}%`;
        params.push(searchPattern, searchPattern, searchPattern, searchPattern);
      }
      if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
      query += ' ORDER BY u.last_name ASC, u.first_name ASC';
      const [rows] = await this.pool.execute<RowDataPacket[]>(query, params);
      return rows.map((row: any) => ({
        id: row.id,
        email: row.email,
        firstName: row.first_name,
        lastName: row.last_name,
        role: row.role,
        employeeId: row.employee_id,
        phone: row.phone,
        isActive: Boolean(row.is_active),
        lastLogin: row.last_login,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
    } catch (error) {
      logger.error('Failed to get all users:', error);
      throw error;
    }
  }

  async updateUser(id: number, userData: UpdateUserRequest): Promise<User> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const updates: string[] = [];
      const values: any[] = [];
      if (userData.email !== undefined) {
        const [existing] = await connection.execute<RowDataPacket[]>('SELECT id FROM users WHERE email = ? AND id != ? LIMIT 1', [userData.email, id]);
        if (existing.length > 0) throw new Error('Email already exists');
        updates.push('email = ?');
        values.push(userData.email);
      }
      if (userData.password !== undefined) {
        const passwordHash = await bcrypt.hash(userData.password, 12);
        updates.push('password = ?');
        values.push(passwordHash);
      }
      if (userData.firstName !== undefined) {
        updates.push('first_name = ?');
        values.push(userData.firstName);
      }
      if (userData.lastName !== undefined) {
        updates.push('last_name = ?');
        values.push(userData.lastName);
      }
      if (userData.role !== undefined) {
        updates.push('role = ?');
        values.push(userData.role);
      }
      if (userData.employeeId !== undefined) {
        updates.push('employee_id = ?');
        values.push(userData.employeeId);
      }
      if (userData.phone !== undefined) {
        updates.push('phone = ?');
        values.push(userData.phone);
      }
      if (userData.isActive !== undefined) {
        updates.push('is_active = ?');
        values.push(userData.isActive ? 1 : 0);
      }
      if (updates.length > 0) {
        values.push(id);
        await connection.execute(`UPDATE users SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, values);
      }
      await connection.commit();
      logger.info('User updated: ' + id);
      const updatedUser = await this.getUserById(id);
      if (!updatedUser) throw new Error('User not found after update');
      return updatedUser;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to update user:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  async deleteUser(id: number): Promise<boolean> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute('UPDATE users SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
      await connection.commit();
      logger.info('User deleted: ' + id);
      return true;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to delete user:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  async updateUserDepartments(userId: number, departmentIds: number[]): Promise<boolean> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute('DELETE FROM user_departments WHERE user_id = ?', [userId]);
      for (const departmentId of departmentIds) {
        await connection.execute('INSERT INTO user_departments (user_id, department_id) VALUES (?, ?)', [userId, departmentId]);
      }
      await connection.commit();
      logger.info('User departments updated: ' + userId);
      return true;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to update user departments:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  async updateUserSkills(userId: number, skillIds: number[]): Promise<boolean> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute('DELETE FROM user_skills WHERE user_id = ?', [userId]);
      for (const skillId of skillIds) {
        await connection.execute('INSERT INTO user_skills (user_id, skill_id) VALUES (?, ?)', [userId, skillId]);
      }
      await connection.commit();
      logger.info('User skills updated: ' + userId);
      return true;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to update user skills:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  private async getUserPasswordHash(userId: number): Promise<string | null> {
    try {
      const [rows] = await this.pool.execute<RowDataPacket[]>('SELECT password FROM users WHERE id = ? LIMIT 1', [userId]);
      return rows.length > 0 ? rows[0].password : null;
    } catch (error) {
      logger.error('Failed to get password hash:', error);
      return null;
    }
  }

  async verifyPassword(userId: number, password: string): Promise<boolean> {
    try {
      const hash = await this.getUserPasswordHash(userId);
      if (!hash) return false;
      return await bcrypt.compare(password, hash);
    } catch (error) {
      logger.error('Failed to verify password:', error);
      return false;
    }
  }

  async validatePassword(email: string, password: string): Promise<User | null> {
    try {
      const user = await this.getUserByEmail(email);
      if (!user || !user.isActive) return null;
      const isValid = await this.verifyPassword(user.id, password);
      if (!isValid) return null;
      await this.pool.execute('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
      logger.info('User logged in: ' + email);
      return user;
    } catch (error) {
      logger.error('Failed to validate password:', error);
      return null;
    }
  }

  async getUsersByDepartment(departmentId: number): Promise<User[]> {
    return this.getAllUsers({ departmentId, isActive: true });
  }

  async getUsersByRole(role: string): Promise<User[]> {
    return this.getAllUsers({ role, isActive: true });
  }

  async getUserStatistics(): Promise<{ total: number; active: number; inactive: number; byRole: Array<{ role: string; count: number }> }> {
    try {
      const [totalRows] = await this.pool.execute<RowDataPacket[]>('SELECT COUNT(*) as count FROM users');
      const [activeRows] = await this.pool.execute<RowDataPacket[]>('SELECT COUNT(*) as count FROM users WHERE is_active = 1');
      const [roleRows] = await this.pool.execute<RowDataPacket[]>('SELECT role, COUNT(*) as count FROM users GROUP BY role');
      return {
        total: totalRows[0].count || 0,
        active: activeRows[0].count || 0,
        inactive: (totalRows[0].count || 0) - (activeRows[0].count || 0),
        byRole: roleRows.map((row: any) => ({ role: row.role, count: row.count || 0 }))
      };
    } catch (error) {
      logger.error('Failed to get user statistics:', error);
      throw error;
    }
  }

  async getUsersForManager(managerId: number, role: string): Promise<User[]> {
    try {
      if (role === 'admin') return this.getAllUsers();
      const [deptRows] = await this.pool.execute<RowDataPacket[]>('SELECT id FROM departments WHERE manager_id = ?', [managerId]);
      if (deptRows.length === 0) return [];
      const departmentIds = deptRows.map((row: any) => row.id);
      const [userRows] = await this.pool.execute<RowDataPacket[]>('SELECT DISTINCT u.id FROM users u JOIN user_departments ud ON u.id = ud.user_id WHERE ud.department_id IN (?)', [departmentIds]);
      const users = await Promise.all(userRows.map((row: any) => this.getUserById(row.id)));
      return users.filter((u): u is User => u !== null);
    } catch (error) {
      logger.error('Failed to get users for manager:', error);
      throw error;
    }
  }
}
