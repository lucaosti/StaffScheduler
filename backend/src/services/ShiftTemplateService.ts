/**
 * Shift template CRUD.
 *
 * A template is a reusable pattern (department, time window, staffing
 * range) that `ShiftService.createShiftsFromTemplate` expands into real
 * shift rows across a date range — that expansion stays on `ShiftService`
 * itself (it reads `shift_templates` directly rather than through this
 * class), since generating shifts is a shift-lifecycle operation, not a
 * template one. This class owns only the template records themselves.
 *
 * Split out of the former single `ShiftService`, which mixed shift CRUD
 * with template CRUD under one class past 800 lines.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import {
  ShiftTemplate,
  CreateShiftTemplateRequest,
  UpdateShiftTemplateRequest,
  SqlParam,
} from '../types';
import { logger } from '../config/logger';

export class ShiftTemplateService {
  constructor(private pool: Pool) {}

  async getAllShiftTemplates(): Promise<ShiftTemplate[]> {
    try {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        'SELECT * FROM shift_templates WHERE is_active = 1 ORDER BY name ASC LIMIT 1000'
      );
      return rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        departmentId: row.department_id,
        startTime: row.start_time,
        endTime: row.end_time,
        minStaff: row.min_staff,
        maxStaff: row.max_staff,
        isActive: Boolean(row.is_active),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
    } catch (error) {
      logger.error('Failed to get shift templates:', error);
      throw error;
    }
  }

  async getShiftTemplateById(id: number): Promise<ShiftTemplate | null> {
    try {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        'SELECT * FROM shift_templates WHERE id = ? LIMIT 1',
        [id]
      );
      if (rows.length === 0) return null;
      const row = rows[0];
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        departmentId: row.department_id,
        startTime: row.start_time,
        endTime: row.end_time,
        minStaff: row.min_staff,
        maxStaff: row.max_staff,
        isActive: Boolean(row.is_active),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    } catch (error) {
      logger.error('Failed to get shift template:', error);
      throw error;
    }
  }

  async createShiftTemplate(templateData: CreateShiftTemplateRequest): Promise<ShiftTemplate> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute<ResultSetHeader>(
        'INSERT INTO shift_templates (name, description, department_id, start_time, end_time, min_staff, max_staff) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [templateData.name, templateData.description || null, templateData.departmentId, templateData.startTime, templateData.endTime, templateData.minStaff, templateData.maxStaff]
      );
      await connection.commit();
      logger.info('Shift template created: ' + result.insertId);
      const created = await this.getShiftTemplateById(result.insertId);
      if (!created) throw new Error('Failed to retrieve created shift template');
      return created;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to create shift template:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  async updateShiftTemplate(id: number, templateData: UpdateShiftTemplateRequest): Promise<ShiftTemplate | null> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      // Every fragment pushed below is a hardcoded string literal, never derived from
      // user-controlled input.  The UPDATE template is therefore not susceptible to
      // SQL injection through column-name interpolation.
      const updates: string[] = [];
      const values: SqlParam[] = [];
      if (templateData.name !== undefined) {
        updates.push('name = ?');
        values.push(templateData.name);
      }
      if (templateData.description !== undefined) {
        updates.push('description = ?');
        values.push(templateData.description);
      }
      if (templateData.startTime !== undefined) {
        updates.push('start_time = ?');
        values.push(templateData.startTime);
      }
      if (templateData.endTime !== undefined) {
        updates.push('end_time = ?');
        values.push(templateData.endTime);
      }
      if (templateData.minStaff !== undefined) {
        updates.push('min_staff = ?');
        values.push(templateData.minStaff);
      }
      if (templateData.maxStaff !== undefined) {
        updates.push('max_staff = ?');
        values.push(templateData.maxStaff);
      }
      if (updates.length > 0) {
        values.push(id);
        await connection.execute(`UPDATE shift_templates SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, values);
      }
      await connection.commit();
      logger.info('Shift template updated: ' + id);
      return this.getShiftTemplateById(id);
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to update shift template:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Retires a template. SOFT, and deliberately so: shifts already created from
   * it are ordinary shifts with their own rows, and a template is a pattern
   * used at a moment rather than a thing those shifts belong to. Deleting the
   * pattern must not reach back into schedules that have already run.
   *
   * Returns false for an id that matched nothing, so the route's 404 is
   * reachable. It previously returned `true` unconditionally, which made
   * deleting a template that does not exist report "deleted successfully" —
   * the 404 branch above it could never be taken.
   */
  async deleteShiftTemplate(id: number): Promise<boolean> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute<ResultSetHeader>(
        'UPDATE shift_templates SET is_active = 0 WHERE id = ? AND is_active = 1',
        [id]
      );
      await connection.commit();
      if (result.affectedRows === 0) return false;
      logger.info('Shift template deleted: ' + id);
      return true;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to delete shift template:', error);
      throw error;
    } finally {
      connection.release();
    }
  }
}
