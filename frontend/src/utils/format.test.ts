/**
 * Unit tests for the format helpers.
 */

import { formatCurrency, formatDate, formatPercentage, formatTime } from './format';

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
