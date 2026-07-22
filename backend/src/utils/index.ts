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
}

export class ValidationUtils {
  /**
   * Parses a DB-stored JSON string expected to contain an array of strings.
   * Returns [] on malformed JSON or a non-array value instead of throwing,
   * so one corrupted row can never take down a whole request (the RBAC
   * delegation path runs on every authenticated request).
   */
  static parseStringArray(raw: unknown): string[] {
    if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === 'string');
    if (typeof raw !== 'string' || raw.length === 0) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
      return [];
    }
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

