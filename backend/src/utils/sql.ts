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
 * These are fragments, never whole statements, and they interpolate no user
 * input — every value still travels as a bound parameter.
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
