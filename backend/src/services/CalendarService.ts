/**
 * Calendar service (F04).
 *
 * Generates per-user iCalendar feeds (RFC 5545) from confirmed/pending
 * shift assignments. Authentication uses an opaque per-user token in the
 * subscription URL (calendar clients rarely support custom headers).
 *
 * Token rotation revokes every active subscription for that user.
 *
 * @author Luca Ostinelli
 */

import { randomBytes } from 'crypto';
import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

export interface CalendarEvent {
  uid: string;
  summary: string;
  description: string;
  start: Date;
  end: Date;
  location: string;
}

const ICAL_PROD_ID = '-//Staff Scheduler//EN';

const escapeText = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

const formatDate = (d: Date): string =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');

/** Pure function: turns an array of events into RFC 5545 iCalendar text. */
export const buildIcs = (events: CalendarEvent[]): string => {
  const now = formatDate(new Date());
  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${ICAL_PROD_ID}`, 'CALSCALE:GREGORIAN'];
  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.uid}`,
      `DTSTAMP:${now}`,
      `DTSTART:${formatDate(event.start)}`,
      `DTEND:${formatDate(event.end)}`,
      `SUMMARY:${escapeText(event.summary)}`,
      `DESCRIPTION:${escapeText(event.description)}`,
      `LOCATION:${escapeText(event.location)}`,
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  // RFC 5545 recommends CRLF line endings.
  return lines.join('\r\n') + '\r\n';
};

/** Builds the absolute event timestamps for a shift, accounting for overnight wrap. */
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

  /** Rotates the token, returning the new value. */
  async rotateToken(userId: number): Promise<string> {
    const token = randomBytes(24).toString('hex');
    await this.pool.execute<ResultSetHeader>(
      `INSERT INTO user_calendar_tokens (user_id, token) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE token = VALUES(token), created_at = CURRENT_TIMESTAMP`,
      [userId, token]
    );
    return token;
  }

  /** Resolves a token to a user id, or null if the token does not match. */
  async resolveToken(token: string): Promise<number | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT user_id FROM user_calendar_tokens WHERE token = ? LIMIT 1`,
      [token]
    );
    return rows.length === 0 ? null : (rows[0].user_id as number);
  }

  /** Builds the iCalendar text for a user's pending/confirmed assignments. */
  async buildFeed(userId: number): Promise<string> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT sa.id AS assignment_id, sa.status,
              s.id AS shift_id, s.date, s.start_time, s.end_time, s.notes,
              sch.name AS schedule_name,
              d.name AS department_name
         FROM shift_assignments sa
         JOIN shifts s ON sa.shift_id = s.id
         JOIN schedules sch ON s.schedule_id = sch.id
         LEFT JOIN departments d ON s.department_id = d.id
        WHERE sa.user_id = ?
          AND sa.status IN ('pending', 'confirmed')
        ORDER BY s.date ASC, s.start_time ASC`,
      [userId]
    );

    const events: CalendarEvent[] = rows.map((row: any) => {
      const date =
        typeof row.date === 'string' ? row.date : new Date(row.date).toISOString().slice(0, 10);
      const { start, end } = shiftToEventTimes(date, row.start_time, row.end_time);
      return {
        uid: `assignment-${row.assignment_id}@staffscheduler`,
        summary: `${row.department_name ?? 'Shift'} (${row.status})`,
        description: row.notes || row.schedule_name || '',
        start,
        end,
        location: row.department_name || '',
      };
    });

    return buildIcs(events);
  }
}
