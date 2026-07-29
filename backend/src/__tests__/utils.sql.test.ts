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

import { inClause } from '../utils/sql';

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
