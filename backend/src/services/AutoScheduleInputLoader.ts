/**
 * Every read the auto-schedule run performs, and nothing else.
 *
 * WHY THE READS ARE THEIR OWN CLASS. `AutoScheduleService.generate` used to
 * interleave eleven queries with the problem assembly, the engine call and two
 * persistence paths in one 474-line method. The reads are the bulk of it and
 * the part with the least in common with the rest: they answer "what is true
 * right now", where everything downstream decides what to do about it. Split
 * out, the orchestrator reads as the five steps it actually performs, and the
 * pure builder in `autoScheduleProblem.ts` becomes reachable without a database
 * at all.
 *
 * The statements themselves are unchanged, deliberately: the service's test
 * suite dispatches its fixtures on a distinctive fragment of each one, so
 * keeping them textually intact is what lets that suite go on proving this
 * refactor changed no behaviour.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket } from 'mysql2/promise';
import { NotFoundError } from '../errors';
import type { SqlParam } from '../types';
import { DateUtils } from '../utils';
import { inClause } from '../utils/sql';
import { isWeekendDay, isNightWork } from '../optimization/constraintValidator';
import { EmployeeLoanService } from './EmployeeLoanService';
import { EmploymentContractService } from './EmploymentContractService';
import {
  carriedLoads,
  type CategoryLoad,
  type EmployeeInputRow,
  type ScheduleInputs,
  type ScheduleRow,
  type ShiftInputRow,
} from './autoScheduleProblem';

/**
 * How far back equity is measured, in days.
 *
 * A CHOSEN number, not a derived one, and it should be read as such. Ninety
 * days is long enough that a heavy month is compensated within the window and
 * short enough to be explainable to the person it affects — "over the last
 * three months". A calendar quarter was rejected because it resets: whoever
 * took every weekend in March would be level again on 1 April, which is the
 * defect this fixes moved three months along rather than fixed.
 */
const EQUITY_HORIZON_DAYS = 90;

/**
 * How many predecessor periods the rotation streak walk looks back through.
 *
 * A CHOSEN bound, not a derived one — the walk follows `resolvePredecessorId`
 * one period at a time and would otherwise run the full length of a
 * department's published history on every generate() call. Six periods is
 * enough to answer "is this person concentrated on this category right now"
 * (the threshold that actually flags a violation is
 * `max_consecutive_category_periods`, default 2 — well inside this cap) while
 * keeping the walk's cost bounded regardless of how far back a department's
 * schedule chain goes.
 */
const ROTATION_LOOKBACK_CAP = 6;

export class AutoScheduleInputLoader {
  constructor(private pool: Pool) {}

  private async rows(sql: string, params: SqlParam[] = []): Promise<RowDataPacket[]> {
    const [result] = await this.pool.execute<RowDataPacket[]>(sql, params);
    return result;
  }

  /**
   * A read narrowed to the candidate set, skipped entirely when there is none.
   *
   * The id list is interpolated rather than bound (an IN list cannot be a
   * single parameter), so an empty set would render `IN ()` — a syntax error
   * rather than an empty result. Three reads share this guard; each used to
   * spell it out with its own ternary over `[[] as RowDataPacket[]]`.
   */
  private async rowsForCandidates(
    employeeIds: number[],
    sql: (ids: string) => string,
    params: SqlParam[] = []
  ): Promise<RowDataPacket[]> {
    if (employeeIds.length === 0) return [];
    return this.rows(sql(inClause(employeeIds)), params);
  }

  /**
   * The schedule this one continues from.
   *
   * An explicit `previous_schedule_id` wins. It exists because when several
   * generations cover the same period, which one actually happened is a
   * judgement a manager makes and the system cannot infer.
   *
   * NULL means "use the default", not "no predecessor": the most recent
   * PUBLISHED schedule for the same department ending before this one starts.
   * Published, because an unpublished draft is not what happened — and because
   * defaulting to a draft would reintroduce the problem the explicit column
   * exists to solve, silently picking one candidate generation out of several.
   *
   * Returns null when there is nothing before this schedule, which is the
   * honest answer for the first schedule a department ever has.
   */
  async resolvePredecessorId(scheduleId: number, schedule: ScheduleRow): Promise<number | null> {
    if (schedule.previous_schedule_id) return schedule.previous_schedule_id;

    const rows = await this.rows(
      `SELECT id FROM schedules
        WHERE department_id = ?
          AND id != ?
          AND status = 'published'
          AND end_date < ?
        ORDER BY end_date DESC, id DESC
        LIMIT 1`,
      [schedule.department_id, scheduleId, schedule.start_date]
    );
    return rows.length > 0 ? (rows[0].id as number) : null;
  }

