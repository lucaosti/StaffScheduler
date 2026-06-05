import { Pool, RowDataPacket } from 'mysql2/promise';
import { logger } from '../config/logger';

export class AssignmentValidator {
  constructor(private pool: Pool) {}

  async checkConflicts(
    userId: number,
    date: string,
    startTime: string,
    endTime: string
  ): Promise<any[]> {
    try {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT
          sa.id, s.date as shift_date, s.start_time, s.end_time,
          d.name as department_name
        FROM shift_assignments sa
        JOIN shifts s ON sa.shift_id = s.id
        JOIN departments d ON s.department_id = d.id
        WHERE sa.user_id = ?
        AND sa.status IN ('pending', 'confirmed')
        AND s.date = ?
        AND (
          (s.start_time < ? AND s.end_time > ?)
          OR (s.start_time >= ? AND s.start_time < ?)
          OR (s.end_time > ? AND s.end_time <= ?)
        )`,
        [userId, date, endTime, startTime, startTime, endTime, startTime, endTime]
      );

      return rows.map((row: any) => ({
        assignmentId: row.id,
        shiftDate: row.shift_date,
        startTime: row.start_time,
        endTime: row.end_time,
        departmentName: row.department_name
      }));
    } catch (error) {
      logger.error('Failed to check conflicts:', error);
      throw error;
    }
  }

  async checkUserAvailability(
    userId: number,
    date: string,
    _startTime: string,
    _endTime: string
  ): Promise<boolean> {
    try {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT id FROM user_unavailability
         WHERE user_id = ?
           AND ? BETWEEN start_date AND end_date
         LIMIT 1`,
        [userId, date]
      );

      return rows.length === 0;
    } catch (error) {
      logger.error('Failed to check user availability:', error);
      throw error;
    }
  }
}
