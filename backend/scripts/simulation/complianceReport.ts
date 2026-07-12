/**
 * Final constraint verification pass.
 *
 * Re-checks every assignment currently on the two simulated schedules
 * (baseline, post-swaps, and future, post-generation) against the same
 * deterministic ComplianceEngine used in production — not a simulation-only
 * approximation. Any violation found here is logged explicitly; a clean run
 * logs a single confirming line per schedule.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket } from 'mysql2/promise';
import { evaluateAssignmentCompliance } from '../../src/services/ComplianceEngine';
import { DateUtils } from '../../src/utils';
import { MegaLog } from './megaLog';

export async function verifyComplianceForSchedule(
  pool: Pool,
  log: MegaLog,
  scheduleId: number,
  label: string
): Promise<void> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT sa.id AS assignment_id, sa.user_id, s.date, s.start_time, s.end_time
       FROM shift_assignments sa
       JOIN shifts s ON s.id = sa.shift_id
      WHERE s.schedule_id = ? AND sa.status IN ('pending', 'confirmed')`,
    [scheduleId]
  );

  log.info(`Checking compliance for ${rows.length} assignments on schedule "${label}" (id=${scheduleId})...`);
  let violations = 0;
  for (const row of rows) {
    const result = await evaluateAssignmentCompliance(
      pool,
      row.user_id as number,
      {
        date: typeof row.date === 'string' ? row.date : DateUtils.fromMySQLDate(row.date as Date),
        startTime: row.start_time as string,
        endTime: row.end_time as string,
      },
      { excludeAssignmentId: row.assignment_id as number }
    );
    if (!result.ok) {
      violations++;
      log.verify(
        false,
        `compliance: assignment #${row.assignment_id} (user #${row.user_id}, schedule "${label}")`,
        result.violations.map((v) => v.code).join(', ')
      );
      log.count('compliance.violations');
    }
  }
  if (violations === 0) {
    log.verify(true, `compliance: schedule "${label}"`, `all ${rows.length} assignments respect max-consecutive-days, min-rest and max-weekly-hours`);
  }
}
