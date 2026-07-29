/**
 * Reusable SQL fragments for expressions that must not be re-derived per query.
 *
 * WHY A MODULE OF SQL STRINGS RATHER THAN A QUERY BUILDER. The project uses raw
 * parameterised SQL deliberately — no ORM — so the alternative to sharing a
 * fragment is retyping the expression at every call site. That is exactly how
 * shift duration came to be computed three different ways: `ReportsService`
 * handled shifts crossing midnight with a CASE, the two dashboard aggregates
 * did not and produced NEGATIVE hours for them, and the optimizer had its own
 * TypeScript version. A named constant is not abstraction for its own sake
 * here; it is the difference between one definition and several that disagree.
 *
 * These are fragments, never whole statements. The SQL expressions here
 * interpolate no user input; `inClause` is the one exception and exists
 * precisely to make that exception safe by construction rather than by each
 * caller arguing that its own ids are trustworthy.
 *
 * @author Luca Ostinelli
 */

/**
 * Duration of a shift in hours, overnight-aware, for a `shifts` row aliased `s`.
 *
 * A shift is a DATE plus two TIME columns, so a 22:00–06:00 block has
 * `end_time < start_time`. The obvious expression —
 * `TIMESTAMPDIFF(HOUR, CONCAT(s.date,' ',s.start_time), CONCAT(s.date,' ',s.end_time))` —
 * pins both ends to the same calendar day and therefore returns **-16** for
 * that shift. Summed over a month it silently subtracts from total hours, and
 * multiplied by an hourly rate it subtracts from labour cost: the figures stay
 * plausible while being wrong, which is worse than an obvious failure.
 *
 * Computed in seconds and divided rather than with `TIMESTAMPDIFF(HOUR, ...)`,
 * because the latter TRUNCATES toward zero — a 7.5-hour shift would count as 7,
 * losing half an hour per shift across every report.
 *
 * Kept in minutes-precision terms (`TIME_TO_SEC`) so it matches what
 * `DateUtils.shiftBounds` computes on the TypeScript side.
 */
export const SHIFT_HOURS_SQL = `(
  (TIME_TO_SEC(TIMEDIFF(s.end_time, s.start_time))
    + IF(s.end_time <= s.start_time, 86400, 0)) / 3600
)`;

/**
 * Absolute end timestamp of a shift row aliased `s`, rolling an overnight end
 * into the following day. Counterpart of `DateUtils.shiftBounds` for use inside
 * a query, where reconstructing the interval in application code would mean
 * fetching every candidate row first.
 */
export const SHIFT_ABS_END_SQL = `(
  TIMESTAMP(s.date, s.start_time)
  + INTERVAL (
      TIME_TO_SEC(TIMEDIFF(s.end_time, s.start_time))
      + IF(s.end_time <= s.start_time, 86400, 0)
    ) SECOND
)`;


/**
 * A safe `IN (...)` list from ids that must be integers.
 *
 * WHY INTERPOLATION AT ALL. An `IN` list cannot be one bound parameter — the
 * placeholder count depends on the list length — so the choice is between
 * building `?, ?, ?` per call or interpolating validated integers. Both are
 * fine; what is not fine is what the codebase actually had: SIX call sites
 * interpolating `ids.join(',')`, of which exactly ONE checked the ids were
 * integers.
 *
 * Each of the other five was safe by PROVENANCE — "these came from a SELECT",
 * "these are the caller's resolved org-unit scope" — and provenance is an
 * argument that has to be re-made, correctly, at every new call site, by
 * someone who may not know it is load-bearing. One of the five was already
 * weaker than the others: the replan-proposal ids come from a JSON column,
 * where nothing in the schema or the type system constrains what was stored.
 *
 * THROWS RATHER THAN FILTERS. Silently dropping an id would narrow a query
 * without saying so — and one of the call sites is a DELETE, where a quietly
 * shorter list means the wrong rows survive. An empty list throws for the same
 * reason it must never be reached: `IN ()` is a syntax error, so a caller that
 * can produce an empty set has to decide what empty MEANS before asking, and
 * every current caller does.
 */
export const inClause = (ids: Array<number | string>): string => {
  if (ids.length === 0) {
    throw new Error('inClause called with no ids; the caller must handle the empty case');
  }
  const safe = ids.map((id) => Number(id));
  if (!safe.every((id) => Number.isInteger(id))) {
    throw new Error('inClause called with a non-integer id');
  }
  return safe.join(',');
};
