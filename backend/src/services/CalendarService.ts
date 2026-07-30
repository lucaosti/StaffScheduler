/**
 * Calendar service (F04).
 *
 * Generates iCalendar feeds (RFC 5545) over the database. Three flavours:
 *
 *   1. Per-user feed: a user's confirmed/pending assignments. Each VEVENT
 *      lists colleagues working the same shift in DESCRIPTION so the
 *      employee sees who they'll be on duty with.
 *   2. Per-department aggregated feed: every confirmed shift in the
 *      department. Useful for managers who want a "wall of shifts" in
 *      their personal calendar. Same auth as the per-user feed; only
 *      managers/admins of the target department resolve to a non-empty
 *      result.
 *   3. On-call (F21) periods are surfaced in both feeds with
 *      CATEGORIES:ON-CALL so calendar clients can colour them.
 *
 * Authentication uses an opaque per-user token in the subscription URL
 * (calendar clients rarely support custom headers). Token rotation
 * revokes every active subscription for that user.
 *
 * Push freshness (F04++): we emit X-PUBLISHED-TTL and REFRESH-INTERVAL
 * so clients poll roughly every 15 minutes, plus an ETag based on the
 * latest schedule.updated_at so well-behaved clients can avoid the body
 * download with a conditional request.
 *
 * @author Luca Ostinelli
 */

import { createHash, randomBytes } from 'crypto';
import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { DateUtils } from '../utils';

export interface CalendarEvent {
  uid: string;
  summary: string;
  description: string;
  start: Date;
  end: Date;
  location: string;
  /** Optional iCalendar CATEGORIES (e.g. "ON-CALL"). */
  categories?: string[];
}

interface FeedResult {
  body: string;
  etag: string;
}

const ICAL_PROD_ID = '-//Staff Scheduler//EN';
const REFRESH_INTERVAL = 'PT15M';

const escapeText = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

const formatDate = (d: Date): string =>
  d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

/** Builds RFC 5545 iCalendar text from a list of events. */
export const buildIcs = (events: CalendarEvent[], calendarName = 'Staff Scheduler'): string => {
  const now = formatDate(new Date());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${ICAL_PROD_ID}`,
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    `X-PUBLISHED-TTL:${REFRESH_INTERVAL}`,
    `REFRESH-INTERVAL;VALUE=DURATION:${REFRESH_INTERVAL}`,
  ];
  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.uid}`,
      `DTSTAMP:${now}`,
      `DTSTART:${formatDate(event.start)}`,
      `DTEND:${formatDate(event.end)}`,
      `SUMMARY:${escapeText(event.summary)}`,
      `DESCRIPTION:${escapeText(event.description)}`,
      `LOCATION:${escapeText(event.location)}`
    );
    if (event.categories && event.categories.length > 0) {
      lines.push(`CATEGORIES:${event.categories.map(escapeText).join(',')}`);
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
};

/** Builds the absolute event timestamps, accounting for overnight wrap. */
export const shiftToEventTimes = (
  date: string,
  startTime: string,
  endTime: string
): { start: Date; end: Date } => {
  const norm = (t: string): string => (t.length === 5 ? `${t}:00` : t);
  const start = new Date(`${date}T${norm(startTime)}Z`);
  let end = new Date(`${date}T${norm(endTime)}Z`);
  if (end <= start) end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
};

const computeEtag = (...parts: Array<string | number | null | undefined>): string => {
  const h = createHash('sha1');
  for (const p of parts) h.update(String(p ?? ''));
  return `"${h.digest('hex').slice(0, 16)}"`;
};


/** A feed token as its owner sees it — never including the raw value. */
export interface CalendarToken {
  id: number;
  label: string;
  createdAt: string;
  /** Non-null once revoked; the row stays so the history is visible. */
  revokedAt: string | null;
}

export class CalendarService {
  constructor(private pool: Pool) {}

