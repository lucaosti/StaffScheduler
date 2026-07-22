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

describe('DateUtils', () => {
  const sample = new Date('2026-04-26T13:14:15.000Z');

  it('toMySQLDateTime formats as YYYY-MM-DD HH:MM:SS', () => {
    expect(DateUtils.toMySQLDateTime(sample)).toBe('2026-04-26 13:14:15');
  });

  it('toMySQLDate trims to date only', () => {
    expect(DateUtils.toMySQLDate(sample)).toBe('2026-04-26');
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

