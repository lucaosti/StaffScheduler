/**
 * Self-service preferences (F07).
 *
 * Thin CRUD over `user_preferences`. The compliance engine reads the same
 * row at assignment time, so a user can tighten their own working-time
 * rules just by saving stricter preferences.
 *
 * @author Luca Ostinelli
 */

import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { logger } from '../config/logger';

interface UserPreferences {
  userId: number;
  maxHoursPerWeek: number;
  minHoursPerWeek: number;
  maxConsecutiveDays: number;
  preferredShifts: number[];
  avoidShifts: number[];
  notes: string | null;
  updatedAt: string;
}

interface UpsertPreferencesInput {
  maxHoursPerWeek?: number;
  minHoursPerWeek?: number;
  maxConsecutiveDays?: number;
  preferredShifts?: number[];
  avoidShifts?: number[];
  notes?: string | null;
}

const parseJsonArray = (value: unknown): number[] => {
  if (Array.isArray(value)) return value as number[];
  if (typeof value === 'string' && value.length > 0) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as number[]) : [];
    } catch {
      return [];
    }
  }
  return [];
};

const mapRow = (row: RowDataPacket): UserPreferences => ({
  userId: row.user_id as number,
  maxHoursPerWeek: row.max_hours_per_week as number,
  minHoursPerWeek: row.min_hours_per_week as number,
  maxConsecutiveDays: row.max_consecutive_days as number,
  preferredShifts: parseJsonArray(row.preferred_shifts),
  avoidShifts: parseJsonArray(row.avoid_shifts),
  notes: (row.notes as string | null) ?? null,
  updatedAt: row.updated_at as string,
});

const validate = (input: UpsertPreferencesInput): void => {
  if (input.maxHoursPerWeek !== undefined && input.maxHoursPerWeek <= 0) {
    throw new Error('maxHoursPerWeek must be positive');
  }
  if (input.minHoursPerWeek !== undefined && input.minHoursPerWeek < 0) {
    throw new Error('minHoursPerWeek must be non-negative');
  }
  if (
    input.maxHoursPerWeek !== undefined &&
    input.minHoursPerWeek !== undefined &&
    input.minHoursPerWeek > input.maxHoursPerWeek
  ) {
    throw new Error('minHoursPerWeek cannot exceed maxHoursPerWeek');
  }
  if (
    input.maxConsecutiveDays !== undefined &&
    (input.maxConsecutiveDays < 1 || input.maxConsecutiveDays > 14)
  ) {
    throw new Error('maxConsecutiveDays must be between 1 and 14');
  }
};

export class PreferencesService {
  constructor(private pool: Pool) {}

  async getByUserId(userId: number): Promise<UserPreferences | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM user_preferences WHERE user_id = ? LIMIT 1`,
      [userId]
    );
    return rows.length === 0 ? null : mapRow(rows[0]);
  }

  /** Upsert: update if a row exists for the user, otherwise insert. */
  async upsert(userId: number, input: UpsertPreferencesInput): Promise<UserPreferences> {
    validate(input);

    const existing = await this.getByUserId(userId);
    if (existing) {
      const next = {
        max_hours_per_week: input.maxHoursPerWeek ?? existing.maxHoursPerWeek,
        min_hours_per_week: input.minHoursPerWeek ?? existing.minHoursPerWeek,
        max_consecutive_days: input.maxConsecutiveDays ?? existing.maxConsecutiveDays,
        preferred_shifts: JSON.stringify(input.preferredShifts ?? existing.preferredShifts),
        avoid_shifts: JSON.stringify(input.avoidShifts ?? existing.avoidShifts),
        notes: input.notes !== undefined ? input.notes : existing.notes,
      };
      await this.pool.execute<ResultSetHeader>(
        `UPDATE user_preferences
            SET max_hours_per_week = ?, min_hours_per_week = ?, max_consecutive_days = ?,
                preferred_shifts = ?, avoid_shifts = ?, notes = ?
          WHERE user_id = ?`,
        [
          next.max_hours_per_week,
          next.min_hours_per_week,
          next.max_consecutive_days,
          next.preferred_shifts,
          next.avoid_shifts,
          next.notes,
          userId,
        ]
      );
      logger.info(`Preferences updated for user ${userId}`);
    } else {
      await this.pool.execute<ResultSetHeader>(
        `INSERT INTO user_preferences
            (user_id, max_hours_per_week, min_hours_per_week, max_consecutive_days,
             preferred_shifts, avoid_shifts, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          input.maxHoursPerWeek ?? 40,
          input.minHoursPerWeek ?? 0,
          input.maxConsecutiveDays ?? 5,
          JSON.stringify(input.preferredShifts ?? []),
          JSON.stringify(input.avoidShifts ?? []),
          input.notes ?? null,
        ]
      );
      logger.info(`Preferences created for user ${userId}`);
    }

    const refreshed = await this.getByUserId(userId);
    if (!refreshed) throw new Error('Failed to retrieve preferences after upsert');
    return refreshed;
  }
}