  private sha256(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /**
   * A person's feed tokens, newest first, revoked ones included.
   *
   * The raw token is NEVER here: only its digest is stored, so the value is
   * available exactly once, at creation. Listing it would require keeping the
   * secret, which is the whole thing hashing avoids — a leaked database would
   * otherwise hand over every live subscription.
   */
  async listTokens(userId: number): Promise<CalendarToken[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id, label, created_at, revoked_at
         FROM calendar_tokens WHERE user_id = ? ORDER BY id DESC`,
      [userId]
    );
    return rows.map((row) => ({
      id: row.id as number,
      label: row.label as string,
      createdAt: String(row.created_at),
      revokedAt: row.revoked_at === null ? null : String(row.revoked_at),
    }));
  }

  /**
   * Issues a new token and returns its raw value, once.
   *
   * Additive: existing subscriptions keep working. The old single-token model
   * overwrote the stored hash, so adding a second device silently broke the
   * first — the defect this replaces.
   */
  async createToken(userId: number, label: string): Promise<{ id: number; token: string }> {
    const raw = randomBytes(24).toString('hex');
    const [res] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO calendar_tokens (user_id, label, token_hash) VALUES (?, ?, ?)`,
      [userId, label, this.sha256(raw)]
    );
    return { id: res.insertId, token: raw };
  }

  /**
   * Revokes one token, leaving the others alone.
   *
   * Scoped by `user_id` in the statement rather than checked beforehand: a
   * caller who guesses another person's token id must not be able to switch off
   * their calendar, and doing it in one statement leaves no window between the
   * check and the write.
   *
   * Returns false when nothing matched — an unknown id, someone else's, or one
   * already revoked — so the route can answer honestly instead of reporting a
   * revocation that did not happen.
   */
  async revokeToken(userId: number, tokenId: number): Promise<boolean> {
    const [res] = await this.pool.execute<ResultSetHeader>(
      `UPDATE calendar_tokens SET revoked_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
      [tokenId, userId]
    );
    return res.affectedRows > 0;
  }

  /**
   * The owner of a live token, or null.
   *
   * `revoked_at IS NULL` is the entire point of revocation: without it the row
   * still exists and the feed still works.
   */
  async resolveToken(token: string): Promise<number | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT user_id FROM calendar_tokens
        WHERE token_hash = ? AND revoked_at IS NULL LIMIT 1`,
      [this.sha256(token)]
    );
    return rows.length === 0 ? null : (rows[0].user_id as number);
  }

