/**
 * Auto-schedule orchestrator (F09).
 *
 * Glues the optimization engine to the database. Steps:
 *
 *   1. Load the schedule and the open/empty shifts inside it.
 *   2. Load active users in the schedule's department, with their skills
 *      and unavailability blocks.
 *   3. Build an OptimizationProblem, call ScheduleOptimizer.
 *   4. Persist resulting assignments inside a single transaction.
 *
 * Engine selection (OPTIMIZATION_ENGINE):
 *   - 'or-tools' (DEFAULT): route through the Python OR-Tools CP-SAT solver —
 *     the most optimal engine. If Python is unavailable or times out it still
 *     produces a schedule via the greedy solver, but that fallback is never
 *     silent: the result reports engine='greedy' with degraded=true and a
 *     reason, and a warning is logged. The optimum is always attempted first.
 *   - 'greedy' (a.k.a. legacy 'javascript'): explicit DRAFT mode — the fast
 *     best-effort greedy pass, chosen deliberately. Reports engine='greedy'
 *     with degraded=false so callers can tell an intentional draft from a
 *     degraded fallback.
 *
 * Because both engines are held to one shared constraint definition (see
 * optimization/constraintValidator.ts and the optimizer.parity.test.ts suite),
 * either engine's output respects the same hard rules; they differ only in how
 * close to optimal the coverage/fairness is.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { NotFoundError } from '../errors';
import { ScheduleOptimizer } from '../optimization/ScheduleOptimizerORTools';
import { logger } from '../config/logger';
import { DateUtils } from '../utils';
import { config } from '../config';
import { EmploymentContractService } from './EmploymentContractService';
import { EmployeeLoanService } from './EmployeeLoanService';
import { ReplanProposalService } from './ReplanProposalService';
import { isWeekendDay, isNightWork } from '../optimization/constraintValidator';
import { inClause } from '../utils/sql';

/**
 * Parses a `name:level` list into a lookup.
 *
 * Rows whose level is NULL arrive as "name:" or are absent entirely, and are
 * skipped: an absent entry means "unconstrained" for a shift and "level
 * unknown" for an employee, which is what every row meant before proficiency
 * reached the scheduler.
 */
const parseSkillLevels = (raw: string | null): Record<string, number> => {
  const levels: Record<string, number> = {};
  for (const pair of (raw ?? '').split(',')) {
    const [name, value] = pair.split(':');
    // `value` must be tested for emptiness BEFORE conversion: GROUP_CONCAT
    // emits "name:" when the column is NULL, and `Number('')` is 0 — a finite
    // number, so a naive check accepts it and an absent level becomes level 0,
    // which is below every requirement. That would silently disqualify
    // everyone whose proficiency was never recorded, the exact failure the
    // "absent means unknown" default exists to prevent.
    if (!name || value === undefined || value === '') continue;
    const level = Number(value);
    if (Number.isFinite(level)) levels[name] = level;
  }
  return levels;
};

/**
 * Parses `name:level:count` triples into the qualified-staff requirement.
 *
 * Rows where either column is NULL arrive with an empty segment and are
 * skipped: a shift that does not state the rule is not subject to it, matching
 * how every other absent limit behaves.
 */
const parseQualifiedStaff = (
  raw: string | null
): Record<string, { level: number; count: number }> => {
  const out: Record<string, { level: number; count: number }> = {};
  for (const triple of (raw ?? '').split(',')) {
    const [name, level, count] = triple.split(':');
    // Same trap as above, twice over: "name::" would parse as level 0 count 0.
    if (!name || !level || !count) continue;
    if (Number.isFinite(Number(level)) && Number.isFinite(Number(count))) {
      out[name] = { level: Number(level), count: Number(count) };
    }
  }
  return out;
};

