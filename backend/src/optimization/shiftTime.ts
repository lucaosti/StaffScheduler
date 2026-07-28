/**
 * When a shift actually runs: the overnight-aware time arithmetic both
 * scheduling engines depend on.
 *
 * WHY THIS MODULE EXISTS. A shift is stored as a DATE plus two TIME columns,
 * so a 22:00–06:00 block has `end_time < start_time` and any naive comparison
 * reads it as ending before it begins. Every consumer that reasons about when
 * a shift runs must reconstruct the absolute interval first — and each was
 * doing it for itself. `constraintValidator` and `ScheduleOptimizerORTools`
 * carried byte-for-byte equivalent private copies, kept in step by a comment
 * reading "Matches ScheduleOptimizer._shiftBoundsMs".
 *
 * A comment is not a mechanism. `constraintValidator` is the single source of
 * truth for what a legal schedule is, and it cannot be that while the notion
 * of when a shift runs is re-derived beside it. Two overnight defects were
 * found in this area recently — conflict detection blind to midnight-crossing
 * overlaps, and dashboard aggregates returning negative hours — both from an
 * independent reimplementation of exactly this rule.
 *
 * WHY NOT ALSO THE PYTHON AND SQL COPIES. `schedule_optimizer.py` and
 * `utils/sql.ts` implement the same rule in other runtimes, and no shared
 * module can span them. That duplication is structural rather than accidental,
 * and the parity suite is what holds the Python copy to this one: it runs both
 * engines against the canonical validator, so a divergence in overnight
 * handling is a red test rather than a silent difference.
 *
 * ZERO-LENGTH SHIFTS SPAN A FULL DAY, in both readings. They disagreed when
 * this module was first extracted — bounds said 24 hours, hours said zero — a
 * discrepancy inherited from the copies it replaced and left in place then,
 * because changing semantics inside a consolidation would have hidden a
 * behavioural change. Reconciled since, toward 24 hours: for a cap,
 * over-counting refuses work that might have been allowed, while a zero-hour
 * shift is invisible to every limit, so someone could hold an unbounded number
 * of them. The request schemas reject `start === end`, so the shape can only
 * arrive by direct insert or a seed — which the seeds do, bypassing
 * validation, which is why the readers had to agree rather than the case being
 * dismissed as impossible.
 *
 * @author Luca Ostinelli
 */

/**
 * The shape any shift-like row must have for this arithmetic.
 *
 * Deliberately structural rather than the full `Shift`: the callers include
 * an employee's `existing_assignments`, which carry only a date and two times
 * and have no id. Demanding more than the arithmetic uses would force those
 * call sites to invent fields.
 */
export interface ShiftTimes {
  date: string;
  start_time: string;
  end_time: string;
}

export const DAY_MS = 86_400_000;

/** Minutes since midnight for "HH:MM" (or "HH:MM:SS"). */
export const timeToMinutes = (time: string): number => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

/**
 * UTC midnight of a "YYYY-MM-DD" date, in ms.
 *
 * Anchored to UTC on purpose: these values are only ever compared with each
 * other, so a consistent origin matters and the host's timezone must not.
 * Reading them back as local dates is the separate trap `DateUtils
 * .fromMySQLDate` exists for.
 */
export const dateToMs = (date: string): number => new Date(`${date}T00:00:00Z`).getTime();

/**
 * Absolute `[start, end]` timestamps, rolling an overnight shift's end into
 * the following day so a 22:00–06:00 block is one contiguous interval rather
 * than two fragments.
 */
export const shiftBoundsMs = (shift: ShiftTimes): [number, number] => {
  const day = dateToMs(shift.date);
  const start = day + timeToMinutes(shift.start_time) * 60_000;
  let end = day + timeToMinutes(shift.end_time) * 60_000;
  if (end <= start) end += DAY_MS;
  return [start, end];
};

/**
 * Duration in hours, overnight-aware, rounded to one decimal.
 *
 * Rounding is part of the contract rather than presentation: the greedy engine
 * accumulates these into daily and weekly totals compared against integer
 * caps, so both engines must round identically or the parity suite sees a
 * difference that is really a float artefact.
 */
export const shiftHours = (shift: ShiftTimes): number => {
  const start = timeToMinutes(shift.start_time);
  let end = timeToMinutes(shift.end_time);
  // `<=` and not `<`: a shift whose end equals its start spans a full day, the
  // same reading `shiftBoundsMs` and the SQL fragments already had.
  //
  // The two disagreed until now — bounds said 24 hours, hours said zero — and
  // this direction is the safe one. For a CAP, over-counting refuses work that
  // might have been allowed; under-counting permits work that should not be,
  // and a zero-hour shift is invisible to every limit, so someone could hold
  // an unbounded number of them.
  //
  // The request schemas reject `startTime === endTime`, so the shape can only
  // arrive by direct insert or a seed. Rejecting such a row outright on read
  // was considered — a shift that cannot be worked is arguably corrupt data
  // rather than a shift of some length — and not taken: it would change every
  // read path to guard against a case the write path already prevents.
  if (end <= start) end += 24 * 60;
  return Math.round(((end - start) / 60) * 10) / 10;
};
