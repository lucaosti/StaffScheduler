/**
 * Skill Service
 * 
 * Handles all skill-related business logic including skill management,
 * user skill assignments, and shift skill requirements.
 * 
 * @module services/SkillService
 * @author Staff Scheduler Team
 */

import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { 
  Skill,
  CreateSkillRequest,
  UpdateSkillRequest
} from '../types';
import { logger } from '../config/logger';

/**
 * SkillService Class
 * 
 * Provides comprehensive skill management functionality including:
 * - Skill CRUD operations
 * - User skill assignment and management
 * - Shift skill requirements
 * - Skill statistics and reporting
 */
export class SkillService {
  /**
   * Creates a new SkillService instance
   * 
   * @param pool - MySQL connection pool for database operations
   */
  constructor(private pool: Pool) {}

  /**
   * Creates a new skill
   * 
   * @param skillData - Skill creation data
   * @returns Promise resolving to the created skill
   */
  async createSkill(skillData: CreateSkillRequest): Promise<Skill> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      // Check if skill name already exists
      const [existingRows] = await connection.execute<RowDataPacket[]>(
        'SELECT id FROM skills WHERE name = ? LIMIT 1',
        [skillData.name]
      );

      if (existingRows.length > 0) {
        throw new Error('Skill with this name already exists');
      }