  /** Per-user feed with colleagues listed in each event description. */
  async buildUserFeed(userId: number): Promise<FeedResult> {
    const [shiftRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT sa.id AS assignment_id, sa.status,
              s.id AS shift_id, s.date, s.start_time, s.end_time, s.notes,
              sch.name AS schedule_name,
              d.name AS department_name,
              s.updated_at AS shift_updated
         FROM shift_assignments sa
         JOIN shifts s ON sa.shift_id = s.id
         JOIN schedules sch ON s.schedule_id = sch.id
         LEFT JOIN departments d ON s.department_id = d.id
        WHERE sa.user_id = ?
          AND sa.status IN ('pending', 'confirmed')
        ORDER BY s.date ASC, s.start_time ASC`,
      [userId]
    );

    const shiftIds = shiftRows.map((r) => r.shift_id as number);
    const colleaguesByShift = await this.loadColleagues(shiftIds, userId);

    const [onCallRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT a.id AS assignment_id, p.id AS period_id,
              p.date, p.start_time, p.end_time, p.notes,
              d.name AS department_name,
              p.updated_at AS period_updated
         FROM on_call_assignments a
         JOIN on_call_periods p ON a.period_id = p.id
         LEFT JOIN departments d ON p.department_id = d.id
        WHERE a.user_id = ? AND a.status IN ('pending', 'confirmed')
        ORDER BY p.date ASC, p.start_time ASC`,
      [userId]
    );

    const events: CalendarEvent[] = [];
    let latestUpdated = '';

    for (const row of shiftRows) {
      const date = DateUtils.toDateString(row.date as string | Date);
      const { start, end } = shiftToEventTimes(date, row.start_time as string, row.end_time as string);
      const colleagues = colleaguesByShift.get(row.shift_id as number) ?? [];
      const description = [
        row.notes || row.schedule_name,
        colleagues.length > 0 ? `Working with: ${colleagues.join(', ')}` : null,
      ]
        .filter(Boolean)
        .join('\n');
      events.push({
        uid: `assignment-${row.assignment_id}@staffscheduler`,
        summary: `${row.department_name ?? 'Shift'} (${row.status})`,
        description,
        start,
        end,
        location: (row.department_name as string) || '',
      });
      if ((row.shift_updated as string) > latestUpdated) latestUpdated = row.shift_updated as string;
    }

    for (const row of onCallRows) {
      const date = DateUtils.toDateString(row.date as string | Date);
      const { start, end } = shiftToEventTimes(date, row.start_time as string, row.end_time as string);
      events.push({
        uid: `oncall-${row.assignment_id}@staffscheduler`,
        summary: `${row.department_name ?? 'On-call'} (on-call)`,
        description: (row.notes as string) || 'On-call period',
        start,
        end,
        location: (row.department_name as string) || '',
        categories: ['ON-CALL'],
      });
      if ((row.period_updated as string) > latestUpdated) latestUpdated = row.period_updated as string;
    }

    const etag = computeEtag(userId, latestUpdated, shiftRows.length, onCallRows.length);
    return { body: buildIcs(events, 'My Schedule'), etag };
  }

