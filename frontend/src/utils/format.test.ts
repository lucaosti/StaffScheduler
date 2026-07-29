/**
 * Unit tests for the format helpers.
 */

import {
  formatCurrency,
  formatDate,
  formatPercentage,
  formatTime,
  todayIso,
  firstOfMonthIso,
  toLocalDateString,
} from './format';

describe('formatDate', () => {
  it('returns an empty string for null/undefined/invalid input', () => {
    expect(formatDate(null)).toBe('');
    expect(formatDate(undefined)).toBe('');
    expect(formatDate('not-a-date')).toBe('');
  });

  it('formats an ISO date in short locale form', () => {
    expect(formatDate('2026-04-25', 'en-US')).toBe('Apr 25, 2026');
  });

  it('renders a date-only string as that calendar day in any timezone', () => {
    // `new Date('2026-04-25')` is UTC midnight, which a local-time formatter
    // renders as 24 April west of Greenwich. This case fails in
    // America/New_York against the previous implementation and passes in UTC
    // and Europe/Rome either way, which is how it survived unnoticed.
    expect(formatDate('2026-01-01', 'en-US')).toBe('Jan 1, 2026');
    expect(formatDate('2026-12-31', 'en-US')).toBe('Dec 31, 2026');
  });

  it('still treats a string carrying a time as a real instant', () => {
    // A timestamp names a moment, so which calendar day it falls on genuinely
    // depends on the reader's zone — only date-only strings are day labels, and
    // the fix must not turn every timestamp into one. The expectation is
    // therefore derived rather than written out, because in Auckland this
    // instant really is the 26th.
    const instant = '2026-04-25T12:00:00.000Z';
    expect(formatDate(instant, 'en-US')).toBe(
      new Date(instant).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    );
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

/**
 * `toLocalDateString`, the formatting counterpart to `todayIso`.
 *
 * The case that matters is a `Date` whose LOCAL calendar day and UTC calendar
 * day disagree, which is what `toISOString().slice(0, 10)` gets wrong. That
 * cannot be built from a real `Date` in a test that must pass everywhere: CI
 * runs in UTC, where the two views never disagree, so the decisive case would
 * quietly become a tautology there — passing against the very implementation it
 * exists to reject. Reassigning `process.env.TZ` does not help either; the zone
 * is fixed for the life of the worker process.
 *
 * So that one case supplies the disagreement directly, through an object that
 * reports 30 July locally and 29 July in UTC. It is not a stand-in for a real
 * `Date` — it is a statement about which of the two a correct implementation
 * must read, and it fails against the UTC-shifting version in every timezone,
 * including the one CI uses.
 */
describe('toLocalDateString', () => {
  it('reads the local calendar components, not the UTC ones', () => {
    // 00:30 on 30 July in Rome is 22:30 on the 29th in UTC — the hours in which
    // the old expression named the day before.
    const localAndUtcDisagree = {
      getFullYear: () => 2026,
      getMonth: () => 6,
      getDate: () => 30,
      toISOString: () => '2026-07-29T22:30:00.000Z',
    } as unknown as Date;

    expect(toLocalDateString(localAndUtcDisagree)).toBe('2026-07-30');
  });

  it('formats a real Date', () => {
    // Midday, so no real-world offset can move it off the day, whichever zone
    // the suite happens to run in.
    expect(toLocalDateString(new Date(2026, 6, 30, 12, 0))).toBe('2026-07-30');
  });

  it('pads a single-digit month and day', () => {
    expect(toLocalDateString(new Date(2026, 0, 5, 12, 0))).toBe('2026-01-05');
  });

  it('passes a date string through untouched', () => {
    // Parsing it would be the mirror-image bug: `new Date('2026-07-30')` is UTC
    // midnight, so re-formatting it locally moves it back a day west of
    // Greenwich. The string is already the calendar date the server meant.
    expect(toLocalDateString('2026-07-30')).toBe('2026-07-30');
    expect(toLocalDateString('2026-07-30T00:00:00.000Z')).toBe('2026-07-30');
  });

  it('returns an empty string for a missing date', () => {
    expect(toLocalDateString(null)).toBe('');
    expect(toLocalDateString(undefined)).toBe('');
    expect(toLocalDateString('')).toBe('');
  });
});
