/**
 * Tests for the legacy `src/utils/index.ts` toolkit.
 *
 * Lifts coverage on a previously-untested 264-line file. We do not touch
 * the implementation; the goal is just to pin the contract down.
 */

import {
  CryptoUtils,
  DateUtils,
  HierarchyUtils,
  ResponseUtils,
  ValidationUtils,
} from '../utils';

describe('CryptoUtils', () => {
  it('hashPassword + verifyPassword round-trip', async () => {
    const { hash } = await CryptoUtils.hashPassword('correct-horse');
    expect(await CryptoUtils.verifyPassword('correct-horse', hash)).toBe(true);
    expect(await CryptoUtils.verifyPassword('wrong', hash)).toBe(false);
  });

  it('generateToken returns hex of the requested byte length', () => {
    expect(CryptoUtils.generateToken(8)).toMatch(/^[a-f0-9]{16}$/);
  });

  it('generateUUID returns a v4 UUID', () => {
    expect(CryptoUtils.generateUUID()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it('generateSalt is hex of length*2', () => {
    expect(CryptoUtils.generateSalt(8)).toMatch(/^[a-f0-9]{16}$/);
  });
});

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
    expect(ValidationUtils.isValidUUID(CryptoUtils.generateUUID())).toBe(true);
  });

  it('sanitizeString trims and strips angle brackets', () => {
    expect(ValidationUtils.sanitizeString('  <script>x</script>  ')).toBe('scriptx/script');
  });
});

describe('HierarchyUtils', () => {
  it('buildPath returns "0" for root and concatenates otherwise', () => {
    expect(HierarchyUtils.buildPath(null, 'A')).toBe('0');
    expect(HierarchyUtils.buildPath('0.A', 'B')).toBe('0.A.B');
  });

  it('getLevel counts dot segments', () => {
    expect(HierarchyUtils.getLevel('0')).toBe(0);
    expect(HierarchyUtils.getLevel('0.A.B')).toBe(2);
  });

  it('isDescendant matches direct and self', () => {
    expect(HierarchyUtils.isDescendant('0.A.B', '0.A')).toBe(true);
    expect(HierarchyUtils.isDescendant('0.A', '0.A')).toBe(true);
    expect(HierarchyUtils.isDescendant('0.A', '0.B')).toBe(false);
  });

  it('getParentPaths walks every ancestor', () => {
    expect(HierarchyUtils.getParentPaths('0.A.B')).toEqual(['0', '0.A', '0.A.B']);
  });

  it('findCommonAncestor stops at the first divergence', () => {
    expect(HierarchyUtils.findCommonAncestor('0.A.B', '0.A.C')).toBe('0.A');
    expect(HierarchyUtils.findCommonAncestor('0.A', '1.X')).toBe('');
  });
});

describe('ResponseUtils', () => {
  it('success wraps data and optional meta', () => {
    expect(ResponseUtils.success(42)).toEqual({ success: true, data: 42, meta: undefined });
    expect(ResponseUtils.success(1, { foo: 'bar' })).toEqual({ success: true, data: 1, meta: { foo: 'bar' } });
  });

  it('error wraps code/message/details', () => {
    expect(ResponseUtils.error('X', 'm', { d: 1 })).toEqual({
      success: false,
      error: { code: 'X', message: 'm', details: { d: 1 } },
    });
  });

  it('paginated computes totalPages correctly', () => {
    const out = ResponseUtils.paginated([1, 2], 5, 1, 2);
    expect(out.success).toBe(true);
    expect(out.data).toEqual([1, 2]);
    expect(out.meta.total).toBe(5);
    // 5 items / 2 per page = 3 pages.
    expect(out.meta.totalPages).toBe(3);
  });
});
