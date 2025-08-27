import { database } from '../config/database';
import { logger } from '../config/logger';
import { Schedule, CreateScheduleRequest, UpdateScheduleRequest, OptimizationOptions } from '../types';

interface ScheduleRow {
  id: string;
  name: string;
  description?: string;
  start_date: string;
  end_date: string;
  status: 'draft' | 'published' | 'archived';
  created_by: string;
  created_at: string;
  updated_at: string;
  published_at?: string;
  published_by?: string;
  created_by_email?: string;
}

class ScheduleService {
  async findAll(filters: {
    status?: string;
    startDate?: string;
    endDate?: string;
    createdBy?: string;
  } = {}): Promise<Schedule[]> {
    try {
      let query = `
        SELECT s.*, u.email as created_by_email
        FROM schedules s
        LEFT JOIN users u ON s.created_by = u.id
        WHERE 1=1
      `;
      const params: any[] = [];

      if (filters.status) {
        query += ' AND s.status = ?';
        params.push(filters.status);
      }

      if (filters.startDate) {
        query += ' AND s.start_date >= ?';
        params.push(filters.startDate);
      }

      if (filters.endDate) {
        query += ' AND s.end_date <= ?';
        params.push(filters.endDate);
      }

      if (filters.createdBy) {
        query += ' AND s.created_by = ?';
        params.push(filters.createdBy);
      }

      query += ' ORDER BY s.created_at DESC';

      const rows = await database.query<ScheduleRow>(query, params);
      
      return rows.map((row: ScheduleRow) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        startDate: row.start_date,
        endDate: row.end_date,
        status: row.status,
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        publishedAt: row.published_at,
        publishedBy: row.published_by
      }));
    } catch (error) {
      logger.error('Error fetching schedules:', error);
      throw error;
    }
  }

  async findById(id: string): Promise<Schedule | null> {
    try {
      const query = `
        SELECT s.*, u.email as created_by_email
        FROM schedules s
        LEFT JOIN users u ON s.created_by = u.id
        WHERE s.id = ?
      `;

      const row = await database.queryOne<ScheduleRow>(query, [id]);
      
      if (!row) {
        return null;
      }

      return {
        id: row.id,
        name: row.name,
        description: row.description,
        startDate: row.start_date,
        endDate: row.end_date,
        status: row.status,
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        publishedAt: row.published_at,
        publishedBy: row.published_by
      };
    } catch (error) {
      logger.error('Error fetching schedule by ID:', error);
      throw error;
    }
  }

  async create(data: CreateScheduleRequest, createdBy: string): Promise<Schedule> {
    try {
      const scheduleId = this.generateId();
      const now = new Date().toISOString();

      const query = `
        INSERT INTO schedules (id, name, description, start_date, end_date, status, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)
      `;

      await database.query(query, [
        scheduleId,
        data.name,
        data.description || null,
        data.startDate,
        data.endDate,
        createdBy,
        now,
        now
      ]);

      const schedule = await this.findById(scheduleId);
      if (!schedule) {
        throw new Error('Failed to create schedule');
      }

      logger.info(`Schedule created: ${scheduleId} by ${createdBy}`);
      return schedule;
    } catch (error) {
      logger.error('Error creating schedule:', error);
      throw error;
    }
  }

  async update(id: string, data: UpdateScheduleRequest): Promise<Schedule | null> {
    try {
      const now = new Date().toISOString();
      const setParts: string[] = ['updated_at = ?'];
      const params: any[] = [now];

      if (data.name !== undefined) {
        setParts.push('name = ?');
        params.push(data.name);
      }

      if (data.description !== undefined) {
        setParts.push('description = ?');
        params.push(data.description);
      }

      if (data.startDate !== undefined) {
        setParts.push('start_date = ?');
        params.push(data.startDate);
      }

      if (data.endDate !== undefined) {
        setParts.push('end_date = ?');
        params.push(data.endDate);
      }

      if (data.status !== undefined) {
        setParts.push('status = ?');
        params.push(data.status);
      }

      params.push(id);

      const query = `UPDATE schedules SET ${setParts.join(', ')} WHERE id = ?`;
      await database.query(query, params);

      logger.info(`Schedule updated: ${id}`);
      return await this.findById(id);
    } catch (error) {
      logger.error('Error updating schedule:', error);
      throw error;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      const query = 'DELETE FROM schedules WHERE id = ?';
      await database.query(query, [id]);

      logger.info(`Schedule deleted: ${id}`);
      return true;
    } catch (error) {
      logger.error('Error deleting schedule:', error);
      throw error;
    }
  }

  async publish(id: string, publishedBy: string): Promise<Schedule | null> {
    try {
      const now = new Date().toISOString();
      
      const query = `
        UPDATE schedules 
        SET status = 'published', published_at = ?, published_by = ?, updated_at = ?
        WHERE id = ? AND status = 'draft'
      `;

      await database.query(query, [now, publishedBy, now, id]);

      logger.info(`Schedule published: ${id} by ${publishedBy}`);
      return await this.findById(id);
    } catch (error) {
      logger.error('Error publishing schedule:', error);
      throw error;
    }
  }

  async generateOptimizedSchedule(options: OptimizationOptions): Promise<{
    scheduleId: string;
    assignments: Array<{
      shiftId: string;
      employeeId: string;
      role: string;
    }>;
    statistics: {
      totalShifts: number;
      totalAssignments: number;
      coverageRate: number;
      fairnessScore: number;
    };
  }> {
    try {
      // This is a simplified optimization algorithm
      // In a real implementation, this would use sophisticated optimization techniques
      
      logger.info('Starting schedule optimization', options);

      // Mock optimization result for now
      const scheduleId = this.generateId();
      
      const result = {
        scheduleId,
        assignments: [
          {
            shiftId: 'shift_1',
            employeeId: 'emp_001',
            role: 'nurse'
          },
          {
            shiftId: 'shift_2',
            employeeId: 'emp_002',
            role: 'doctor'
          }
        ],
        statistics: {
          totalShifts: 10,
          totalAssignments: 8,
          coverageRate: 0.8,
          fairnessScore: 0.85
        }
      };

      logger.info(`Schedule optimization completed: ${scheduleId}`);
      return result;
    } catch (error) {
      logger.error('Error generating optimized schedule:', error);
      throw error;
    }
  }

  async getScheduleAssignments(scheduleId: string): Promise<Array<{
    id: string;
    shiftId: string;
    employeeId: string;
    role: string;
    status: 'assigned' | 'pending' | 'declined';
    assignedAt: string;
    assignedBy: string;
  }>> {
    try {
      const query = `
        SELECT sa.*, s.name as shift_name, e.first_name, e.last_name
        FROM schedule_assignments sa
        JOIN shifts s ON sa.shift_id = s.id
        JOIN employees e ON sa.employee_id = e.id
        WHERE sa.schedule_id = ?
        ORDER BY s.start_time, e.last_name, e.first_name
      `;

      const rows = await database.query<any>(query, [scheduleId]);
      
      return rows.map((row: any) => ({
        id: row.id,
        shiftId: row.shift_id,
        employeeId: row.employee_id,
        role: row.role,
        status: row.status,
        assignedAt: row.assigned_at,
        assignedBy: row.assigned_by
      }));
    } catch (error) {
      logger.error('Error fetching schedule assignments:', error);
      throw error;
    }
  }

  private generateId(): string {
    return `schedule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export const scheduleService = new ScheduleService();
export default scheduleService;
