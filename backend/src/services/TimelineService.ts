/**
 * The timeline: lanes, bars, and a scope — the data behind a Gantt view.
 *
 * WHY THIS IS NOT "THE SCHEDULE, DRAWN". The obvious build is a view that
 * renders `shifts` on a time axis, and it would have to be rewritten the first
 * time anything else needs the same picture. A hospital wants its operating
 * theatres on a timeline; the lane there is a room and the bar is a procedure,
 * and none of that is a shift. So the model is deliberately smaller than
 * scheduling:
 *
 *   lane  — something time is booked against (a person, later a room)
 *   bar   — a half-open interval [start, end) on one lane, with a label
 *   scope — a date range and the org units the caller may see
 *
 * Everything else — colour, grouping, zoom — is presentation.
 *
 * WHY TWO SOURCES AND NOT ONE. An abstraction with a single implementation is
 * an indirection, not an abstraction: it encodes whatever its one caller
 * happens to need and breaks on the second. Shifts and on-call periods are
 * both already in the schema, are genuinely different in shape (an on-call
 * period is not worked, it is held), and overlap in time — which is itself the
 * thing a planner wants to see. Inventing a third from a domain that does not
 * exist would be the opposite mistake, and is why operating theatres are NOT
 * implemented here: there is no room, procedure or equipment entity to draw.
 *
 * WHY EACH SOURCE DECLARES ITS OWN SCOPING. "Which org unit does this bar
 * belong to" has a different answer for a person and for a room, so a single
 * filter applied downstream would be wrong the moment a lane stops being an
 * employee. Each source restricts inside its own query; nothing is filtered
 * after the fact, so a row the caller may not see is never read.
 *
 * WHAT IS PROJECTED, AND WHAT IS NOT. Name, activity, start, end. Never pay,
 * never the reason for an absence, never assignment notes. Absences are absent
 * from the timeline entirely: showing who is away on the days it covers makes
 * leave and sickness deducible, which is exactly the inference the narrow
 * projection exists to prevent. The columns are listed explicitly rather than
 * selected and trimmed, so a column added to `users` later cannot appear here
 * by omission.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket } from 'mysql2/promise';
import { ValidationError } from '../errors';
import { DateUtils } from '../utils';
import { shiftBoundsMs } from '../optimization/shiftTime';
import { inClause } from '../utils/sql';

export interface TimelineLane {
  id: string;
  label: string;
  /** What the lane is. Only `employee` exists today; see the header. */
  kind: 'employee';
}

export interface TimelineBar {
  laneId: string;
  /** Absolute ISO instants, so an overnight bar is one interval and not two. */
  start: string;
  end: string;
  label: string;
  source: string;
  status: string;
}

export interface Timeline {
  from: string;
  to: string;
  lanes: TimelineLane[];
  bars: TimelineBar[];
  /** Sources that produced this timeline, so a client can label its legend. */
  sources: string[];
}

export interface TimelineScope {
  from: string;
  to: string;
  /** `null` means unrestricted — the caller holds `timeline.read_all`. */
  orgUnitIds: number[] | null;
  sources?: string[];
}

interface SourceRow extends RowDataPacket {
  user_id: number;
  user_name: string;
  date: unknown;
  start_time: string;
  end_time: string;
  label: string;
  status: string;
}

interface TimelineSource {
  key: string;
  /**
   * `orgUnitIds` is `null` for an unrestricted caller and a non-empty list
   * otherwise; an empty scope never reaches here (the caller short-circuits),
   * because `IN ()` is a syntax error rather than an empty result.
   */
  fetch(pool: Pool, from: string, to: string, orgUnitIds: number[] | null): Promise<SourceRow[]>;
}

const scopeClause = (orgUnitIds: number[] | null): string =>
  orgUnitIds === null ? '' : ` AND d.org_unit_id IN (${inClause(orgUnitIds)})`;

