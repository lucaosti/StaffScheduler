/**
 * N+1 regression guard for the list endpoints (issue #321).
 *
 * The concern #321 raised is that a list of N rows might trigger N per-row
 * sub-queries. These services fetch each list with a single JOINed query, and
 * this asserts that directly: given a multi-row result, the pool is queried a
 * bounded number of times that does NOT scale with the row count. If someone
 * later adds a per-row lookup inside the row mapper, the count jumps and this
 * fails.
 *
 * The mock returns the same multi-row payload for every call, so an N+1 pattern
 * would issue one query per returned row and the assertion would catch it. The
 * bound is expressed as a constant, not a range, so it is unambiguous what the
 * query budget is.
 */
import { ShiftService } from '../services/ShiftService';
import { ScheduleService } from '../services/ScheduleService';
import { UserService } from '../services/UserService';

const rows = (n: number): Record<string, unknown>[] =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    schedule_id: 1,
    department_id: 1,
    date: '2026-05-01',
    start_time: '09:00',
    end_time: '17:00',
    min_staff: 1,
    max_staff: 3,
    status: 'open',
    name: `row-${i}`,
    start_date: '2026-05-01',
    end_date: '2026-05-31',
    email: `u${i}@x.com`,
    first_name: 'A',
    last_name: 'B',
    is_active: 1,
  }));

/** A pool whose every query resolves to the same multi-row result. */
const countingPool = () => {
  const execute = jest.fn().mockResolvedValue([rows(25), null]);
  return { pool: { execute } as never, execute };
};

describe('list endpoints do not scale queries with row count (N+1 guard)', () => {
  it('ShiftService.getAllShifts issues exactly one query for the list', async () => {
    const { pool, execute } = countingPool();
    await new ShiftService(pool).getAllShifts();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('ScheduleService.getAllSchedules issues exactly one query for the list', async () => {
    const { pool, execute } = countingPool();
    await new ScheduleService(pool).getAllSchedules();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('UserService.getAllUsers issues exactly one query for the list', async () => {
    const { pool, execute } = countingPool();
    await new UserService(pool).getAllUsers();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('the guard would trip on an N+1 mapper: 25 rows never become 25 queries', async () => {
    // Documents the intent: whichever list is measured, the count is 1, far
    // below the 25 rows returned. A per-row query would make these equal.
    const { pool, execute } = countingPool();
    await new ShiftService(pool).getAllShifts();
    expect(execute.mock.calls.length).toBeLessThan(25);
  });
});