  /**
   * How many of the most recent consecutive PUBLISHED predecessor periods
   * each employee already held a category (weekend/night), for every
   * employee in `employeeIds`.
   *
   * WALKS THE SAME PREDECESSOR CHAIN `resolvePredecessorId` USES, one period
   * at a time, up to `ROTATION_LOOKBACK_CAP` periods back. A period counts
   * toward an employee's streak the moment they worked at least one day of
   * the category in it; the walk for that employee/category STOPS at the
   * first period that didn't, or at the cap, or at the first non-published
   * predecessor (an explicit `previous_schedule_id` need not be published,
   * and only what actually happened should extend a streak) — whichever
   * comes first. This is a count of PERIODS, not days, which is why it is a
   * separate mechanism from `carriedLoads`' cumulative deviation.
   */
  private async consecutiveCategoryPeriods(
    scheduleId: number,
    schedule: ScheduleRow,
    employeeIds: number[]
  ): Promise<Map<number, CategoryLoad>> {
    const counts = new Map<number, CategoryLoad>(
      employeeIds.map((id) => [id, { weekend: 0, night: 0 }])
    );
    if (employeeIds.length === 0) return counts;

    // Per employee, per category: still on an unbroken streak walking
    // backwards. Once a period fails to qualify for a category, that
    // employee/category pair stops accumulating for the rest of the walk —
    // only the CONSECUTIVE run counts.
    const stillCounting = new Map<number, { weekend: boolean; night: boolean }>(
      employeeIds.map((id) => [id, { weekend: true, night: true }])
    );

    let currentId = scheduleId;
    let current = schedule;

    for (let period = 0; period < ROTATION_LOOKBACK_CAP; period++) {
      const predecessorId = await this.resolvePredecessorId(currentId, current);
      if (!predecessorId) break;

      const predRows = await this.rows(
        `SELECT id, department_id, start_date, end_date, status, previous_schedule_id
           FROM schedules AS sc WHERE sc.id = ? LIMIT 1`,
        [predecessorId]
      );
      if (predRows.length === 0) break;
      const predecessor = predRows[0] as ScheduleRow;
      // Only what actually happened extends a streak — the same reasoning
      // `carriedLoads`' history read applies to the equity horizon.
      if (predecessor.status !== 'published') break;

      const workedRows = await this.rows(
        `SELECT sa.user_id, s.date, s.start_time, s.end_time
           -- rotation streak: shifts worked in this predecessor period
           FROM shift_assignments sa
           JOIN shifts s ON s.id = sa.shift_id
          WHERE s.schedule_id = ?
            AND sa.status IN ('pending', 'confirmed')
            AND sa.user_id IN (${inClause(employeeIds)})`,
        [predecessorId]
      );

      const workedWeekend = new Set<number>();
      const workedNight = new Set<number>();
      for (const row of workedRows) {
        const userId = row.user_id as number;
        const date = DateUtils.toDateString(row.date as string | Date);
        if (isWeekendDay(date)) workedWeekend.add(userId);
        if (
          isNightWork({
            date,
            start_time: row.start_time as string,
            end_time: row.end_time as string,
          })
        ) {
          workedNight.add(userId);
        }
      }

      let anyoneStillCounting = false;
      for (const id of employeeIds) {
        const flags = stillCounting.get(id)!;
        const total = counts.get(id)!;
        if (flags.weekend) {
          if (workedWeekend.has(id)) total.weekend += 1;
          else flags.weekend = false;
        }
        if (flags.night) {
          if (workedNight.has(id)) total.night += 1;
          else flags.night = false;
        }
        if (flags.weekend || flags.night) anyoneStillCounting = true;
      }

      // Nobody left with a live streak — further periods cannot change the
      // result, so stop walking rather than paying for periods that can only
      // ever be discarded.
      if (!anyoneStillCounting) break;

      currentId = predecessorId;
      current = predecessor;
    }

    return counts;
  }