const SOURCES: TimelineSource[] = [
  {
    key: 'shifts',
    async fetch(pool, from, to, orgUnitIds) {
      const [rows] = await pool.execute<SourceRow[]>(
        `SELECT sa.user_id,
                CONCAT(u.first_name, ' ', u.last_name) AS user_name,
                s.date, s.start_time, s.end_time,
                d.name AS label,
                sa.status
           FROM shift_assignments sa
           JOIN shifts s ON s.id = sa.shift_id
           JOIN departments d ON d.id = s.department_id
           JOIN users u ON u.id = sa.user_id
          WHERE sa.status IN ('pending', 'confirmed', 'completed')
            AND s.date BETWEEN ? AND ?${scopeClause(orgUnitIds)}
          ORDER BY s.date, s.start_time`,
        [from, to]
      );
      return rows;
    },
  },
  {
    key: 'on-call',
    async fetch(pool, from, to, orgUnitIds) {
      const [rows] = await pool.execute<SourceRow[]>(
        `SELECT oca.user_id,
                CONCAT(u.first_name, ' ', u.last_name) AS user_name,
                ocp.date, ocp.start_time, ocp.end_time,
                CONCAT('On call — ', d.name) AS label,
                oca.status
           FROM on_call_assignments oca
           JOIN on_call_periods ocp ON ocp.id = oca.period_id
           JOIN departments d ON d.id = ocp.department_id
           JOIN users u ON u.id = oca.user_id
          WHERE oca.status IN ('pending', 'confirmed')
            AND ocp.date BETWEEN ? AND ?${scopeClause(orgUnitIds)}
          ORDER BY ocp.date, ocp.start_time`,
        [from, to]
      );
      return rows;
    },
  },
];

export const TIMELINE_SOURCE_KEYS = SOURCES.map((s) => s.key);

/** Longest span a single request may ask for. */
const MAX_RANGE_DAYS = 92;

export class TimelineService {
  constructor(private pool: Pool) {}

  async build(scope: TimelineScope): Promise<Timeline> {
    const span = (Date.parse(`${scope.to}T00:00:00Z`) - Date.parse(`${scope.from}T00:00:00Z`)) / 86_400_000;
    if (span < 0) throw new ValidationError('The range ends before it starts');
    if (span > MAX_RANGE_DAYS) {
      // A quarter is the longest view anyone reads at once, and the bound is
      // here rather than in the schema because it is about how much work the
      // query does, not about what a valid date range is.
      throw new ValidationError(`A timeline may span at most ${MAX_RANGE_DAYS} days`);
    }

    const requested = scope.sources ?? TIMELINE_SOURCE_KEYS;
    const unknown = requested.filter((k) => !TIMELINE_SOURCE_KEYS.includes(k));
    if (unknown.length > 0) {
      throw new ValidationError(`Unknown timeline source: ${unknown.join(', ')}`);
    }
    const active = SOURCES.filter((s) => requested.includes(s.key));

    // An empty scope is "nothing visible", which is a legitimate answer for
    // someone attached to no org unit — and must not become an unrestricted
    // query by way of an `IN ()` that is a syntax error anyway.
    if (scope.orgUnitIds !== null && scope.orgUnitIds.length === 0) {
      return { from: scope.from, to: scope.to, lanes: [], bars: [], sources: requested };
    }

    const results = await Promise.all(
      active.map((s) => s.fetch(this.pool, scope.from, scope.to, scope.orgUnitIds))
    );

    const lanes = new Map<string, TimelineLane>();
    const bars: TimelineBar[] = [];
    active.forEach((source, i) => {
      for (const row of results[i]) {
        const laneId = String(row.user_id);
        if (!lanes.has(laneId)) {
          lanes.set(laneId, { id: laneId, label: row.user_name, kind: 'employee' });
        }
        const date = DateUtils.toDateString(row.date as string | Date);
        // Absolute instants via the shared overnight arithmetic: a 22:00–06:00
        // bar must be one interval ending the next morning, not one that ends
        // before it begins. Re-deriving that here would be a fifth copy of a
        // rule that has produced two defects already.
        const [start, end] = shiftBoundsMs({ date, start_time: row.start_time, end_time: row.end_time });
        bars.push({
          laneId,
          start: new Date(start).toISOString(),
          end: new Date(end).toISOString(),
          label: row.label,
          source: source.key,
          status: row.status,
        });
      }
    });

    return {
      from: scope.from,
      to: scope.to,
      // Sorted by name so the vertical order is stable between requests; an
      // order that follows whichever rows came back first makes the whole
      // chart appear to move when one assignment changes.
      lanes: [...lanes.values()].sort((a, b) => a.label.localeCompare(b.label)),
      bars,
      sources: requested,
    };
  }
}
