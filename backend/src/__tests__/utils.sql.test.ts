/**
 * `inClause` — the one place SQL is built from values rather than parameters.
 *
 * An `IN` list cannot be a single bound parameter, so the ids are interpolated.
 * Six call sites were doing that independently and only one checked the ids
 * were integers; each of the other five was safe by PROVENANCE, an argument
 * that has to be re-made correctly at every new call site by someone who may
 * not know it is load-bearing. These tests are what makes it safe by
 * construction instead.
 *
 * @author Luca Ostinelli
 */

import { inClause, limitOffsetClause, PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from '../utils/sql';

export {};

describe('inClause', () => {
  it('joins integers', () => {
    expect(inClause([7, 9, 11])).toBe('7,9,11');
  });

  it('accepts numeric strings, since ids arrive as strings from JSON', () => {
    // The replan-proposal payload is a JSON column: what comes back is
    // whatever was stored, and a number may well have been serialised.
    expect(inClause(['7', '9'])).toBe('7,9');
  });

  it.each([
    ['SQL fragment', '1 OR 1=1'],
    ['statement terminator', '1; DROP TABLE users'],
    ['fractional', 1.5],
    ['not a number at all', 'seven'],
    ['NaN', NaN],
    ['infinite', Infinity],
  ])('refuses a %s', (_name, value) => {
    // This is the case the JSON-column call site could actually reach: nothing
    // in the schema or the type system constrains what was stored there.
    expect(() => inClause([1, value as number])).toThrow(/non-integer id/);
  });

  it('refuses an empty list rather than producing `IN ()`', () => {
    // `IN ()` is a syntax error, so a caller that can produce an empty set has
    // to decide what empty MEANS before asking — "nothing matches" and
    // "no restriction" are opposite answers and only the caller knows which.
    expect(() => inClause([])).toThrow(/must handle the empty case/);
  });

  it('throws rather than silently dropping a bad id', () => {
    // Filtering would narrow a query without saying so, and one call site is a
    // DELETE — where a quietly shorter list means the wrong rows survive.
    expect(() => inClause([1, 'x' as unknown as number, 3])).toThrow();
  });
});

/**
 * `limitOffsetClause` — LIMIT/OFFSET cannot be bound under `execute()` (#824),
 * so they are inlined; these tests are what makes inlining them safe.
 */
describe('limitOffsetClause', () => {
  it('renders the requested window', () => {
    expect(limitOffsetClause({ limit: 25, offset: 50 })).toBe('LIMIT 25 OFFSET 50');
  });

  it('defaults a missing window to the first default-sized page', () => {
    expect(limitOffsetClause({})).toBe(`LIMIT ${PAGE_SIZE_DEFAULT} OFFSET 0`);
  });

  it('caps the limit at the maximum page size', () => {
    expect(limitOffsetClause({ limit: 10_000 })).toBe(`LIMIT ${PAGE_SIZE_MAX} OFFSET 0`);
  });

  it('honours caller-specific bounds', () => {
    const bounds = { defaultLimit: 100, maxLimit: 500 };
    expect(limitOffsetClause({}, bounds)).toBe('LIMIT 100 OFFSET 0');
    expect(limitOffsetClause({ limit: 999 }, bounds)).toBe('LIMIT 500 OFFSET 0');
  });

  it('raises a zero or negative limit to one row', () => {
    expect(limitOffsetClause({ limit: 0 })).toBe('LIMIT 1 OFFSET 0');
    expect(limitOffsetClause({ limit: -4 })).toBe('LIMIT 1 OFFSET 0');
  });

  it('clamps a negative offset to zero', () => {
    expect(limitOffsetClause({ limit: 5, offset: -5 })).toBe('LIMIT 5 OFFSET 0');
  });

  it('truncates fractional values, since a float in LIMIT is a syntax error', () => {
    expect(limitOffsetClause({ limit: 10.9, offset: 5.7 })).toBe('LIMIT 10 OFFSET 5');
  });

  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
  ])('treats a %s value as absent', (_name, value) => {
    expect(limitOffsetClause({ limit: value, offset: value })).toBe(`LIMIT ${PAGE_SIZE_DEFAULT} OFFSET 0`);
  });

  it.each([
    ['SQL fragment', '1; DROP TABLE users'],
    ['numeric string', '7'],
    ['object', { toString: (): string => '1 OR 1=1' }],
  ])('never interpolates a %s that bypassed the type system', (_name, value) => {
    // Only a finite `number` is accepted; anything else falls back to the
    // default, so no caller-supplied text can ever reach the SQL.
    const clause = limitOffsetClause({ limit: value as unknown as number, offset: value as unknown as number });
    expect(clause).toBe(`LIMIT ${PAGE_SIZE_DEFAULT} OFFSET 0`);
  });

  it('keeps a huge offset in plain integer notation', () => {
    // String(1e21) is "1e+21", which MySQL would reject as a syntax error.
    expect(limitOffsetClause({ limit: 5, offset: 1e21 })).toBe(`LIMIT 5 OFFSET ${Number.MAX_SAFE_INTEGER}`);
  });

  it('only ever renders digits', () => {
    for (const value of [-1, 0, 0.5, 3, 1e300, NaN, -0]) {
      expect(limitOffsetClause({ limit: value, offset: value })).toMatch(/^LIMIT \d+ OFFSET \d+$/);
    }
  });
});
