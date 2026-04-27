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

const isoDate = (raw: unknown): string =>
  typeof raw === 'string' ? raw : new Date(raw as Date).toISOString().slice(0, 10);

export class CalendarService {
  constructor(private pool: Pool) {}

  /** Returns the user's current token, creating one if none exists. */
  async getOrCreateToken(userId: number): Promise<string> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT token FROM user_calendar_tokens WHERE user_id = ? LIMIT 1`,
      [userId]
    );
    if (rows.length > 0) return rows[0].token as string;
    const token = randomBytes(24).toString('hex');
    await this.pool.execute<ResultSetHeader>(
      `INSERT INTO user_calendar_tokens (user_id, token) VALUES (?, ?)`,
      [userId, token]
    );
    return token;
  }

  async rotateToken(userId: number): Promise<string> {
    const token = randomBytes(24).toString('hex');
    await this.pool.execute<ResultSetHeader>(
      `INSERT INTO user_calendar_tokens (user_id, token) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE token = VALUES(token), created_at = CURRENT_TIMESTAMP`,
      [userId, token]
    );
    return token;
  }

  async resolveToken(token: string): Promise<number | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT user_id FROM user_calendar_tokens WHERE token = ? LIMIT 1`,
      [token]
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
      const date = isoDate(row.date);
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
      const date = isoDate(row.date);
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
      const date = isoDate(row.date);
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
