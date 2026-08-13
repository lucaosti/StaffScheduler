/**
 * Dashboard aggregates: the summary counters and the attention shortlist.
 *
 * WHY THIS EXISTS. These queries lived in `routes/dashboard.ts`, which was the
 * only router in the codebase owning SQL — 380 of its 456 lines were statements
 * and result shaping, and it had rebuilt a private `queryOne`/`queryAll` pair to
 * run them. Nothing here is HTTP-shaped, so nothing here needed an Express app
 * to be exercised; it simply had nowhere else to live. The route now does what
 * every other route does: validate, call one method, return JSON.
 *
 * Authorization is decided by the caller and passed in, not read from a request
 * here: `canSeeCost` and the visible org-unit scope are the two facts these
 * aggregates need, and taking them as arguments keeps the permission decision
 * where the middleware already made it.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket } from 'mysql2/promise';
import { SHIFT_HOURS_SQL, inClause } from '../utils/sql';
import { DateUtils } from '../utils';
import { PendingApprovalService } from './PendingApprovalService';

/**
 * Sargable month window: [first day of current month, first day of next month).
 * Keeps idx_date usable, unlike MONTH(...)/YEAR(...) predicates.
 */
const MONTH_WINDOW = `s.date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
        AND s.date < DATE_FORMAT(CURDATE() + INTERVAL 1 MONTH, '%Y-%m-01')`;

/**
 * How far ahead an understaffed shift is worth flagging — long enough to act on
 * (swap it, post it to the open board, escalate it) before it happens, short
 * enough that the list stays a short, actionable read.
 */
const ATTENTION_WINDOW_DAYS = 14;

/**
 * Cap on the item lists inside the attention shortlist — this is a glance, not
 * a report; /api/reports and /api/shifts are where the full picture lives.
 */
const MAX_ATTENTION_ITEMS = 20;

const AGE_BUCKET_HOURS = { day: 24, twoDays: 48, week: 24 * 7 } as const;

export interface DashboardStats {
  totalEmployees: number;
  activeSchedules: number;
  todayShifts: number;
  pendingApprovals: number;
  monthlyHours: number;
  /** Null for callers without `report.read`: it derives from hourly rates. */
  monthlyCost: number | null;
  /** The admin-set target for the month, under the same gate as `monthlyCost`. */
  monthlyCostPlan: number | null;
  coverageRate: number;
  employeeSatisfaction: number;
}

export interface AttentionItems {
  understaffedShifts: {
    count: number;
    truncated: boolean;
    items: Array<{
      id: number;
      date: string;
      startTime: string;
      endTime: string;
      departmentName: string;
      assignedStaff: number;
      minStaff: number;
    }>;
  };
  pendingApprovalsAging: {
    count: number;
    overDay: number;
    overTwoDays: number;
    overWeek: number;
    items: Array<{ id: number; changeType: string; createdAt: string; ageHours: number }>;
  };
}

export class DashboardService {
  constructor(private pool: Pool) {}

  private async rows<T>(sql: string): Promise<T[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(sql);
    return rows as T[];
  }