  /**
   * Loads everything a generate() run needs, in one pass.
   *
   * Returns NULL when the schedule holds no shifts, and does so before the ten
   * remaining reads: there is nothing to solve, so paying for the candidate
   * pool, the equity horizon and the rotation walk would buy nothing. Null is
   * unambiguous here because a schedule that does not exist throws instead.
   */
  async load(scheduleId: number): Promise<ScheduleInputs | null> {
    const schedRows = await this.rows(
      `SELECT id, department_id, start_date, end_date, status, previous_schedule_id
         FROM schedules WHERE id = ? LIMIT 1`,
      [scheduleId]
    );
    if (schedRows.length === 0) throw new NotFoundError('Schedule not found');
    const schedule = schedRows[0] as ScheduleRow;

    const shiftRows = await this.rows(
      `SELECT s.id, s.date, s.start_time, s.end_time, s.min_staff, s.max_staff,
              s.department_id,
              GROUP_CONCAT(DISTINCT sk.name) AS skill_names,
              -- name:level pairs, so the required proficiency travels with the
              -- skill it belongs to. Rows with no requirement are skipped
              -- rather than emitted as ":null", keeping "absent means any
              -- level" the default.
              GROUP_CONCAT(
                DISTINCT CONCAT(sk.name, ':', ss.min_proficiency)
                ORDER BY sk.name
              ) AS skill_levels,
              -- name:level:count triples for the "at least N at level L" rule.
              -- A separate list from skill_levels because the two are
              -- independent requirements: one filters who may be assigned, the
              -- other counts who must be present.
              GROUP_CONCAT(
                DISTINCT CONCAT(sk.name, ':', ss.min_qualified_level, ':', ss.min_qualified_staff)
                ORDER BY sk.name
              ) AS qualified_staff
         FROM shifts s
         LEFT JOIN shift_skills ss ON s.id = ss.shift_id
         LEFT JOIN skills sk ON ss.skill_id = sk.id
        WHERE s.schedule_id = ?
        GROUP BY s.id`,
      [scheduleId]
    );
    const shifts = shiftRows as unknown as ShiftInputRow[];
    if (shifts.length === 0) return null;

    // Employees in the department, PLUS anyone on an approved loan into it for
    // this schedule's period.
    //
    // Loans are scoped to `org_units`, scheduling to `departments` — two
    // separate hierarchies bridged only by `departments.org_unit_id`. Without
    // this, approving a loan would change nothing but the loan's own status:
    // the borrowed person would never become a candidate for the borrowing
    // department's shifts. A department with no `org_unit_id` set simply has
    // no bridge yet, so it degrades to the plain department-only pool.
    const deptRows = await this.rows(`SELECT org_unit_id FROM departments WHERE id = ? LIMIT 1`, [
      schedule.department_id,
    ]);
    const deptOrgUnitId = deptRows.length > 0 ? (deptRows[0].org_unit_id as number | null) : null;
    const startDate = String(schedule.start_date).slice(0, 10);
    const endDate = String(schedule.end_date).slice(0, 10);
    const loanedInUserIds = deptOrgUnitId
      ? await new EmployeeLoanService(this.pool).listLoanedInUserIds(
          deptOrgUnitId,
          startDate,
          endDate
        )
      : [];

    // LEFT JOIN (rather than an INNER JOIN) so a loaned-in user with no
    // `user_departments` row still survives to the WHERE clause; the OR branch
    // is what actually admits them. `inClause` throws on an empty list, so it
    // is only reached when there is something to include.
    const loanedInCondition =
      loanedInUserIds.length > 0
        ? `(ud.department_id IS NOT NULL OR u.id IN (${inClause(loanedInUserIds)}))`
        : `ud.department_id IS NOT NULL`;
    const empRows = await this.rows(
      `SELECT u.id,
              GROUP_CONCAT(DISTINCT sk.name) AS skill_names,
              GROUP_CONCAT(
                DISTINCT CONCAT(sk.name, ':', us.proficiency_level)
                ORDER BY sk.name
              ) AS skill_levels,
              COALESCE(up.max_hours_per_week, 40) AS max_hours_per_week,
              COALESCE(up.min_hours_per_week, 0)  AS min_hours_per_week,
              COALESCE(up.max_consecutive_days, 5) AS max_consecutive_days,
              u.hourly_rate
         FROM users u
         LEFT JOIN user_departments ud ON u.id = ud.user_id AND ud.department_id = ?
         LEFT JOIN user_skills us ON u.id = us.user_id
         LEFT JOIN skills sk ON us.skill_id = sk.id
         LEFT JOIN user_preferences up ON up.user_id = u.id
        WHERE u.is_active = 1 AND ${loanedInCondition}
        GROUP BY u.id`,
      [schedule.department_id]
    );
    const employees = empRows as unknown as EmployeeInputRow[];
    const employeeIds = employees.map((e) => e.id);

    // Commitments on THIS schedule: assignments a previous run published and
    // people have been told about. The optimizer plans AROUND them rather than
    // reconsidering them, and the caller's diff reports any it had to break.
    const pinnedRows = await this.rows(
      `SELECT sa.user_id, sa.shift_id
         FROM shift_assignments sa
         JOIN shifts s ON s.id = sa.shift_id
        WHERE s.schedule_id = ?
          AND sa.is_pinned = 1
          AND sa.status IN ('pending', 'confirmed')`,
      [scheduleId]
    );

    // Pairing rules constraining who may share a shift. Read for the whole
    // department's staff rather than per shift: the rules are about people,
    // and the engine applies them to every shift it considers.
    const pairingRows = await this.rows(
      `SELECT p.user_id, p.other_user_id, p.kind
         FROM employee_pairings p
        WHERE p.user_id IN (
                SELECT user_id FROM user_departments WHERE department_id = ?
              )
           OR p.other_user_id IN (
                SELECT user_id FROM user_departments WHERE department_id = ?
              )`,
      [schedule.department_id, schedule.department_id]
    );

    // Equity history: category days worked in the window BEFORE this period,
    // from PUBLISHED schedules only — a draft is not what happened, and a
    // draft's weekends would follow someone into the next month having never
    // been worked.
    //
    // Read for the same candidates the solver is choosing between, since the
    // deviation is measured against their average.
    const historyRows = await this.rowsForCandidates(
      employeeIds,
      (ids) => `SELECT sa.user_id, s.date, s.start_time, s.end_time
             FROM shift_assignments sa
             JOIN shifts s ON s.id = sa.shift_id
             JOIN schedules sc ON sc.id = s.schedule_id
            WHERE sc.status = 'published'
              AND sc.id != ?
              AND sa.status IN ('pending', 'confirmed')
              AND sa.user_id IN (${ids})
              AND s.date >= DATE_SUB(?, INTERVAL ${EQUITY_HORIZON_DAYS} DAY)
              AND s.date < ?`,
      [scheduleId, schedule.start_date, schedule.start_date]
    );

    // Rotation streak: how many consecutive PUBLISHED predecessor periods each
    // employee already held a category, walked separately from the equity
    // horizon above — a count of periods rather than a deviation over a fixed
    // date window, so it needs its own predecessor-chain walk.
    const rotationHistory = await this.consecutiveCategoryPeriods(
      scheduleId,
      schedule,
      employeeIds
    );

    const contractLimits = await new EmploymentContractService(this.pool).resolveLimitsForPeriod(
      employeeIds,
      startDate,
      endDate
    );

    // Filtered against `employeeIds`, not a fresh `user_departments` lookup —
    // that set already includes anyone admitted via a loan above, and a
    // loaned-in person's unavailability has to count exactly like a permanent
    // member's.
    const unavailRows = await this.rowsForCandidates(
      employeeIds,
      (ids) => `SELECT user_id, start_date, end_date FROM user_unavailability
            WHERE user_id IN (${ids})`
    );

    // Assignments this employee already holds elsewhere, within reach of this
    // schedule's rolling-window checks (±14 days, matching
    // ComplianceEngine.evaluateAssignmentCompliance's own lookback/lookahead).
    // Without this, back-to-back schedule periods are optimized in total
    // isolation from each other — each can look individually compliant while
    // an employee assigned late in period N and early in period N+1 quietly
    // busts max-consecutive-days/max-weekly-hours across the boundary.
    //
    // WHICH schedules count is the part that used to be wrong. This read took
    // every OTHER schedule in the window and filtered on the assignment's
    // status, never the schedule's — so drafts counted. A planner comparing
    // three candidate generations for last month had all three read at once:
    // one person appeared to be working three overlapping sets of shifts,
    // their history at the boundary was inflated threefold, and this month was
    // constrained by work that will never happen, since at most one of those
    // drafts can ever be published.
    //
    // So: published schedules, which are what actually happened, PLUS the
    // chosen predecessor whatever its status — a planner who names a draft as
    // the schedule this one continues from means it.
    const predecessorId = await this.resolvePredecessorId(scheduleId, schedule);
    const externalRows = await this.rowsForCandidates(
      employeeIds,
      (ids) => `SELECT sa.user_id, s.date, s.start_time, s.end_time
             FROM shift_assignments sa
             JOIN shifts s ON s.id = sa.shift_id
             JOIN schedules sc ON sc.id = s.schedule_id
            WHERE s.schedule_id != ?
              AND (sc.status = 'published' OR sc.id = ?)
              AND sa.status IN ('pending', 'confirmed')
              AND sa.user_id IN (${ids})
              AND s.date BETWEEN DATE_SUB(?, INTERVAL 14 DAY) AND DATE_ADD(?, INTERVAL 14 DAY)`,
      [
        scheduleId,
        // 0 matches nothing, which is what "no predecessor" has to mean here.
        // A NULL would make the comparison NULL and silently drop the whole
        // OR branch — the same result by accident rather than by intent.
        predecessorId ?? 0,
        schedule.start_date,
        schedule.end_date,
      ]
    );

    return {
      schedule,
      shifts,
      employees,
      pinned: pinnedRows.map((r) => ({
        employee_id: String(r.user_id),
        shift_id: String(r.shift_id),
      })),
      pairings: pairingRows.map((r) => ({
        employee_id: String(r.user_id),
        other_id: String(r.other_user_id),
        kind: r.kind as 'apart' | 'requires',
      })),
      contractLimits,
      unavailableByUser: expandUnavailability(unavailRows),
      externalAssignmentsByUser: groupAssignmentsByUser(externalRows),
      carried: carriedLoads(
        historyRows.map((r) => ({
          userId: r.user_id as number,
          date: DateUtils.toDateString(r.date as string | Date),
          startTime: r.start_time as string,
          endTime: r.end_time as string,
        })),
        employeeIds
      ),
      rotationHistory,
    };
  }
}

/** Each unavailability range as the list of days it covers, per user. */
const expandUnavailability = (rows: RowDataPacket[]): Map<number, string[]> => {
  const byUser = new Map<number, string[]>();
  for (const row of rows) {
    const end = new Date(row.end_date as Date);
    const dates: string[] = [];
    for (let d = new Date(row.start_date as Date); d <= end; d.setDate(d.getDate() + 1)) {
      dates.push(DateUtils.fromMySQLDate(d));
    }
    const userId = row.user_id as number;
    byUser.set(userId, [...(byUser.get(userId) ?? []), ...dates]);
  }
  return byUser;
};

/** Cross-schedule assignments grouped by the employee holding them. */
const groupAssignmentsByUser = (
  rows: RowDataPacket[]
): Map<number, Array<{ date: string; start_time: string; end_time: string }>> => {
  const byUser = new Map<number, Array<{ date: string; start_time: string; end_time: string }>>();
  for (const row of rows) {
    const userId = row.user_id as number;
    const list = byUser.get(userId) ?? [];
    list.push({
      date: DateUtils.toDateString(row.date as string | Date),
      start_time: row.start_time as string,
      end_time: row.end_time as string,
    });
    byUser.set(userId, list);
  }
  return byUser;
};
