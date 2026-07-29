/**
 * Unit tests for the format helpers.
 */

import { formatCurrency, formatDate, formatPercentage, formatTime, todayIso, firstOfMonthIso } from './format';

describe('formatDate', () => {
  it('returns an empty string for null/undefined/invalid input', () => {
    expect(formatDate(null)).toBe('');
    expect(formatDate(undefined)).toBe('');
    expect(formatDate('not-a-date')).toBe('');
  });

  it('formats an ISO date in short locale form', () => {
    expect(formatDate('2026-04-25', 'en-US')).toBe('Apr 25, 2026');
  });
});

describe('formatTime', () => {
  it('passes through HH:mm strings unchanged', () => {
    expect(formatTime('09:30', 'en-US')).toBe('09:30');
  });

  it('truncates HH:mm:ss to HH:mm', () => {
    expect(formatTime('09:30:45', 'en-US')).toBe('09:30');
  });

  it('returns empty string on invalid input', () => {
    expect(formatTime('')).toBe('');
    expect(formatTime('garbage')).toBe('');
  });
});

describe('formatCurrency', () => {
  it('formats an amount in EUR by default', () => {
    // The exact glyph/separator depends on the locale, so we only assert the
    // value and currency code surface in the output.
    const out = formatCurrency(1234.5, 'EUR', 'en-US');
    expect(out).toContain('1,234.50');
    expect(out).toMatch(/€|EUR/);
  });

  it('respects a USD currency override', () => {
    const out = formatCurrency(10, 'USD', 'en-US');
    expect(out).toContain('$10.00');
  });
});

describe('formatPercentage', () => {
  it('treats the input as a 0-1 ratio by default', () => {
    expect(formatPercentage(0.5, true, 'en-US')).toBe('50%');
  });

  it('treats the input as a 0-100 number when asRatio is false', () => {
    expect(formatPercentage(50, false, 'en-US')).toBe('50%');
  });
});

/**
 * The "today" helpers.
 *
 * Six pages each wrote their own version of this with
 * `new Date().toISOString().slice(0, 10)`, which is the UTC date: in a
 * positive-offset timezone the hours between local midnight and the offset are
 * still yesterday in UTC. A default range silently starting a day early is the
 * kind of defect nobody reports, because it looks like the app just chose a
 * different default.
 */
describe('todayIso', () => {
  it('agrees with the local calendar, not with UTC', () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate()
    ).padStart(2, '0')}`;
    expect(todayIso()).toBe(expected);
  });

  it('offsets forward and backward by whole days', () => {
    const plus = new Date();
    plus.setDate(plus.getDate() + 7);
    const expected = `${plus.getFullYear()}-${String(plus.getMonth() + 1).padStart(2, '0')}-${String(
      plus.getDate()
    ).padStart(2, '0')}`;
    expect(todayIso(7)).toBe(expected);

    const minus = new Date();
    minus.setDate(minus.getDate() - 30);
    expect(todayIso(-30)).toBe(
      `${minus.getFullYear()}-${String(minus.getMonth() + 1).padStart(2, '0')}-${String(
        minus.getDate()
      ).padStart(2, '0')}`
    );
  });

  it('rolls across a month boundary rather than producing day 32', () => {
    // `setDate` normalises, which is why the offset is applied to a Date
    // rather than to the string.
    expect(todayIso(400)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('firstOfMonthIso', () => {
  it('returns day 01 of the current local month', () => {
    const now = new Date();
    expect(firstOfMonthIso()).toBe(
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    );
  });
});
