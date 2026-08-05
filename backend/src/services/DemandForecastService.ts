/**
 * Seasonal-baseline staffing suggestions for the schedule editor.
 *
 * WHY A STATISTICAL BASELINE AND NOT A MODEL. The suggestion is "how many
 * people actually worked this department at this weekday and time window,
 * on average, in the recent past" — no ML, no trend fitting. That is enough
 * to catch a planner typing a `min_staff` that is wildly out of line with
 * what the department has always needed, and it is auditable in a way a
 * model would not be: the number the caller sees is a plain average the
 * caller can go verify against `shift_assignments` itself.
 *
 * HISTORICAL QUERY DESIGN mirrors `AutoScheduleService`'s equity-history
 * read: published schedules only, bounded by a named lookback horizon.
 *
 *   - PUBLISHED SCHEDULES ONLY. A draft is a candidate, not what happened —
 *     including it would let a rejected draft's staffing levels pollute the
 *     suggestion for what actually happens on that weekday.
 *   - A BOUNDED LOOKBACK HORIZON (`FORECAST_LOOKBACK_WEEKS`), not unbounded
 *     history, so a department's staffing five years ago (before it
 *     restructured, before a shift pattern changed) does not silently drag
 *     down what is suggested today.
 *
 * MATCHING KEY: department + exact start/end time, not `shift_templates.id`.
 * A shift keeps its `template_id` after generation, but the same template can
 * be edited (or a shift created ad hoc, with no template at all), so matching
 * on the template id would either miss ad-hoc shifts entirely or silently
 * conflate two different time windows once a template's hours change under
 * it. Matching on the department and the literal start/end time the caller is
 * asking about is the shape that stays correct across both.
 *
 * WEEKDAY MATCHING uses `DAYOFWEEK(s.date) = DAYOFWEEK(?)` rather than
 * computing the weekday in TypeScript and passing an index: MySQL's
 * `DAYOFWEEK` and JavaScript's `Date#getDay` do not agree on which end of the
 * week is `1`/`0`, and reconstructing that mapping is exactly the kind of
 * off-by-one this avoids by asking the database to compare two dates the same
 * way on both sides of the `=`.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket } from 'mysql2/promise';

/**
 * How far back historical shifts are read, in weeks.
 *
 * A CHOSEN number, not a derived one. Twelve weeks covers a full quarter of
 * seasonal pattern (enough occurrences of a weekly-recurring shift to average
 * meaningfully) while staying short enough that a department's staffing from
 * before a known restructure does not linger in the suggestion indefinitely.
 */
export const FORECAST_LOOKBACK_WEEKS = 12;

/**
 * Minimum staffing suggested when there is no historical data to average at
 * all (`basedOnOccurrences === 0` and no matching template either). Not
 * zero: a shift with `min_staff = 0` needs nobody, which is never what an
 * empty history means — it means the caller does not yet have evidence, and
 * one is the smallest honest placeholder that still staffs the shift.
 */
const NO_HISTORY_FALLBACK_MIN_STAFF = 1;

export interface StaffingSuggestionInput {
  departmentId: number;
  /** The date the suggestion is FOR — history is read strictly before it. */
  date: string;
  startTime: string;
  endTime: string;
}

export interface StaffingSuggestion {
  /** The number to pre-fill/hint in the editor. Always >= 1. */
  suggestedMinStaff: number;
  /**
   * How many past shift-dates the average is based on. Zero means the number
   * above is a fallback, not a measurement — callers should present it with
   * visibly lower confidence (or none) when this is zero.
   */
  basedOnOccurrences: number;
  /** The lookback horizon actually applied, echoed for the caller/UI. */
  lookbackWeeks: number;
}

interface HistoricalShiftRow extends RowDataPacket {
  shift_id: number;
  staffed_count: number;
}

export class DemandForecastService {
  constructor(private pool: Pool) {}

  /**
   * Suggests a `min_staff` for a department + weekday + time window, from
   * how many people actually worked matching PUBLISHED shifts in the last
   * `FORECAST_LOOKBACK_WEEKS`.
   */
  async suggestMinStaff(input: StaffingSuggestionInput): Promise<StaffingSuggestion> {
    const [rows] = await this.pool.execute<HistoricalShiftRow[]>(
      `SELECT s.id AS shift_id,
              COUNT(DISTINCT sa.user_id) AS staffed_count
         FROM shifts s
         JOIN schedules sc ON sc.id = s.schedule_id
         LEFT JOIN shift_assignments sa
                ON sa.shift_id = s.id
               AND sa.status IN ('pending', 'confirmed')
        WHERE sc.status = 'published'
          AND s.department_id = ?
          AND s.start_time = ?
          AND s.end_time = ?
          AND DAYOFWEEK(s.date) = DAYOFWEEK(?)
          AND s.date >= DATE_SUB(?, INTERVAL ${FORECAST_LOOKBACK_WEEKS} WEEK)
          AND s.date < ?
        GROUP BY s.id`,
      [input.departmentId, input.startTime, input.endTime, input.date, input.date, input.date]
    );

    const basedOnOccurrences = rows.length;

    if (basedOnOccurrences === 0) {
      const fallback = await this.fallbackFromTemplate(input);
      return {
        suggestedMinStaff: fallback,
        basedOnOccurrences: 0,
        lookbackWeeks: FORECAST_LOOKBACK_WEEKS,
      };
    }

    const total = rows.reduce((sum, row) => sum + Number(row.staffed_count), 0);
    const average = total / basedOnOccurrences;
    // Rounded UP: under-suggesting a staffing target defeats the point of
    // suggesting one at all, and a fractional person is never a real answer.
    const suggestedMinStaff = Math.max(1, Math.ceil(average));

    return { suggestedMinStaff, basedOnOccurrences, lookbackWeeks: FORECAST_LOOKBACK_WEEKS };
  }

  /**
   * With zero historical occurrences, fall back to the matching active
   * `shift_templates` row's own `min_staff` (someone already judged what this
   * slot needs) rather than a bare constant, when one exists for this exact
   * department/time window.
   */
  private async fallbackFromTemplate(input: StaffingSuggestionInput): Promise<number> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT min_staff
         FROM shift_templates
        WHERE department_id = ?
          AND start_time = ?
          AND end_time = ?
          AND is_active = TRUE
        LIMIT 1`,
      [input.departmentId, input.startTime, input.endTime]
    );

    if (rows.length === 0) return NO_HISTORY_FALLBACK_MIN_STAFF;
    const minStaff = Number(rows[0].min_staff);
    return Number.isFinite(minStaff) && minStaff > 0 ? minStaff : NO_HISTORY_FALLBACK_MIN_STAFF;
  }
}