      // Insert skill record
      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO skills (name, description, is_active)
        VALUES (?, ?, 1)`,
        [
          skillData.name,
          skillData.description || null
        ]
      );

      const skillId = result.insertId;

      await connection.commit();

      logger.info(`Skill created successfully: ${skillId}`);

      // Retrieve and return the created skill
      const newSkill = await this.getSkillById(skillId);
      if (!newSkill) {
        throw new Error('Failed to retrieve created skill');
      }

      return newSkill;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to create skill:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Retrieves a skill by its unique identifier
   * 
   * Includes:
   * - Basic skill information
   * - Number of users with this skill
   * - Number of shifts requiring this skill
   * 
   * @param id - Skill ID
   * @returns Promise resolving to Skill object or null if not found
   */
  async getSkillById(id: number): Promise<Skill | null> {
    try {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT 
          s.id, s.name, s.description, s.is_active, s.created_at,
          COUNT(DISTINCT us.user_id) as user_count,
          COUNT(DISTINCT ss.shift_id) as shift_count
        FROM skills s
        LEFT JOIN user_skills us ON s.id = us.skill_id
        LEFT JOIN shift_skills ss ON s.id = ss.skill_id
        WHERE s.id = ?
        GROUP BY s.id`,
        [id]
      );

      if (rows.length === 0) {
        return null;
      }

      const row = rows[0];

      const skill: Skill = {
        id: row.id,
        name: row.name,
        description: row.description,
        isActive: Boolean(row.is_active),
        userCount: row.user_count || 0,
        shiftCount: row.shift_count || 0,
        createdAt: row.created_at
      };

      return skill;
    } catch (error) {
      logger.error('Failed to get skill by ID:', error);
      throw error;
    }
  }

  /**
   * Retrieves all skills with optional filtering
   * 
   * @param filters - Optional filters for active status
   * @returns Promise resolving to array of skills
   */
  async getAllSkills(filters?: {
    isActive?: boolean;
  }): Promise<Skill[]> {
    try {
      let query = `
        SELECT 
          s.id, s.name, s.description, s.is_active, s.created_at,
          COUNT(DISTINCT us.user_id) as user_count,
          COUNT(DISTINCT ss.shift_id) as shift_count
        FROM skills s
        LEFT JOIN user_skills us ON s.id = us.skill_id
        LEFT JOIN shift_skills ss ON s.id = ss.skill_id
      `;

      const conditions: string[] = [];
      const params: any[] = [];

      if (filters?.isActive !== undefined) {
        conditions.push('s.is_active = ?');
        params.push(filters.isActive ? 1 : 0);
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      query += ' GROUP BY s.id ORDER BY s.name ASC';

      const [rows] = await this.pool.execute<RowDataPacket[]>(query, params);

      const skills: Skill[] = rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        isActive: Boolean(row.is_active),
        userCount: row.user_count || 0,
        shiftCount: row.shift_count || 0,
        createdAt: row.created_at
      }));

      return skills;
    } catch (error) {
      logger.error('Failed to get all skills:', error);
      throw error;
    }
  }

  /**
   * Updates an existing skill
   * 
   * @param id - Skill ID
   * @param skillData - Partial skill data to update
   * @returns Promise resolving to updated skill
   */
  async updateSkill(id: number, skillData: UpdateSkillRequest): Promise<Skill> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      // Check if skill name is being changed and if new name already exists
      if (skillData.name !== undefined) {
        const [existingRows] = await connection.execute<RowDataPacket[]>(
          'SELECT id FROM skills WHERE name = ? AND id != ? LIMIT 1',
          [skillData.name, id]
        );

        if (existingRows.length > 0) {
          throw new Error('Skill with this name already exists');
        }
      }

      const updates: string[] = [];
      const values: any[] = [];

      if (skillData.name !== undefined) {
        updates.push('name = ?');
        values.push(skillData.name);
      }

      if (skillData.description !== undefined) {
        updates.push('description = ?');
        values.push(skillData.description);
      }

      if (skillData.isActive !== undefined) {
        updates.push('is_active = ?');
        values.push(skillData.isActive ? 1 : 0);
      }

      if (updates.length > 0) {
        values.push(id);
        await connection.execute(
          `UPDATE skills SET ${updates.join(', ')} WHERE id = ?`,
          values
        );
      }

      await connection.commit();

      logger.info(`Skill updated successfully: ${id}`);

      const updatedSkill = await this.getSkillById(id);
      if (!updatedSkill) {
        throw new Error('Skill not found after update');
      }

      return updatedSkill;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to update skill:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Deletes a skill (soft delete by setting is_active to false)
   * 
   * @param id - Skill ID to delete
   * @returns Promise resolving to true if successful
   */
  async deleteSkill(id: number): Promise<boolean> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      // Soft delete by setting is_active to false
      const [result] = await connection.execute<ResultSetHeader>(
        'UPDATE skills SET is_active = 0 WHERE id = ?',
        [id]
      );

      if (result.affectedRows === 0) {
        throw new Error('Skill not found');
      }

      await connection.commit();

      logger.info(`Skill deactivated successfully: ${id}`);
      return true;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to delete skill:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Assigns skills to a user
   * 
   * Replaces existing skill assignments with new set
   * 
   * @param userId - User ID
   * @param skillIds - Array of skill IDs to assign
   * @returns Promise resolving to true if successful
   */
  async assignSkillsToUser(userId: number, skillIds: number[]): Promise<boolean> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      // Validate user exists
      const [userRows] = await connection.execute<RowDataPacket[]>(
        'SELECT id FROM users WHERE id = ? LIMIT 1',
        [userId]
      );

      if (userRows.length === 0) {
        throw new Error('User not found');
      }

      // Remove existing skill assignments
      await connection.execute(
        'DELETE FROM user_skills WHERE user_id = ?',
        [userId]
      );

      // Add new skill assignments
      if (skillIds.length > 0) {
        for (const skillId of skillIds) {
          // Validate skill exists and is active
          const [skillRows] = await connection.execute<RowDataPacket[]>(
            'SELECT id FROM skills WHERE id = ? AND is_active = 1 LIMIT 1',
            [skillId]
          );

          if (skillRows.length === 0) {
            throw new Error(`Skill with ID ${skillId} not found or inactive`);
          }

          await connection.execute(
            'INSERT INTO user_skills (user_id, skill_id) VALUES (?, ?)',
            [userId, skillId]
          );
        }
      }

      await connection.commit();

      logger.info(`Skills assigned to user ${userId} successfully`);
      return true;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to assign skills to user:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Gets all skills for a user
   * 
   * @param userId - User ID
   * @returns Promise resolving to array of skills
   */
  async getUserSkills(userId: number): Promise<Skill[]> {
    try {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT s.id, s.name, s.description, s.is_active, s.created_at
        FROM skills s
        JOIN user_skills us ON s.id = us.skill_id
        WHERE us.user_id = ?
        ORDER BY s.name ASC`,
        [userId]
      );

      const skills: Skill[] = rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        isActive: Boolean(row.is_active),
        createdAt: row.created_at
      }));

      return skills;
    } catch (error) {
      logger.error('Failed to get user skills:', error);
      throw error;
    }
  }

  /**
   * Gets all users with a specific skill
   * 
   * @param skillId - Skill ID
   * @returns Promise resolving to array of users with basic info
   */
  async getUsersWithSkill(skillId: number): Promise<any[]> {
    try {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT u.id, u.first_name, u.last_name, u.email, u.role
        FROM users u
        JOIN user_skills us ON u.id = us.user_id
        WHERE us.skill_id = ? AND u.is_active = 1
        ORDER BY u.last_name ASC, u.first_name ASC`,
        [skillId]
      );

      return rows.map((row: any) => ({
        id: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email,
        role: row.role
      }));
    } catch (error) {
      logger.error('Failed to get users with skill:', error);
      throw error;
    }
  }

  /**
   * Gets required skills for a shift
   * 
   * @param shiftId - Shift ID
   * @returns Promise resolving to array of skills
   */
  async getShiftRequiredSkills(shiftId: number): Promise<Skill[]> {
    try {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT s.id, s.name, s.description, s.is_active, s.created_at
        FROM skills s
        JOIN shift_skills ss ON s.id = ss.skill_id
        WHERE ss.shift_id = ?
        ORDER BY s.name ASC`,
        [shiftId]
      );

      const skills: Skill[] = rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        isActive: Boolean(row.is_active),
        createdAt: row.created_at
      }));

      return skills;
    } catch (error) {
      logger.error('Failed to get shift required skills:', error);
      throw error;
    }
  }

  /**
   * Assigns required skills to a shift
   * 
   * Replaces existing skill requirements with new set
   * 
   * @param shiftId - Shift ID
   * @param skillIds - Array of skill IDs to require
   * @returns Promise resolving to true if successful
   */
  async assignSkillsToShift(shiftId: number, skillIds: number[]): Promise<boolean> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      // Validate shift exists
      const [shiftRows] = await connection.execute<RowDataPacket[]>(
        'SELECT id FROM shifts WHERE id = ? LIMIT 1',
        [shiftId]
      );

      if (shiftRows.length === 0) {
        throw new Error('Shift not found');
      }

      // Remove existing skill requirements
      await connection.execute(
        'DELETE FROM shift_skills WHERE shift_id = ?',
        [shiftId]
      );

      // Add new skill requirements
      if (skillIds.length > 0) {
        for (const skillId of skillIds) {
          // Validate skill exists and is active
          const [skillRows] = await connection.execute<RowDataPacket[]>(
            'SELECT id FROM skills WHERE id = ? AND is_active = 1 LIMIT 1',
            [skillId]
          );

          if (skillRows.length === 0) {
            throw new Error(`Skill with ID ${skillId} not found or inactive`);
          }

          await connection.execute(
            'INSERT INTO shift_skills (shift_id, skill_id) VALUES (?, ?)',
            [shiftId, skillId]
          );
        }
      }

      await connection.commit();

      logger.info(`Skills assigned to shift ${shiftId} successfully`);
      return true;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to assign skills to shift:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Gets skill statistics
   * 
   * @returns Promise resolving to statistics object
   */
  async getSkillStatistics(): Promise<{
    totalSkills: number;
    activeSkills: number;
    inactiveSkills: number;
    averageUsersPerSkill: number;
    mostCommonSkills: Array<{ id: number; name: string; userCount: number }>;
  }> {
    try {
      const [statsRows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active,
          SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) as inactive
        FROM skills`
      );

      const stats = statsRows[0];

      const [avgRows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT AVG(user_count) as avg_users
        FROM (
          SELECT COUNT(*) as user_count
          FROM user_skills
          GROUP BY skill_id
        ) as skill_counts`
      );

      const avgUsers = avgRows[0]?.avg_users || 0;

      const [commonRows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT 
          s.id, s.name, COUNT(us.user_id) as user_count
        FROM skills s
        LEFT JOIN user_skills us ON s.id = us.skill_id
        WHERE s.is_active = 1
        GROUP BY s.id
        ORDER BY user_count DESC
        LIMIT 5`
      );

      return {
        totalSkills: stats.total || 0,
        activeSkills: stats.active || 0,
        inactiveSkills: stats.inactive || 0,
        averageUsersPerSkill: Math.round(avgUsers * 10) / 10,
        mostCommonSkills: commonRows.map((row: any) => ({
          id: row.id,
          name: row.name,
          userCount: row.user_count || 0
        }))
      };
    } catch (error) {
      logger.error('Failed to get skill statistics:', error);
      throw error;
    }
  }

  /**
   * Finds users who have all the specified skills
   * 
   * @param skillIds - Array of skill IDs
   * @param departmentId - Optional department filter
   * @returns Promise resolving to array of matching users
   */
  async findUsersWithAllSkills(skillIds: number[], departmentId?: number): Promise<any[]> {
    try {
      if (skillIds.length === 0) {
        return [];
      }

      let query = `
        SELECT u.id, u.first_name, u.last_name, u.email, u.role,
          COUNT(DISTINCT us.skill_id) as matching_skills
        FROM users u
        JOIN user_skills us ON u.id = us.user_id
      `;

      const params: any[] = [skillIds];

      if (departmentId) {
        query += ' JOIN user_departments ud ON u.id = ud.user_id';
      }

      query += ` WHERE u.is_active = 1 AND us.skill_id IN (?)`;

      if (departmentId) {
        query += ' AND ud.department_id = ?';
        params.push(departmentId);
      }

      query += ' GROUP BY u.id HAVING matching_skills = ?';
      params.push(skillIds.length);

      query += ' ORDER BY u.last_name ASC, u.first_name ASC';

      const [rows] = await this.pool.execute<RowDataPacket[]>(query, params);

      return rows.map((row: any) => ({
        id: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email,
        role: row.role
      }));
    } catch (error) {
      logger.error('Failed to find users with all skills:', error);
      throw error;
    }
  }
}