  /**
   * A filtered aggregation across departments, roles and people.
   *
   * WHY THE SCOPE IS AN ARGUMENT AND NOT A FILTER. `visibleOrgUnitIds` is
   * resolved from the token's owner on every fetch and intersected with
   * whatever the caller asked for — it is not one filter among the others and a
   * caller cannot widen it. `null` means unrestricted; an EMPTY ARRAY means the
   * caller's scope resolves to nothing, and it must return nothing rather than
   * being read as "no filter", which is the classic way an empty-list check
   * turns a restriction into its opposite.
   *
   * WHY THE RANGE REACHES BACKWARD. The existing department feed started at
   * CURDATE(), so the calendar a manager subscribed to had no memory: it could
   * not answer "who was on that Tuesday" the moment Tuesday passed. Past,
   * present and future was the point of the request, and a subscribed client
   * keeps historical events it has already seen only if the feed keeps serving
   * them.
   *
   * WHAT IT DOES NOT SHOW. Shifts and their assignees, nothing else. No
   * absences: publishing who is away on covered days makes leave and sickness
   * deducible from a calendar anyone in the subscription can read, which is the
   * inference the timeline's narrow projection exists to prevent, and this feed
   * reaches the same people. No pay, no assignment notes beyond the shift's own.
   */
  async buildAggregateFeed(options: {
    visibleOrgUnitIds: number[] | null;
    departmentIds?: number[];
    roleIds?: number[];
    userIds?: number[];
    /** Days back from today. Default 7 — a subscribed calendar with a memory. */
    pastDays?: number;
    /** Days forward from today. Default 30, matching the department feed. */
    futureDays?: number;
  }): Promise<FeedResult> {
    const { visibleOrgUnitIds } = options;
    const pastDays = options.pastDays ?? 7;
    const futureDays = options.futureDays ?? 30;

    // A scope that resolves to nothing shows nothing. Falling through to an
    // unfiltered query here is how a restriction becomes its opposite.
    if (Array.isArray(visibleOrgUnitIds) && visibleOrgUnitIds.length === 0) {
      return { body: buildIcs([], 'Staff Scheduler — Filtered'), etag: computeEtag('empty-scope') };
    }

    const conditions: string[] = [
      's.date BETWEEN DATE_SUB(CURDATE(), INTERVAL ? DAY) AND DATE_ADD(CURDATE(), INTERVAL ? DAY)',
    ];
    const params: Array<number | string> = [pastDays, futureDays];

    if (visibleOrgUnitIds !== null) {
      conditions.push(`d.org_unit_id IN (${visibleOrgUnitIds.map(() => '?').join(',')})`);
      params.push(...visibleOrgUnitIds);
    }
    if (options.departmentIds && options.departmentIds.length > 0) {
      conditions.push(`s.department_id IN (${options.departmentIds.map(() => '?').join(',')})`);
      params.push(...options.departmentIds);
    }
    if (options.userIds && options.userIds.length > 0) {
      // EXISTS rather than a join condition: filtering the joined assignment
      // rows would keep the shift and drop the other assignees from its
      // description, so the event would understate who is on duty.
      conditions.push(
        `EXISTS (SELECT 1 FROM shift_assignments fa
                  WHERE fa.shift_id = s.id AND fa.status IN ('pending','confirmed')
                    AND fa.user_id IN (${options.userIds.map(() => '?').join(',')}))`
      );
      params.push(...options.userIds);
    }
    if (options.roleIds && options.roleIds.length > 0) {
      conditions.push(
        `EXISTS (SELECT 1 FROM shift_assignments ra
                   JOIN user_roles ur ON ur.user_id = ra.user_id
                                     AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
                  WHERE ra.shift_id = s.id AND ra.status IN ('pending','confirmed')
                    AND ur.role_id IN (${options.roleIds.map(() => '?').join(',')}))`
      );
      params.push(...options.roleIds);
    }

    const [shiftRows] = await this.pool.query<RowDataPacket[]>(
      `SELECT s.id AS shift_id, s.date, s.start_time, s.end_time, s.notes,
              sch.name AS schedule_name,
              d.name AS department_name,
              s.updated_at AS shift_updated,
              GROUP_CONCAT(DISTINCT CONCAT_WS(' ', u.first_name, u.last_name) ORDER BY u.last_name) AS assignees
         FROM shifts s
         JOIN schedules sch ON s.schedule_id = sch.id
         LEFT JOIN departments d ON s.department_id = d.id
         LEFT JOIN shift_assignments sa ON sa.shift_id = s.id AND sa.status IN ('pending','confirmed')
         LEFT JOIN users u ON sa.user_id = u.id
        WHERE ${conditions.join(' AND ')}
        GROUP BY s.id
        ORDER BY s.date ASC, s.start_time ASC`,
      params
    );

    const events: CalendarEvent[] = [];
    let latestUpdated = '';

    for (const row of shiftRows) {
      const date = DateUtils.toDateString(row.date as string | Date);
      const { start, end } = shiftToEventTimes(date, row.start_time as string, row.end_time as string);
      const assignees = (row.assignees as string | null)?.split(',').filter(Boolean) ?? [];
      events.push({
        // Distinct from the department feed's UID: subscribing to both must not
        // make a client treat the two events as one and drop whichever arrived
        // second.
        uid: `agg-shift-${row.shift_id}@staffscheduler`,
        summary: `${row.department_name ?? 'Shift'} — ${assignees.length} on duty`,
        description: [
          row.notes || row.schedule_name,
          assignees.length > 0 ? `Assigned: ${assignees.join(', ')}` : 'Unassigned',
        ]
          .filter(Boolean)
          .join('\n'),
        start,
        end,
        location: (row.department_name as string) || '',
      });
      if ((row.shift_updated as string) > latestUpdated) latestUpdated = row.shift_updated as string;
    }

    // The filters are part of the ETag: two different filtered feeds must not
    // answer 304 to each other's If-None-Match.
    const etag = computeEtag(
      'agg',
      (visibleOrgUnitIds ?? ['all']).join('.'),
      (options.departmentIds ?? []).join('.'),
      (options.roleIds ?? []).join('.'),
      (options.userIds ?? []).join('.'),
      `${pastDays}-${futureDays}`,
      latestUpdated,
      shiftRows.length
    );
    return { body: buildIcs(events, 'Staff Scheduler — Filtered'), etag };
  }