  private async one<T>(sql: string): Promise<T | null> {
    const rows = await this.rows<T>(sql);
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * The summary counters.
   *
   * `canSeeCost` gates the two money figures: labor cost derives from hourly
   * rates, and the plan target is the other half of the same comparison, so
   * they carry one gate between them and are reported as null — not zero —
   * when it is closed. A zero would be a claim about the data rather than
   * about what this caller may see.
   */
  async getStats(canSeeCost: boolean): Promise<DashboardStats> {
    // Every active user is schedulable staff, so the headcount is the count of
    // active users.
    const totalEmployeesQuery = 'SELECT COUNT(*) as count FROM users WHERE is_active = TRUE';

    const activeSchedulesQuery =
      'SELECT COUNT(*) as count FROM schedules WHERE status = "published"';

    const todayShiftsQuery = `
        SELECT COUNT(*) as count
        FROM shifts
        WHERE date = CURDATE() AND status IN ('open', 'assigned', 'confirmed')
      `;

    const pendingApprovalsQuery = `
        SELECT COUNT(*) as count
        FROM shift_assignments
        WHERE status = 'pending'
      `;

    const monthlyHoursQuery = `
        SELECT COALESCE(SUM(${SHIFT_HOURS_SQL}), 0) as total_hours
        FROM shift_assignments sa
        JOIN shifts s ON sa.shift_id = s.id
        WHERE ${MONTH_WINDOW}
          AND sa.status = 'confirmed'
      `;

    const monthlyCostQuery = `
        SELECT COALESCE(SUM(${SHIFT_HOURS_SQL} * u.hourly_rate), 0) as total_cost
        FROM shift_assignments sa
        JOIN shifts s ON sa.shift_id = s.id
        JOIN users u ON sa.user_id = u.id
        WHERE ${MONTH_WINDOW}
          AND sa.status = 'confirmed'
      `;

    // The other half of the cost comparison: every admin-set target whose
    // period overlaps the current month, summed across departments. Same
    // overlap test a plan's own period would use to answer "does this apply to
    // now" — LAST_DAY/DATE_FORMAT mirror MONTH_WINDOW's own sargable month
    // bounds rather than introducing a second style.
    const monthlyCostPlanQuery = `
        SELECT COALESCE(SUM(target_amount), 0) as total_target
        FROM cost_plans
        WHERE start_date <= LAST_DAY(CURDATE())
          AND end_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
      `;

    const coverageQuery = `
        SELECT
          COUNT(DISTINCT s.id) as total_shifts,
          COUNT(DISTINCT CASE WHEN sa.id IS NOT NULL THEN s.id END) as covered_shifts
        FROM shifts s
        LEFT JOIN shift_assignments sa ON s.id = sa.shift_id AND sa.status = 'confirmed'
        WHERE ${MONTH_WINDOW}
      `;

    // Preference-match satisfaction: ratio of this month's assignments where
    // the assigned shift appears in the employee's preferred_shifts list.
    const satisfactionQuery = `
        SELECT
          COUNT(*) AS total_assignments,
          SUM(
            CASE
              WHEN up.preferred_shifts IS NOT NULL
                AND JSON_LENGTH(up.preferred_shifts) > 0
                AND JSON_CONTAINS(up.preferred_shifts, CAST(sa.shift_id AS JSON))
              THEN 1 ELSE 0
            END
          ) AS preferred_assignments
        FROM shift_assignments sa
        JOIN shifts s ON sa.shift_id = s.id
        LEFT JOIN user_preferences up ON up.user_id = sa.user_id
        WHERE ${MONTH_WINDOW}
          AND sa.status IN ('confirmed', 'completed')
      `;

    // The aggregates are independent, so run them concurrently.
    const [
      totalEmployees,
      activeSchedules,
      todayShifts,
      pendingApprovals,
      monthlyHoursResult,
      monthlyCostResult,
      monthlyCostPlanResult,
      coverageResult,
      satisfactionResult,
    ] = await Promise.all([
      this.one<{ count: number }>(totalEmployeesQuery),
      this.one<{ count: number }>(activeSchedulesQuery),
      this.one<{ count: number }>(todayShiftsQuery),
      this.one<{ count: number }>(pendingApprovalsQuery),
      this.one<{ total_hours: number }>(monthlyHoursQuery),
      canSeeCost ? this.one<{ total_cost: number }>(monthlyCostQuery) : null,
      canSeeCost ? this.one<{ total_target: number }>(monthlyCostPlanQuery) : null,
      this.one<{ total_shifts: number; covered_shifts: number }>(coverageQuery),
      this.one<{ total_assignments: number; preferred_assignments: number }>(satisfactionQuery),
    ]);

    const ratio = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);
    const round = (value: number, places: number) => {
      const factor = 10 ** places;
      return Math.round(value * factor) / factor;
    };

    return {
      totalEmployees: totalEmployees?.count || 0,
      activeSchedules: activeSchedules?.count || 0,
      todayShifts: todayShifts?.count || 0,
      pendingApprovals: pendingApprovals?.count || 0,
      monthlyHours: Math.round(monthlyHoursResult?.total_hours || 0),
      monthlyCost: canSeeCost ? round(monthlyCostResult?.total_cost || 0, 2) : null,
      monthlyCostPlan: canSeeCost ? round(monthlyCostPlanResult?.total_target || 0, 2) : null,
      coverageRate: round(
        ratio(coverageResult?.covered_shifts ?? 0, coverageResult?.total_shifts ?? 0),
        1
      ),
      employeeSatisfaction: round(
        ratio(
          satisfactionResult?.preferred_assignments ?? 0,
          satisfactionResult?.total_assignments ?? 0
        ),
        1
      ),
    };
  }

