/**
 * Read-only checks that decide whether a person can take a shift.
 *
 * Extracted from `AssignmentService` — see that file for why the seam is drawn
 * here. This class performs no writes and opens no transactions, so it can be
 * exercised against a fixture database without setting anything up to tear
 * down. It answers questions; it never acts on the answers.
 *
 * WHY CONFLICT DETECTION WORKS IN ABSOLUTE TIME. A shift is stored as a DATE
 * plus two TIME columns, so the obvious query — same date, compare wall-clock
 * times — is wrong for any shift crossing midnight, and wrong in both
 * directions:
 *
 *   - a 22:00–06:00 and a 23:00–07:00 shift on the same date genuinely
 *     overlap, but `start_time < '07:00' AND end_time > '23:00'` is false
 *     because `'22:00' < '07:00'` compares as strings on a clock that has
 *     already wrapped;
 *   - a 22:00–06:00 shift on the 1st overlaps a 02:00–08:00 shift on the 2nd,
 *     and a query filtered to `s.date = '2026-03-02'` never even looks at the
 *     row dated the 1st.
 *
 * Both misses are silent double-bookings — the system would accept an
 * assignment placing one person on two shifts at once, which is the first hard
 * constraint the optimizer enforces. Reconstructing the absolute interval on
 * both sides and testing `existing.start < candidate.end AND existing.end >
 * candidate.start` is the standard half-open overlap test and handles every
 * case uniformly.
 *
 * WHY THE DATE FILTER SPANS THREE DAYS RATHER THAN BEING DROPPED. The overlap
 * test alone is correct but would scan every assignment the user has ever had.
 * A shift cannot run longer than 24 hours, so only the day before, the day
 * itself and the day after can possibly overlap — and `s.date BETWEEN ? AND ?`
 * keeps `idx_date` usable, which a computed-column comparison would not.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket } from 'mysql2/promise';
import { logger } from '../config/logger';
import { DateUtils } from '../utils';
import { SHIFT_ABS_END_SQL } from '../utils/sql';

/** Anything that can run a prepared statement — a pool or a transaction connection. */
type SqlExecutor = Pick<Pool, 'execute'>;

export class AssignmentValidator {
  constructor(private pool: Pool) {}

  /**
   * Returns the user's assignments that overlap the given shift window.
   *
   * `date` is the shift's START date; an `endTime` at or before `startTime`
   * means the shift runs into the following day.
   *
   * Pass the transaction `connection` as `executor` when the check must see
   * (and be serialized with) uncommitted rows of the surrounding transaction —
   * otherwise two concurrent assignments can each find no conflict.
   */
  async checkConflicts(
    userId: number,
    date: string,
    startTime: string,
    endTime: string,
    executor: SqlExecutor = this.pool
  ): Promise<any[]> {
    try {
      const [candidateStart, candidateEnd] = DateUtils.shiftBounds(date, startTime, endTime);
      const [rows] = await executor.execute<RowDataPacket[]>(
        `SELECT
          sa.id, s.date as shift_date, s.start_time, s.end_time,
          d.name as department_name
        FROM shift_assignments sa
        JOIN shifts s ON sa.shift_id = s.id
        JOIN departments d ON s.department_id = d.id
        WHERE sa.user_id = ?
        AND sa.status IN ('pending', 'confirmed')
        -- Sargable pre-filter: no shift exceeds 24h, so only the adjacent days
        -- can overlap. Keeps idx_date usable ahead of the exact test below.
        AND s.date BETWEEN DATE_SUB(?, INTERVAL 1 DAY) AND DATE_ADD(?, INTERVAL 1 DAY)
        -- Half-open overlap in absolute time, overnight-aware on both sides.
        AND TIMESTAMP(s.date, s.start_time) < ?
        AND ${SHIFT_ABS_END_SQL} > ?`,
        [userId, date, date, candidateEnd, candidateStart]
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

  /**
   * Returns true when the user has no unavailability window covering `date`.
   * Unavailability is tracked per calendar day, so no time-of-day arguments.
   *
   * An overnight shift is checked against its START date only, consistently
   * with how its hours are attributed (see `DateUtils.shiftBounds`). Someone
   * unavailable on the 2nd can still hold a shift starting 22:00 on the 1st —
   * which is the intended reading of a day off, since the shift is the 1st's
   * night shift.
   */
  async checkUserAvailability(
    userId: number,
    date: string,
    executor: SqlExecutor = this.pool
  ): Promise<boolean> {
    try {
      const [rows] = await executor.execute<RowDataPacket[]>(
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