  /** Aggregated feed for an entire department. Manager / admin only. */
  async buildDepartmentFeed(departmentId: number, options: { rangeDays?: number } = {}): Promise<FeedResult> {
    const days = options.rangeDays ?? 30;
    const [shiftRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT s.id AS shift_id, s.date, s.start_time, s.end_time, s.notes,
              sch.name AS schedule_name,
              d.name AS department_name,
              s.updated_at AS shift_updated,
              GROUP_CONCAT(DISTINCT CONCAT_WS(' ', u.first_name, u.last_name) ORDER BY u.last_name) AS assignees
         FROM shifts s
         JOIN schedules sch ON s.schedule_id = sch.id
         LEFT JOIN departments d ON s.department_id = d.id
         LEFT JOIN shift_assignments sa ON sa.shift_id = s.id AND sa.status IN ('pending','confirmed')
         LEFT JOIN users u ON sa.user_id = u.id
        WHERE s.department_id = ?
          AND s.date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
        GROUP BY s.id
        ORDER BY s.date ASC, s.start_time ASC`,
      [departmentId, days]
    );

    const events: CalendarEvent[] = [];
    let latestUpdated = '';

    for (const row of shiftRows) {
      const date = DateUtils.toDateString(row.date as string | Date);
      const { start, end } = shiftToEventTimes(date, row.start_time as string, row.end_time as string);
      const assignees = (row.assignees as string | null)?.split(',').filter(Boolean) ?? [];
      const description = [
        row.notes || row.schedule_name,
        assignees.length > 0 ? `Assigned: ${assignees.join(', ')}` : 'Unassigned',
      ]
        .filter(Boolean)
        .join('\n');
      events.push({
        uid: `dept-shift-${row.shift_id}@staffscheduler`,
        summary: `${row.department_name ?? 'Shift'} — ${assignees.length} on duty`,
        description,
        start,
        end,
        location: (row.department_name as string) || '',
      });
      if ((row.shift_updated as string) > latestUpdated) latestUpdated = row.shift_updated as string;
    }

    const etag = computeEtag(departmentId, latestUpdated, shiftRows.length);
    return { body: buildIcs(events, `${shiftRows[0]?.department_name ?? 'Department'} — Schedule`), etag };
  }

  /**
   * Loads "colleagues" — other assigned users — for a list of shift ids,
   * excluding the requesting user.
   */
  private async loadColleagues(
    shiftIds: number[],
    excludeUserId: number
  ): Promise<Map<number, string[]>> {
    const out = new Map<number, string[]>();
    if (shiftIds.length === 0) return out;
    const placeholders = shiftIds.map(() => '?').join(',');
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT sa.shift_id, CONCAT_WS(' ', u.first_name, u.last_name) AS full_name
         FROM shift_assignments sa
         JOIN users u ON sa.user_id = u.id
        WHERE sa.shift_id IN (${placeholders})
          AND sa.status IN ('pending', 'confirmed')
          AND sa.user_id != ?
        ORDER BY u.last_name`,
      [...shiftIds, excludeUserId]
    );
    for (const r of rows) {
      const shiftId = r.shift_id as number;
      const list = out.get(shiftId) ?? [];
      list.push((r.full_name as string).trim());
      out.set(shiftId, list);
    }
    return out;
  }

  /**
   * Backwards-compatible alias used by older tests/callers; routes the
   * old `.buildFeed(userId)` signature through the new feed result.
   */
  async buildFeed(userId: number): Promise<string> {
    const result = await this.buildUserFeed(userId);
    return result.body;
  }
}