interface AutoScheduleResult {
  scheduleId: number;
  assignmentsCreated: number;
  totalShifts: number;
  coveragePercentage: number;
  status: string;
  /**
   * Set when `status` is `PROPOSED`: the schedule was published, so the run
   * recorded a plan for approval instead of writing it.
   */
  proposalId?: number;
  /** How many assignments the pending proposal contains. */
  proposedAssignments?: number;
  /** The engine that actually produced this schedule. */
  engine: 'or-tools' | 'greedy';
  /**
   * Published assignments this run preserved.
   *
   * Reported alongside the broken ones because "nothing moved" is exactly the
   * answer a re-run on unchanged inputs should give, and an empty broken list
   * on its own is indistinguishable from a diff that was never computed.
   */
  keptCommitments: number;
  /**
   * Published assignments this run had to break — someone was told they were
   * working and now is not. The one outcome a re-solve must never produce
   * silently.
   */
  brokenCommitments: Array<{ userId: number; shiftId: number }>;
  /**
   * True when the optimal engine (or-tools) was requested but the run fell back
   * to greedy (Python unavailable/timed out, or the solver errored). Always
   * false for an intentionally-selected greedy draft. Lets the UI flag "this is
   * a draft, not the optimum" clearly rather than silently.
   */
  degraded: boolean;
  /** Why the run degraded, when it did (for logs and the UI banner). */
  degradedReason?: string;
}

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
 * A CHOSEN bound, not a derived one — the walk follows
 * `resolvePredecessorId` one period at a time and would otherwise run the
 * full length of a department's published history on every generate() call.
 * Six periods is enough to answer "is this person concentrated on this
 * category right now" (the threshold that actually flags a violation is
 * `max_consecutive_category_periods`, default 2 — well inside this cap) while
 * keeping the walk's cost bounded regardless of how far back a department's
 * schedule chain goes.
 */
const ROTATION_LOOKBACK_CAP = 6;

/**
 * Category days worked before this period, as a normalised deviation from the
 * average of the people being scheduled.
 *
 * WHY THE AVERAGE IS OVER THE CANDIDATES and not the whole organization: the
 * comparison that means anything is with the people the solver is choosing
 * between. Averaging across departments would compare a ward with an office.
 *
 * WHY NORMALISED TO NON-NEGATIVE. The objective minimises `max - min`, which
 * does not change if every load moves by the same amount, so shifting the set
 * up until the lowest sits at zero costs nothing and spares both engines a
 * negative lower bound on every load variable.
 *
 * Rounded to whole days: a fractional day is not something anyone experiences,
 * and both engines' load variables are integral.
 */
const carriedLoads = (
  rows: Array<{ userId: number; date: string; startTime: string; endTime: string }>,
  employeeIds: number[]
): Map<number, { weekend: number; night: number }> => {
  const weekendDays = new Map<number, Set<string>>();
  const nightDays = new Map<number, Set<string>>();
  for (const id of employeeIds) {
    weekendDays.set(id, new Set());
    nightDays.set(id, new Set());
  }

  for (const row of rows) {
    // Days, not shifts: two matching shifts on one date cost one day, the same
    // unit the in-period measure uses.
    if (isWeekendDay(row.date)) weekendDays.get(row.userId)?.add(row.date);
    if (isNightWork({ date: row.date, start_time: row.startTime, end_time: row.endTime })) {
      nightDays.get(row.userId)?.add(row.date);
    }
  }

  const deviations = (counts: Map<number, Set<string>>): Map<number, number> => {
    const totals = employeeIds.map((id) => counts.get(id)?.size ?? 0);
    const mean = totals.reduce((a, b) => a + b, 0) / (totals.length || 1);
    const raw = new Map(employeeIds.map((id, i) => [id, Math.round(totals[i] - mean)]));
    const lowest = Math.min(0, ...raw.values());
    return new Map([...raw].map(([id, d]) => [id, d - lowest]));
  };

  const weekend = deviations(weekendDays);
  const night = deviations(nightDays);
  return new Map(
    employeeIds.map((id) => [id, { weekend: weekend.get(id) ?? 0, night: night.get(id) ?? 0 }])
  );
};

export class AutoScheduleService {
  private loans: EmployeeLoanService;

