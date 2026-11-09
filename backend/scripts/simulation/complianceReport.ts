/**
 * Constraint verification of a generated schedule.
 *
 * Re-checks every live assignment on a schedule against the same
 * deterministic ComplianceEngine used in production — not a simulation-only
 * approximation. A violation is a finding; a clean schedule logs one
 * confirming line. This reads the database directly on purpose: it judges
 * what the API produced, it does not act.
 *
 * @author Luca Ostinelli
 */

import { RowDataPacket } from 'mysql2/promise';
import { evaluateAssignmentCompliance } from '../../src/services/ComplianceEngine';
import { DateUtils } from '../../src/utils';
import { World } from './world';

export async function verifyComplianceForSchedule(world: World, scheduleId: number, label: string): Promise<void> {
  const [rows] = await world.pool.execute<RowDataPacket[]>(
    `SELECT sa.id AS assignment_id, sa.user_id, s.date, s.start_time, s.end_time
       FROM shift_assignments sa
       JOIN shifts s ON s.id = sa.shift_id
      WHERE s.schedule_id = ? AND sa.status IN ('pending', 'confirmed')`,
    [scheduleId]
  );
  let violations = 0;
  const reported = new Set<number>();
  for (const row of rows) {
    const result = await evaluateAssignmentCompliance(
      world.pool,
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
      world.log.count('compliance.violations');
      // The violation details (rest hours, weekly total, the conflicting date)
      // are the evidence: the database is gone once a disposable run ends.
      // The person's whole week across every schedule, once per person: it
      // shows whether the violation comes from one schedule or from two
      // (a loaned employee planned by both units).
      let week = '';
      if (!reported.has(row.user_id as number)) {
        reported.add(row.user_id as number);
        const [around] = await world.pool.execute<RowDataPacket[]>(
          `SELECT s.schedule_id, s.date, s.start_time, s.end_time FROM shift_assignments sa JOIN shifts s ON s.id = sa.shift_id
            WHERE sa.user_id = ? AND sa.status IN ('pending', 'confirmed') AND s.date BETWEEN DATE_SUB(?, INTERVAL 7 DAY) AND DATE_ADD(?, INTERVAL 7 DAY)
            ORDER BY s.date, s.start_time`,
          [row.user_id, row.date, row.date]
        );
        week = ` | week: ${around
          .map((a) => `s${a.schedule_id} ${typeof a.date === 'string' ? a.date : DateUtils.fromMySQLDate(a.date as Date)} ${a.start_time}-${a.end_time}`)
          .join(', ')}`;
      }
      world.dbFinding(
        `compliance: assignment #${row.assignment_id} (user #${row.user_id}, schedule "${label}", ${row.start_time}-${row.end_time})`,
        result.violations.map((v) => `${v.code} ${JSON.stringify(v.details ?? {})}`).join('; ') + week
      );
    }
  }
  if (violations === 0) {
    world.log.verify(true, `compliance: schedule "${label}"`, `all ${rows.length} assignments respect the hard constraints`);
  }
}
