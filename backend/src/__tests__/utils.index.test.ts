/**
 * Tests for the legacy `src/utils/index.ts` toolkit.
 *
 * Lifts coverage on a previously-untested 264-line file. We do not touch
 * the implementation; the goal is just to pin the contract down.
 */

import {
  DateUtils,
  ValidationUtils,
} from '../utils';
import { logger } from '../config/logger';

describe('DateUtils', () => {
  const sample = new Date('2026-04-26T13:14:15.000Z');

  it('toMySQLDateTime formats as YYYY-MM-DD HH:MM:SS', () => {
    expect(DateUtils.toMySQLDateTime(sample)).toBe('2026-04-26 13:14:15');
  });

  it('toMySQLDate trims to date only', () => {
    expect(DateUtils.toMySQLDate(sample)).toBe('2026-04-26');
  });

  /**
   * Six services each carried this rule, in two spellings that were not
   * equivalent: on anything unexpected one returned nonsense and the other
   * threw. Same value, crash in one code path and a plausible-looking wrong
   * date in another.
   */
  describe('toDateString', () => {
    it('reads a Date through the local-calendar path', () => {
      const localMidnight = new Date(2033, 3, 1);
      // NOT toISOString(): mysql2 materializes a DATE at LOCAL midnight, and
      // converting that to UTC rolls back a day in any positive offset.
      expect(DateUtils.toDateString(localMidnight)).toBe('2033-04-01');
    });

    it('trims a string that already carries a time', () => {
      expect(DateUtils.toDateString('2033-04-01 09:00:00')).toBe('2033-04-01');
    });

    it('leaves a bare date string alone', () => {
      expect(DateUtils.toDateString('2033-04-01')).toBe('2033-04-01');
    });
  });

  it('addDays advances the calendar day', () => {
    expect(DateUtils.toMySQLDate(DateUtils.addDays(sample, 5))).toBe('2026-05-01');
  });

  it('isWithinRange checks inclusive bounds', () => {
    const start = new Date('2026-04-01T00:00:00Z');
    const end = new Date('2026-04-30T23:59:59Z');
    expect(DateUtils.isWithinRange(sample, start, end)).toBe(true);
    expect(DateUtils.isWithinRange(new Date('2026-05-02'), start, end)).toBe(false);
  });

  it('startOfDay / endOfDay reset the time component', () => {
    const start = DateUtils.startOfDay(sample);
    const end = DateUtils.endOfDay(sample);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(end.getHours()).toBe(23);
    expect(end.getMilliseconds()).toBe(999);
  });
});

describe('ValidationUtils', () => {
  it('isValidEmail accepts well-formed emails and rejects garbage', () => {
    expect(ValidationUtils.isValidEmail('a@b.co')).toBe(true);
    expect(ValidationUtils.isValidEmail('not-an-email')).toBe(false);
  });

  it('isValidPassword enumerates every failing rule', () => {
    const result = ValidationUtils.isValidPassword('weak');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
  });

  it('isValidPassword accepts a strong password', () => {
    expect(ValidationUtils.isValidPassword('Strong1!Pass').valid).toBe(true);
  });

  it('isValidUUID accepts a v4 string', () => {
    // A literal rather than CryptoUtils.generateUUID(): that helper is gone,
    // and the subject here is the validator, not how the value was produced.
    expect(ValidationUtils.isValidUUID('f47ac10b-58cc-4372-a567-0e02b2c3d479')).toBe(true);
  });

  it('sanitizeString trims and strips angle brackets', () => {
    expect(ValidationUtils.sanitizeString('  <script>x</script>  ')).toBe('scriptx/script');
  });
});


/**
 * `parseJsonColumn` is the guard five row mappers were missing (#723): a
 * malformed JSON column used to raise a bare `SyntaxError` out of the mapper,
 * which `errorHandler` renders as a 500 — so ONE corrupted row made an entire
 * list unreadable, and on the geofence path stopped clock-in for a department.
 */
describe('ValidationUtils.parseJsonColumn', () => {
  it('accepts a value the driver already parsed', () => {
    // mysql2 hands back a JSON column as an object; only a TEXT column or an
    // older driver gives the string. Both shapes have to work.
    expect(ValidationUtils.parseJsonColumn({ a: 1 }, {}, 'ctx')).toEqual({ a: 1 });
    expect(ValidationUtils.parseJsonColumn([1, 2], [], 'ctx')).toEqual([1, 2]);
  });

  it('parses the string shape', () => {
    expect(ValidationUtils.parseJsonColumn('{"a":1}', {}, 'ctx')).toEqual({ a: 1 });
  });

  it('returns the fallback for null, undefined and empty', () => {
    for (const raw of [null, undefined, '']) {
      expect(ValidationUtils.parseJsonColumn(raw, 'fallback', 'ctx')).toBe('fallback');
    }
  });

  it('returns the fallback instead of throwing on malformed JSON', () => {
    // The whole point: the row still renders, the request still succeeds.
    expect(() => ValidationUtils.parseJsonColumn('{not json', {}, 'ctx')).not.toThrow();
    expect(ValidationUtils.parseJsonColumn('{not json', { safe: true }, 'ctx')).toEqual({
      safe: true,
    });
  });

  it('logs the corruption rather than swallowing it', () => {
    // Falling back silently trades an outage for data that is quietly wrong,
    // which is harder to diagnose than either. The context names the column.
    const error = jest.spyOn(logger, 'error').mockImplementation(() => logger);
    ValidationUtils.parseJsonColumn('{bad', {}, 'geofences.polygon');
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('geofences.polygon'),
      expect.objectContaining({ value: '{bad' })
    );
    error.mockRestore();
  });

  it('bounds the logged value so a large corrupted column cannot flood the log', () => {
    const error = jest.spyOn(logger, 'error').mockImplementation(() => logger);
    ValidationUtils.parseJsonColumn('{'.repeat(5000), {}, 'ctx');
    const logged = (error.mock.calls[0] as unknown as [string, { value: string }])[1].value;
    expect(logged.length).toBe(200);
    error.mockRestore();
  });

  it('keeps parseStringArray filtering non-strings out of a valid array', () => {
    // The sibling helper does more than parse, which is why it stayed distinct.
    expect(ValidationUtils.parseStringArray('["a",1,"b"]')).toEqual(['a', 'b']);
    expect(ValidationUtils.parseStringArray('{bad')).toEqual([]);
    expect(ValidationUtils.parseStringArray('{"not":"an array"}')).toEqual([]);
  });
});
