/**
 * Shared date and validation helpers.
 *
 * WHY THIS FILE SHRANK: it also exported CryptoUtils, HierarchyUtils and
 * ResponseUtils — 126 of its 291 lines — none of which had a single production
 * consumer; the only references anywhere in `src/` were their own unit tests.
 * knip did not flag them because the barrel itself is used and a test import
 * counts as usage, so they sat behind a green dead-code gate.
 *
 * CryptoUtils was the one worth removing on more than tidiness grounds: it
 * offered `hashPassword` returning `{ hash, salt }`, a second way to handle
 * credentials next to the real path, which is bcrypt through UserService
 * against the `password_hash` column. Unused code that looks like the
 * authentication helper is an invitation to use it.
 *
 * @author Luca Ostinelli
 */

import { logger } from '../config/logger';

export class DateUtils {
  /**
   * Convert Date to MySQL datetime format
   */
  static toMySQLDateTime(date: Date): string {
    return date.toISOString().slice(0, 19).replace('T', ' ');
  }

  /**
   * Convert Date to MySQL date format
   */
  static toMySQLDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  /**
   * Extracts "YYYY-MM-DD" from a Date using its *local* calendar
   * components, not `.toISOString()`. mysql2 materializes a DATE column as
   * a JS Date at local midnight (not UTC midnight) — `.toISOString()` on
   * that value converts to UTC and silently rolls back to the previous day
   * in any positive UTC-offset timezone (e.g. Europe/Rome). Use this for
   * every DATE column read back from the database; only use
   * `.toISOString()` for values that are genuinely UTC-anchored.
   */
  static fromMySQLDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /**
   * "YYYY-MM-DD" from whichever shape the driver hands back for a DATE column.
   *
   * WHY THIS EXISTS RATHER THAN EACH READER DECIDING. mysql2 materializes a
   * DATE as a `Date`, but the same column arrives as a string through a seed,
   * a JSON payload or a test fixture, so every reader has to handle both. Six
   * services were each doing that, in TWO SPELLINGS that are not equivalent:
   *
   *   `v instanceof Date ? fromMySQLDate(v) : String(v).slice(0, 10)`
   *   `typeof v === 'string' ? v : fromMySQLDate(v as Date)`
   *
   * On anything that is neither, the first returns nonsense ("null" sliced to
   * a date-shaped string) and the second throws `getFullYear is not a
   * function`. Both are wrong and they are wrong differently, which is worse
   * than either — the same value produces a crash in one code path and a
   * plausible-looking wrong date in another.
   *
   * The parameter type is `string | Date` deliberately: a caller holding
   * something nullable must decide what null means before asking (an absent
   * `effective_to` means "still in force", not a date), and the compiler now
   * makes them.
   *
   * This rule has already produced two defects — a weekday where a date
   * belonged, and `Invalid time value` in conflict detection — which is why it
   * has one home.
   */
  static toDateString(value: string | Date): string {
    return value instanceof Date ? DateUtils.fromMySQLDate(value) : String(value).slice(0, 10);
  }

  /**
   * Add days to a date
   */
  static addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  /**
   * Check if date is within range
   */
  static isWithinRange(date: Date, start: Date, end: Date): boolean {
    return date >= start && date <= end;
  }

  /**
   * Get start of day
   */
  static startOfDay(date: Date): Date {
    const result = new Date(date);
    result.setHours(0, 0, 0, 0);
    return result;
  }

  /**
   * Get end of day
   */
  static endOfDay(date: Date): Date {
    const result = new Date(date);
    result.setHours(23, 59, 59, 999);
    return result;
  }