  constructor(private pool: Pool) {
    this.loans = new EmployeeLoanService(pool);
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
  private async resolvePredecessorId(
    scheduleId: number,
    schedule: RowDataPacket
  ): Promise<number | null> {
    const explicit = schedule.previous_schedule_id as number | null;
    if (explicit) return explicit;

    const [rows] = await this.pool.execute<RowDataPacket[]>(
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
   * separate mechanism from `carriedLoads`' cumulative deviation above.
   */
  private async consecutiveCategoryPeriods(
    scheduleId: number,
    schedule: RowDataPacket,
    employeeIds: number[]
  ): Promise<Map<number, { weekend: number; night: number }>> {
    const counts = new Map<number, { weekend: number; night: number }>(
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

      const [predRows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT id, department_id, start_date, end_date, status, previous_schedule_id
           FROM schedules AS sc WHERE sc.id = ? LIMIT 1`,
        [predecessorId]
      );
      if (predRows.length === 0) break;
      const predecessor = predRows[0];
      // Only what actually happened extends a streak — the same reasoning
      // `carriedLoads`' history read applies to the equity horizon.
      if (predecessor.status !== 'published') break;

      const [workedRows] = await this.pool.execute<RowDataPacket[]>(
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
        if (isNightWork({ date, start_time: row.start_time as string, end_time: row.end_time as string })) {
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

  async generate(scheduleId: number, createdBy: number): Promise<AutoScheduleResult> {
    // 1. Schedule and its shifts.
    const [schedRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id, department_id, start_date, end_date, status, previous_schedule_id
         FROM schedules WHERE id = ? LIMIT 1`,
      [scheduleId]
    );
    if (schedRows.length === 0) throw new NotFoundError('Schedule not found');
    const schedule = schedRows[0];

    const [shiftRows] = await this.pool.execute<RowDataPacket[]>(
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
    if (shiftRows.length === 0) {
      return {
        scheduleId,
        assignmentsCreated: 0,
        totalShifts: 0,
        // A schedule with no shifts has no commitments to keep or break.
        keptCommitments: 0,
        brokenCommitments: [],
        coveragePercentage: 0,
        status: 'EMPTY',
        engine: config.optimization.engine === 'or-tools' ? 'or-tools' : 'greedy',
        degraded: false,
      };
    }

    // 2. Employees in the department, PLUS anyone on an approved loan into
    // it for this schedule's period.
    //
    // Loans are scoped to `org_units`, scheduling to `departments` — two
    // separate hierarchies bridged only by `departments.org_unit_id`. Without
    // this, approving a loan would change nothing but the loan's own status:
    // the borrowed person would never become a candidate for the borrowing
    // department's shifts. A department with no `org_unit_id` set simply has
    // no bridge yet, so it degrades to the plain department-only pool.
    const [deptRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT org_unit_id FROM departments WHERE id = ? LIMIT 1`,
      [schedule.department_id]
    );
    const deptOrgUnitId = deptRows.length > 0 ? (deptRows[0].org_unit_id as number | null) : null;
    const scheduleStartDate = String(schedule.start_date).slice(0, 10);
    const scheduleEndDate = String(schedule.end_date).slice(0, 10);
    const loanedInUserIds = deptOrgUnitId
      ? await this.loans.listLoanedInUserIds(deptOrgUnitId, scheduleStartDate, scheduleEndDate)
      : [];

    // LEFT JOIN (rather than the previous INNER JOIN) so a loaned-in user with
    // no `user_departments` row still survives to the WHERE clause; the OR
    // branch is what actually admits them. `inClause` throws on an empty list,
    // so it is only reached when there is something to include.
    const loanedInCondition =
      loanedInUserIds.length > 0
        ? `(ud.department_id IS NOT NULL OR u.id IN (${inClause(loanedInUserIds)}))`
        : `ud.department_id IS NOT NULL`;
    const [empRows] = await this.pool.execute<RowDataPacket[]>(
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

    // Working-time limits come from the employee's CONTRACT, effective over
    // the schedule's period — not from user_preferences, where they used to
    // live beside genuine preferences with no validity period at all. A person
    // moving to part-time overwrote the old value, so a schedule generated
    // before the change appeared to violate a limit that did not apply when it
    // ran. Users with no contract keep the historical defaults, so an
    // installation that has not set contracts up behaves exactly as before.
    // Commitments on THIS schedule: assignments a previous run published and
    // people have been told about. The optimizer plans AROUND them rather than
    // reconsidering them, and the diff below reports any it had to break.
    const [pinnedRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT sa.user_id, sa.shift_id
         FROM shift_assignments sa
         JOIN shifts s ON s.id = sa.shift_id
        WHERE s.schedule_id = ?
          AND sa.is_pinned = 1
          AND sa.status IN ('pending', 'confirmed')`,
      [scheduleId]
    );
    const pinned = pinnedRows.map((r) => ({
      employee_id: String(r.user_id),
      shift_id: String(r.shift_id),
    }));

    // Pairing rules constraining who may share a shift. Read for the whole
    // department's staff rather than per shift: the rules are about people,
    // and the engine applies them to every shift it considers.
    const [pairingRows] = await this.pool.execute<RowDataPacket[]>(
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
    const pairings = pairingRows.map((r) => ({
      employee_id: String(r.user_id),
      other_id: String(r.other_user_id),
      kind: r.kind as 'apart' | 'requires',
    }));

    // Equity history: category days worked in the window BEFORE this period,
    // from PUBLISHED schedules only — a draft is not what happened, and a
    // draft's weekends would follow someone into the next month having never
    // been worked.
    //
    // Read for the same candidates the solver is choosing between, since the
    // deviation is measured against their average.
    const employeeIds = empRows.map((e) => e.id as number);
    const [historyRows] = employeeIds.length === 0
      ? [[] as RowDataPacket[]]
      : await this.pool.execute<RowDataPacket[]>(
          `SELECT sa.user_id, s.date, s.start_time, s.end_time
             FROM shift_assignments sa
             JOIN shifts s ON s.id = sa.shift_id
             JOIN schedules sc ON sc.id = s.schedule_id
            WHERE sc.status = 'published'
              AND sc.id != ?
              AND sa.status IN ('pending', 'confirmed')
              AND sa.user_id IN (${inClause(employeeIds)})
              AND s.date >= DATE_SUB(?, INTERVAL ${EQUITY_HORIZON_DAYS} DAY)
              AND s.date < ?`,
          [scheduleId, schedule.start_date, schedule.start_date]
        );
    const carried = carriedLoads(
      historyRows.map((r) => ({
        userId: r.user_id as number,
        date: DateUtils.toDateString(r.date as string | Date),
        startTime: r.start_time as string,
        endTime: r.end_time as string,
      })),
      employeeIds
    );

    // Rotation streak: how many consecutive PUBLISHED predecessor periods
    // each employee already held a category, walked separately from the
    // equity horizon above — a count of periods rather than a deviation over
    // a fixed date window, so it needs its own predecessor-chain walk.
    const rotationHistory = await this.consecutiveCategoryPeriods(scheduleId, schedule, employeeIds);

    const contracts = new EmploymentContractService(this.pool);
    const contractLimits = await contracts.resolveLimitsForPeriod(
      empRows.map((e) => e.id as number),
      String(schedule.start_date).slice(0, 10),
      String(schedule.end_date).slice(0, 10)
    );

    // Filtered against `employeeIds`, not a fresh `user_departments` lookup —
    // that set already includes anyone admitted via a loan above, and a
    // loaned-in person's unavailability has to count exactly like a
    // permanent member's.
    const [unavailRows] = employeeIds.length === 0
      ? [[] as RowDataPacket[]]
      : await this.pool.execute<RowDataPacket[]>(
          `SELECT user_id, start_date, end_date FROM user_unavailability
            WHERE user_id IN (${inClause(employeeIds)})`
        );
    const unavailableByUser = new Map<number, string[]>();
    for (const row of unavailRows) {
      const dates: string[] = [];
      const start = new Date(row.start_date as Date);
      const end = new Date(row.end_date as Date);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        dates.push(DateUtils.fromMySQLDate(d));
      }
      const userId = row.user_id as number;
      const existing = unavailableByUser.get(userId) || [];
      unavailableByUser.set(userId, [...existing, ...dates]);
    }

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
    // Same reasoning as `unavailRows`: `employeeIds` is the actual candidate
    // set (department members plus loaned-in staff), not a fresh
    // `user_departments`-only lookup.
    const [externalRows] = employeeIds.length === 0
      ? [[] as RowDataPacket[]]
      : await this.pool.execute<RowDataPacket[]>(
          `SELECT sa.user_id, s.date, s.start_time, s.end_time
             FROM shift_assignments sa
             JOIN shifts s ON s.id = sa.shift_id
             JOIN schedules sc ON sc.id = s.schedule_id
            WHERE s.schedule_id != ?
              AND (sc.status = 'published' OR sc.id = ?)
              AND sa.status IN ('pending', 'confirmed')
              AND sa.user_id IN (${inClause(employeeIds)})
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
    const externalAssignmentsByUser = new Map<number, Array<{ date: string; start_time: string; end_time: string }>>();
    for (const row of externalRows) {
      const userId = row.user_id as number;
      const list = externalAssignmentsByUser.get(userId) ?? [];
      list.push({ date: DateUtils.toDateString(row.date as string | Date), start_time: row.start_time as string, end_time: row.end_time as string });
      externalAssignmentsByUser.set(userId, list);
    }

    // 3. Build problem and run greedy.
    const optimizer = new ScheduleOptimizer();
    const problem = {
      shifts: shiftRows.map((s) => ({
        id: String(s.id),
        date: DateUtils.toDateString(s.date as string | Date),
        start_time: s.start_time as string,
        end_time: s.end_time as string,
        min_staff: s.min_staff as number,
        max_staff: s.max_staff as number,
        required_skills: (s.skill_names as string | null)?.split(',').filter(Boolean) ?? [],
        required_skill_levels: parseSkillLevels(s.skill_levels as string | null),
        qualified_staff: parseQualifiedStaff(s.qualified_staff as string | null),
        priority: 1,
      })),
      employees: empRows.map((e) => {
        const limits = contractLimits.get(e.id as number);
        return {
        id: String(e.id),
        max_hours_per_week: limits?.maxHoursPerWeek ?? (e.max_hours_per_week as number),
        min_hours_per_week: limits?.minHoursPerWeek ?? (e.min_hours_per_week as number),
        max_consecutive_days: limits?.maxConsecutiveDays ?? (e.max_consecutive_days as number),
        // Absent when no contract sets one; the engines then fall back to the
        // historical derived formula rather than leaving the day uncapped.
        max_hours_per_day: limits?.maxHoursPerDay ?? undefined,
        min_consecutive_days_off: limits?.minConsecutiveDaysOff ?? undefined,
        min_days_off_per_period: limits?.minDaysOffPerPeriod ?? undefined,
        // Steers the solver's search only — see the field's own doc comment
        // in optimization/types.ts for why this must never reach a log line
        // or an API response.
        hourly_rate: e.hourly_rate != null ? Number(e.hourly_rate) : undefined,
        skills: (e.skill_names as string | null)?.split(',').filter(Boolean) ?? [],
        skill_levels: parseSkillLevels(e.skill_levels as string | null),
        unavailable_dates: unavailableByUser.get(e.id as number) ?? [],
        existing_assignments: externalAssignmentsByUser.get(e.id as number) ?? [],
        carried_load: carried.get(e.id as number),
        consecutive_category_periods: rotationHistory.get(e.id as number),
        };
      }),
      pinned_assignments: pinned,
      pairings,
      preferences: [],
      constraints: {
        max_hours_per_week: 40,
        max_consecutive_days: 5,
        min_hours_between_shifts: 8,
      },
    };

    // Engine selection. Default 'or-tools' attempts the optimum first; any
    // fall back to greedy is surfaced (engine/degraded), never silent. An
    // explicit 'greedy'/'javascript' selection is an intentional draft and
    // skips the child-process round-trip entirely.
    let engine: 'or-tools' | 'greedy';
    let degraded = false;
    let degradedReason: string | undefined;
    let assignments;

    if (config.optimization.engine === 'or-tools') {
      const result = await optimizer.optimize(problem as never);
      assignments = result.assignments;
      if (result.status === 'GREEDY_FALLBACK' || result.status === 'ERROR') {
        // optimize() already ran the greedy fallback internally; make that
        // visible instead of pretending or-tools produced the schedule.
        engine = 'greedy';
        degraded = true;
        degradedReason =
          result.error ?? 'OR-Tools solver was unavailable; used the greedy fallback';
        logger.warn(
          `Optimization for schedule=${scheduleId} requested or-tools but degraded to greedy: ${degradedReason}`
        );
      } else {
        engine = 'or-tools';
      }
    } else {
      // Explicit draft mode — greedy chosen on purpose, not a degradation.
      assignments = await optimizer.generateGreedySchedule(problem as never);
      engine = 'greedy';
      logger.info(`Optimization for schedule=${scheduleId} using greedy draft engine (explicit)`);
    }

    // 4. Persist assignments.
    //
    // Written as chunked multi-row INSERTs rather than one statement per
    // assignment: a month-long schedule produces hundreds to thousands of rows,
    // and a per-row round-trip held an open transaction (and a pooled
    // connection, shared with request traffic) for the whole time. Chunking
    // keeps each statement well under max_allowed_packet.
    //
    // `inserted` now comes from affectedRows, not a manual counter. INSERT
    // IGNORE skips rows that violate the unique (shift_id, user_id) constraint,
    // so counting attempts overstated the result whenever the optimizer
    // re-proposed an assignment that already existed — the reported coverage was
    // wrong in exactly the case where it mattered (a re-run).
    // The DIFF is the deliverable, not the schedule.
    //
    // A planner approving a re-solve needs to know what CHANGED for whom, not
    // to re-read a whole month. And every broken commitment is someone who was
    // told they were working and now is not — the one thing a re-solve must
    // never do silently. `kept` is reported too, because "nothing moved" is
    // exactly the answer a re-run on unchanged inputs should give, and an empty
    // diff is indistinguishable from a diff that was never computed.
    const proposed = new Set(assignments.map((a) => `${a.employeeId}:${a.shiftId}`));
    const brokenCommitments = pinned
      .filter((p) => !proposed.has(`${p.employee_id}:${p.shift_id}`))
      .map((p) => ({ userId: Number(p.employee_id), shiftId: Number(p.shift_id) }));
    const keptCommitments = pinned.length - brokenCommitments.length;
    if (brokenCommitments.length > 0) {
      logger.warn(
        `Optimization for schedule=${scheduleId} broke ${brokenCommitments.length} published ` +
          `commitment(s); affected users: ${[...new Set(brokenCommitments.map((b) => b.userId))].join(', ')}`
      );
    }

    // A PUBLISHED schedule is not re-planned in place; it is PROPOSED.
    //
    // Applying first and reporting afterwards inverts the decision: the change
    // to people's commitments has already happened by the time the planner can
    // judge whether it was worth making. For a draft that is right — nobody
    // has been told anything — so drafts keep the immediate path.
    //
    // Nothing is written to `shift_assignments` here. The proposal carries the
    // whole solved set, and approving it is what writes and removes rows; see
    // `ReplanProposalService` for why verify-at-apply beat re-solving at
    // approval time.
    if (schedule.status === 'published') {
      const proposal = await new ReplanProposalService(this.pool).propose({
        scheduleId,
        proposedBy: createdBy,
        engine,
        payload: {
          assignments: assignments.map((a) => ({
            shiftId: Number(a.shiftId),
            userId: Number(a.employeeId),
          })),
          brokenCommitments,
          keptCommitments,
          totalShifts: shiftRows.length,
        },
      });
      return {
        scheduleId,
        // Nothing was created: this run proposed. Reporting the proposed count
        // here would say work happened that has not.
        assignmentsCreated: 0,
        totalShifts: shiftRows.length,
        coveragePercentage: 0,
        status: 'PROPOSED',
        proposalId: proposal.id,
        proposedAssignments: proposal.payload.assignments.length,
        engine,
        degraded,
        degradedReason,
        keptCommitments,
        brokenCommitments,
      };
    }

    const INSERT_CHUNK_SIZE = 500;
    const conn = await this.pool.getConnection();
    let inserted = 0;
    try {
      await conn.beginTransaction();
      for (let i = 0; i < assignments.length; i += INSERT_CHUNK_SIZE) {
        const chunk = assignments.slice(i, i + INSERT_CHUNK_SIZE);
        const placeholders = chunk.map(() => '(?, ?, ?, ?)').join(', ');
        const values = chunk.flatMap((a) => [
          Number(a.shiftId),
          Number(a.employeeId),
          'pending',
          createdBy,
        ]);
        const [result] = await conn.execute<ResultSetHeader>(
          `INSERT IGNORE INTO shift_assignments (shift_id, user_id, status, assigned_by)
           VALUES ${placeholders}`,
          values
        );
        inserted += result.affectedRows;
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    const totalShifts = shiftRows.length;
    const coverage =
      totalShifts > 0 ? Math.min(100, Math.round((inserted / totalShifts) * 100)) : 0;
    logger.info(
      `Auto-schedule done for schedule=${scheduleId}: ${inserted}/${totalShifts} (${coverage}%)`
    );
    return {
      scheduleId,
      assignmentsCreated: inserted,
      totalShifts,
      coveragePercentage: coverage,
      status: 'OK',
      engine,
      degraded,
      degradedReason,
      keptCommitments,
      brokenCommitments,
    };
  }
}
