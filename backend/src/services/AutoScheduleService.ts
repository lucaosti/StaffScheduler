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
import { ReplanProposalService } from './ReplanProposalService';

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

const formatDate = (raw: unknown): string =>
  typeof raw === 'string' ? raw : DateUtils.fromMySQLDate(raw as Date);

export class AutoScheduleService {
  constructor(private pool: Pool) {}

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

    // 2. Employees in the department.
    const [empRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT u.id,
              GROUP_CONCAT(DISTINCT sk.name) AS skill_names,
              GROUP_CONCAT(
                DISTINCT CONCAT(sk.name, ':', us.proficiency_level)
                ORDER BY sk.name
              ) AS skill_levels,
              COALESCE(up.max_hours_per_week, 40) AS max_hours_per_week,
              COALESCE(up.min_hours_per_week, 0)  AS min_hours_per_week,
              COALESCE(up.max_consecutive_days, 5) AS max_consecutive_days
         FROM users u
         JOIN user_departments ud ON u.id = ud.user_id
         LEFT JOIN user_skills us ON u.id = us.user_id
         LEFT JOIN skills sk ON us.skill_id = sk.id
         LEFT JOIN user_preferences up ON up.user_id = u.id
        WHERE ud.department_id = ? AND u.is_active = 1
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

    const contracts = new EmploymentContractService(this.pool);
    const contractLimits = await contracts.resolveLimitsForPeriod(
      empRows.map((e) => e.id as number),
      String(schedule.start_date).slice(0, 10),
      String(schedule.end_date).slice(0, 10)
    );

    const [unavailRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT user_id, start_date, end_date FROM user_unavailability WHERE user_id IN (
         SELECT user_id FROM user_departments WHERE department_id = ?
       )`,
      [schedule.department_id]
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
    const [externalRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT sa.user_id, s.date, s.start_time, s.end_time
         FROM shift_assignments sa
         JOIN shifts s ON s.id = sa.shift_id
         JOIN schedules sc ON sc.id = s.schedule_id
        WHERE s.schedule_id != ?
          AND (sc.status = 'published' OR sc.id = ?)
          AND sa.status IN ('pending', 'confirmed')
          AND sa.user_id IN (SELECT user_id FROM user_departments WHERE department_id = ?)
          AND s.date BETWEEN DATE_SUB(?, INTERVAL 14 DAY) AND DATE_ADD(?, INTERVAL 14 DAY)`,
      [
        scheduleId,
        // 0 matches nothing, which is what "no predecessor" has to mean here.
        // A NULL would make the comparison NULL and silently drop the whole
        // OR branch — the same result by accident rather than by intent.
        predecessorId ?? 0,
        schedule.department_id,
        schedule.start_date,
        schedule.end_date,
      ]
    );
    const externalAssignmentsByUser = new Map<number, Array<{ date: string; start_time: string; end_time: string }>>();
    for (const row of externalRows) {
      const userId = row.user_id as number;
      const list = externalAssignmentsByUser.get(userId) ?? [];
      list.push({ date: formatDate(row.date), start_time: row.start_time as string, end_time: row.end_time as string });
      externalAssignmentsByUser.set(userId, list);
    }

    // 3. Build problem and run greedy.
    const optimizer = new ScheduleOptimizer();
    const problem = {
      shifts: shiftRows.map((s) => ({
        id: String(s.id),
        date: formatDate(s.date),
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
        skills: (e.skill_names as string | null)?.split(',').filter(Boolean) ?? [],
        skill_levels: parseSkillLevels(e.skill_levels as string | null),
        unavailable_dates: unavailableByUser.get(e.id as number) ?? [],
        existing_assignments: externalAssignmentsByUser.get(e.id as number) ?? [],
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