  /**
   * Absolute `[start, end]` MySQL DATETIME strings for a shift, rolling an
   * overnight shift's end into the following day.
   *
   * WHY THIS IS NEEDED AT ALL: a shift is stored as a DATE plus two TIME
   * columns, so a 22:00–06:00 block has `end_time < start_time` and any
   * wall-clock comparison reads it as ending before it begins. Every consumer
   * that reasons about when a shift actually runs has to reconstruct the
   * absolute interval first — the constraint validator, both optimizer
   * engines, the calendar feed, and conflict detection.
   *
   * The shift's DATE is its START date by definition, which also settles where
   * an overnight shift's hours are counted: entirely against the day it starts.
   * That is what `constraintValidator`'s daily-hours rule already does (it
   * buckets on `shift.date` using the overnight-aware duration), and stating it
   * here makes the convention explicit rather than emergent — a night worker's
   * Monday-night shift is a Monday shift, not four hours of Monday and four of
   * Tuesday.
   */
  static shiftBounds(
    date: string | Date,
    startTime: string,
    endTime: string
  ): [string, string] {
    // Accepts a Date because mysql2 materializes a DATE column as one, and the
    // caller usually has the row rather than a formatted string. Taking only a
    // string put the burden on every call site to remember the conversion, and
    // exactly one of them forgot: the conflict check passed `shift.date`
    // straight through and produced `Invalid time value` at runtime, while the
    // audit path two lines away converted it correctly. Normalising here means
    // the trap cannot be stepped in again.
    const day = typeof date === 'string' ? date : DateUtils.fromMySQLDate(date);
    const start = new Date(`${day}T${DateUtils.padTime(startTime)}Z`);
    const end = new Date(`${day}T${DateUtils.padTime(endTime)}Z`);
    // `<=` and not `<`: equal times mean a zero-length shift, which the request
    // schemas reject, so treating it as a full 24 hours would invent duration
    // for a shape that cannot be stored.
    if (end.getTime() <= start.getTime()) end.setUTCDate(end.getUTCDate() + 1);
    return [DateUtils.toMySQLDateTime(start), DateUtils.toMySQLDateTime(end)];
  }

  /** Normalises "HH:MM" to "HH:MM:SS"; MySQL TIME columns read back either way. */
  private static padTime(time: string): string {
    return time.length === 5 ? `${time}:00` : time;
  }
}

export class ValidationUtils {
  /**
   * Reads a JSON column, whichever of its two shapes the driver hands back.
   *
   * WHY BOTH SHAPES. mysql2 parses a `JSON` column into an object already,
   * while an older driver — and any column kept as `TEXT` — returns the raw
   * string. Both appear in the wild, so every reader has to accept either.
   *
   * WHY IT NEVER THROWS. A malformed value in ONE row would otherwise raise a
   * bare `SyntaxError` out of a row mapper. That is not an `AppError`, so
   * `errorHandler` renders it as a 500 — and since these mappers run inside
   * list endpoints, one corrupted row made the WHOLE list unreadable rather
   * than just itself. Five call sites had no guard at all before this existed,
   * one of them on the attendance clock-in path, where a single malformed
   * geofence polygon would have stopped attendance for an entire department
   * (#723).
   *
   * WHY IT LOGS. Falling back silently trades an outage for data that is
   * quietly wrong, which is the worse failure of the two to diagnose. The row
   * still renders — with the caller's fallback — and the corruption is
   * recorded where an operator can find it. `context` names the column so the
   * log line identifies what to go and fix.
   *
   * The caller supplies the fallback because only the caller knows what an
   * absent value means for its own shape: `{}` for a payload, `[]` for a
   * list, `null` for "not configured".
   */
  static parseJsonColumn<T>(raw: unknown, fallback: T, context: string): T {
    if (raw === null || raw === undefined) return fallback;
    if (typeof raw !== 'string') return raw as T;
    if (raw.length === 0) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      logger.error(`Malformed JSON in ${context}; falling back`, {
        error: (error as Error).message,
        // Bounded: a corrupted column can be arbitrarily large, and the point
        // is to identify the row, not to reproduce it in the log.
        value: raw.slice(0, 200),
      });
      return fallback;
    }
  }

  /**
   * Parses a DB-stored JSON string expected to contain an array of strings.
   * Returns [] on malformed JSON or a non-array value instead of throwing,
   * so one corrupted row can never take down a whole request (the RBAC
   * delegation path runs on every authenticated request).
   *
   * Kept distinct from `parseJsonColumn` rather than folded into it: this one
   * also FILTERS, dropping non-string members of an otherwise valid array, so
   * a caller reading permission codes cannot receive a number among them.
   */
  static parseStringArray(raw: unknown): string[] {
    if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === 'string');
    const parsed = ValidationUtils.parseJsonColumn<unknown>(raw, [], 'a string-array column');
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  }

  /**
   * Validate email format
   */
  static isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Validate password strength
   */
  static isValidPassword(password: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (password.length < 8) {
      errors.push('Password must be at least 8 characters long');
    }
    
    if (!/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }
    
    if (!/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }
    
    if (!/\d/.test(password)) {
      errors.push('Password must contain at least one number');
    }
    
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate UUID format
   */
  static isValidUUID(uuid: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }

  /**
   * Sanitize string input
   */
  static sanitizeString(input: string): string {
    return input.trim().replace(/[<>]/g, '');
  }
}

