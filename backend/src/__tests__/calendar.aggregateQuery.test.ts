/**
 * The SQL the aggregate feed builds.
 *
 * The route decides WHAT the scope is; this decides whether the query honours
 * it. The two failures worth pinning are the ones that silently publish too
 * much: an empty scope array read as "no filter", and a per-person filter
 * applied as a join condition — which would keep the shift and drop its other
 * assignees, so the event understates who is on duty while looking complete.
 *
 * @author Luca Ostinelli
 */

import { CalendarService } from '../services/CalendarService';

export {};

const makePool = (rows: unknown[] = []) => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = jest.fn(async (sql: string, params: unknown[]) => {
    calls.push({ sql, params });
    return [rows, []];
  });
  return { pool: { query, execute: query } as never, calls };
};

const build = async (
  options: Parameters<CalendarService['buildAggregateFeed']>[0],
  rows: unknown[] = []
) => {
  const { pool, calls } = makePool(rows);
  const result = await new CalendarService(pool).buildAggregateFeed(options);
  return { result, calls };
};

const shiftRow = (over: Record<string, unknown> = {}) => ({
  shift_id: 11,
  date: '2026-07-30',
  start_time: '08:00:00',
  end_time: '16:00:00',
  notes: null,
  schedule_name: 'July',
  department_name: 'Ward A',
  shift_updated: '2026-07-01 10:00:00',
  assignees: 'Anna Rossi,Luca Verdi',
  ...over,
});

describe('the org-unit scope', () => {
  it('adds no unit clause when unrestricted', async () => {
    const { calls } = await build({ visibleOrgUnitIds: null });
    expect(calls[0].sql).not.toContain('d.org_unit_id IN');
  });

  it('binds the units when scoped', async () => {
    const { calls } = await build({ visibleOrgUnitIds: [3, 4] });

    expect(calls[0].sql).toContain('d.org_unit_id IN (?,?)');
    expect(calls[0].params).toEqual(expect.arrayContaining([3, 4]));
  });

  it('returns an EMPTY calendar for a scope that resolves to nothing', async () => {
    const { result, calls } = await build({ visibleOrgUnitIds: [] });

    // Falling through to an unfiltered query here is how a restriction becomes
    // its opposite — and it would publish the whole organization.
    expect(calls).toHaveLength(0);
    expect(result.body).toContain('BEGIN:VCALENDAR');
    expect(result.body).not.toContain('BEGIN:VEVENT');
  });

  it('cannot be widened by a department filter', async () => {
    const { calls } = await build({ visibleOrgUnitIds: [3], departmentIds: [99] });

    // Both clauses are present and ANDed: asking for a department outside the
    // scope narrows the result to nothing rather than reaching it.
    expect(calls[0].sql).toContain('d.org_unit_id IN');
    expect(calls[0].sql).toContain('s.department_id IN');
  });
});

describe('the person and role filters', () => {
  it('uses EXISTS for people, so the other assignees survive', async () => {
    const { calls } = await build({ visibleOrgUnitIds: null, userIds: [7] });

    // Filtering the joined assignment rows would keep the shift and drop
    // everyone else from its description: the event would say "1 on duty" for a
    // shift with four people on it.
    expect(calls[0].sql).toContain('EXISTS (SELECT 1 FROM shift_assignments fa');
    expect(calls[0].sql).toContain("sa.status IN ('pending','confirmed')");
  });

  it('matches a role through unexpired grants only', async () => {
    const { calls } = await build({ visibleOrgUnitIds: null, roleIds: [2] });

    // A lapsed grant must not keep pulling someone into a role's calendar.
    expect(calls[0].sql).toMatch(/ur\.expires_at IS NULL OR ur\.expires_at > NOW\(\)/);
  });

  it('counts only pending and confirmed assignments', async () => {
    const { calls } = await build({ visibleOrgUnitIds: null });
    // A cancelled assignment is not someone being on duty.
    expect(calls[0].sql).toContain("sa.status IN ('pending','confirmed')");
  });
});

