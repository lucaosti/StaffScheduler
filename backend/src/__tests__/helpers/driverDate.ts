/**
 * Test helper: builds the `Date` mysql2 hands back for a `DATE` column.
 *
 * WHY THIS EXISTS. The pool sets neither `dateStrings` nor `timezone`, so
 * mysql2 materializes a `DATE` as a JS Date at LOCAL midnight. Fixtures that
 * stood in for the driver were written as `new Date('2033-04-01')` or
 * `new Date('2033-04-01T00:00:00Z')` — UTC midnight — which is the same
 * instant only when the process runs in UTC. That is exactly where CI runs,
 * so two different mistakes stayed invisible there:
 *
 *   - West of UTC the fixture is already "yesterday" on the local calendar,
 *     so a correct reader (`DateUtils.toDateString`, local components) was
 *     reported as broken: six suites failed for any contributor in the
 *     Americas while passing in CI.
 *   - East of UTC a reader that used `toISOString()` on the column rolled the
 *     date back a day in production, and the UTC-midnight fixture agreed with
 *     it — the test asserted the bug.
 *
 * A fixture that claims to be "what the driver returns" has to be built the
 * way the driver builds it, or the test is only as good as the timezone it
 * happens to run in. The CI timezone matrix is what keeps this honest.
 */

/** Local-midnight Date for a `YYYY-MM-DD` day, as mysql2 returns a DATE column. */
export const driverDate = (day: string): Date => {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date);
};