  /**
   * Understaffed shifts coming up, and this caller's own pending approvals
   * sorted by how long they have been waiting. Both are a SHORTLIST, not a
   * report — capped, and pointing at the endpoint that has the whole picture
   * rather than trying to be it.
   *
   * `visibleOrgUnitIds` is null for a caller who may see everything, and
   * otherwise the org units they belong to. An EMPTY (non-null) list means the
   * caller belongs to no org unit at all — visible to nobody, not "unfiltered"
   * — so the shift query is skipped rather than asked to match `IN ()`, which
   * is invalid SQL.
   *
   * Pending-approval aging needs no separate scoping:
   * `PendingApprovalService.listForUser` already answers "assigned to this
   * person, or their structure", which is exactly the right set here.
   */
  async getAttentionItems(
    userId: number,
    visibleOrgUnitIds: number[] | null
  ): Promise<AttentionItems> {
    const understaffedRows =
      visibleOrgUnitIds !== null && visibleOrgUnitIds.length === 0
        ? []
        : await this.rows<{
            id: number;
            date: string;
            start_time: string;
            end_time: string;
            min_staff: number;
            assigned_staff: number;
            department_name: string;
          }>(`
            SELECT s.id, s.date, s.start_time, s.end_time, s.min_staff,
                   d.name AS department_name,
                   COUNT(DISTINCT sa.id) AS assigned_staff
              FROM shifts s
              JOIN departments d ON d.id = s.department_id
              LEFT JOIN shift_assignments sa
                ON sa.shift_id = s.id AND sa.status IN ('pending', 'confirmed')
             WHERE s.date >= CURDATE()
               AND s.date <= DATE_ADD(CURDATE(), INTERVAL ${ATTENTION_WINDOW_DAYS} DAY)
               AND s.status IN ('open', 'assigned', 'confirmed')
               ${visibleOrgUnitIds !== null ? `AND d.org_unit_id IN (${inClause(visibleOrgUnitIds)})` : ''}
             GROUP BY s.id, s.date, s.start_time, s.end_time, s.min_staff, d.name
            HAVING assigned_staff < s.min_staff
             ORDER BY s.date ASC, s.start_time ASC
             LIMIT ${MAX_ATTENTION_ITEMS + 1}
          `);

    const pending = await new PendingApprovalService(this.pool).listForUser(userId, 'pending');
    const now = Date.now();
    const ageHours = (createdAt: string) => (now - new Date(createdAt).getTime()) / (1000 * 60 * 60);
    const oldestFirst = [...pending].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    return {
      understaffedShifts: {
        count: understaffedRows.length,
        truncated: understaffedRows.length > MAX_ATTENTION_ITEMS,
        items: understaffedRows.slice(0, MAX_ATTENTION_ITEMS).map((row) => ({
          id: row.id,
          date: DateUtils.toDateString(row.date),
          startTime: row.start_time,
          endTime: row.end_time,
          departmentName: row.department_name,
          assignedStaff: row.assigned_staff,
          minStaff: row.min_staff,
        })),
      },
      pendingApprovalsAging: {
        count: pending.length,
        overDay: pending.filter((p) => ageHours(p.createdAt) >= AGE_BUCKET_HOURS.day).length,
        overTwoDays: pending.filter((p) => ageHours(p.createdAt) >= AGE_BUCKET_HOURS.twoDays).length,
        overWeek: pending.filter((p) => ageHours(p.createdAt) >= AGE_BUCKET_HOURS.week).length,
        items: oldestFirst.slice(0, MAX_ATTENTION_ITEMS).map((p) => ({
          id: p.id,
          changeType: p.changeType,
          createdAt: p.createdAt,
          ageHours: Math.round(ageHours(p.createdAt)),
        })),
      },
    };
  }
}