describe('the date range', () => {
  it('reaches backward as well as forward', async () => {
    const { calls } = await build({ visibleOrgUnitIds: null });

    // The department feed started at CURDATE(), so a subscribed calendar had no
    // memory: it could not answer "who was on that Tuesday" once Tuesday passed.
    expect(calls[0].sql).toContain('DATE_SUB(CURDATE(), INTERVAL ? DAY)');
    expect(calls[0].sql).toContain('DATE_ADD(CURDATE(), INTERVAL ? DAY)');
    expect(calls[0].params.slice(0, 2)).toEqual([7, 30]);
  });

  it('honours an explicit range', async () => {
    const { calls } = await build({ visibleOrgUnitIds: null, pastDays: 90, futureDays: 1 });
    expect(calls[0].params.slice(0, 2)).toEqual([90, 1]);
  });
});

describe('the ETag', () => {
  it('differs between two differently-filtered feeds', async () => {
    const a = await build({ visibleOrgUnitIds: null, departmentIds: [1] });
    const b = await build({ visibleOrgUnitIds: null, departmentIds: [2] });

    // Otherwise one filtered feed answers 304 to the other's If-None-Match and
    // a client shows the wrong calendar indefinitely.
    expect(a.result.etag).not.toBe(b.result.etag);
  });

  it('is stable for the same filters', async () => {
    const a = await build({ visibleOrgUnitIds: [3], roleIds: [1] });
    const b = await build({ visibleOrgUnitIds: [3], roleIds: [1] });
    expect(a.result.etag).toBe(b.result.etag);
  });
});

describe('the events it emits', () => {
  it('names the department and how many people are on duty', async () => {
    const { result } = await build({ visibleOrgUnitIds: null }, [shiftRow()]);

    expect(result.body).toContain('BEGIN:VEVENT');
    expect(result.body).toContain('Ward A');
    expect(result.body).toContain('2 on duty');
    expect(result.body).toContain('Anna Rossi');
  });

  it('uses a UID distinct from the department feed\'s', async () => {
    const { result } = await build({ visibleOrgUnitIds: null }, [shiftRow()]);

    // Subscribing to both must not make a client treat the two events as one
    // and drop whichever arrived second.
    expect(result.body).toContain('agg-shift-11@staffscheduler');
    expect(result.body).not.toContain('dept-shift-11@staffscheduler');
  });

  it('says so when a shift has nobody on it', async () => {
    const { result } = await build({ visibleOrgUnitIds: null }, [shiftRow({ assignees: null })]);

    // An unassigned shift is the one a planner most needs to see in a calendar.
    expect(result.body).toContain('0 on duty');
    expect(result.body).toContain('Unassigned');
  });

  it('prefers the shift note over the schedule name in the description', async () => {
    const { result } = await build(
      { visibleOrgUnitIds: null },
      [shiftRow({ notes: 'Bring the keys' })]
    );
    expect(result.body).toContain('Bring the keys');
  });

  it('handles a Date from the driver without shifting the day', async () => {
    // A DATE column can arrive as a `Date`; formatting it through UTC would
    // move a European date back a day.
    const { result } = await build(
      { visibleOrgUnitIds: null },
      [shiftRow({ date: new Date(2026, 6, 30) })]
    );
    expect(result.body).toContain('20260730');
  });

  it('falls back to a generic "Shift" summary and blank location when the department has no name', async () => {
    const { result } = await build({ visibleOrgUnitIds: null }, [shiftRow({ department_name: null })]);
    expect(result.body).toContain('Shift — 2 on duty');
  });

  it('changes its ETag when the newest shift changes', async () => {
    const a = await build({ visibleOrgUnitIds: null }, [shiftRow()]);
    const b = await build({ visibleOrgUnitIds: null }, [shiftRow({ shift_updated: '2026-07-02 10:00:00' })]);
    expect(a.result.etag).not.toBe(b.result.etag);
  });
});
