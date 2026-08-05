/**
 * AutoScheduleService unit tests (F09).
 *
 * The orchestrator stitches a dozen SQL queries, the optimizer call and the
 * bulk-insert transaction together. The optimizer is mocked so the test stays
 * deterministic and the subject is the data plumbing.
 *
 * WHY THE POOL IS MOCKED BY QUERY AND NOT BY CALL ORDER. These tests used to
 * chain `mockResolvedValueOnce` in the order the service happens to issue its
 * reads. Every query added to the service then shifted every later response by
 * one, silently handing the shifts result to the employees read — and the
 * failure surfaced as a nonsense assertion far from its cause. That happened
 * four times in one week, once per feature that needed a new read. Dispatching
 * on a distinctive fragment of each statement makes the fixtures
 * order-independent, and an unrecognised query THROWS rather than returning
 * undefined, so the next new read announces itself instead of corrupting a
 * neighbour.
 */

import { AutoScheduleService } from '../services/AutoScheduleService';
import { ScheduleOptimizer } from '../optimization/ScheduleOptimizerORTools';
import { config } from '../config';
import { logger } from '../config/logger';

jest.mock('../optimization/ScheduleOptimizerORTools');

const makePool = () => {
  const execute = jest.fn();
  const conn = {
    execute: jest.fn(),
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
  };
  return {
    pool: { execute, getConnection: jest.fn().mockResolvedValue(conn) } as never,
    execute,
    conn,
  };
};

type Rows = Array<Record<string, unknown>>;

interface Fixtures {
  schedule?: Rows;
  deptOrgUnit?: Rows;
  loanedIn?: Rows;
  shifts?: Rows;
  employees?: Rows;
  pinned?: Rows;
  pairings?: Rows;
  contracts?: Rows;
  unavailability?: Rows;
  history?: Rows;
  predecessor?: Rows;
  external?: Rows;
  proposal?: Rows;
}

/**
 * Which fixture answers which statement.
 *
 * Ordered most-specific first: several of these read `shift_assignments`, so
 * the fragment identifying one must not also appear in another. The
 * predecessor lookup and the schedule read both select from `schedules`, hence
 * matching on a leading clause rather than the table name.
 */
const MATCHERS: Array<[keyof Fixtures, string]> = [
  ['schedule', 'FROM schedules WHERE id = ?'],
  ['predecessor', 'SELECT id FROM schedules'],
  ['deptOrgUnit', 'SELECT org_unit_id FROM departments'],
  ['loanedIn', 'FROM employee_loans'],
  ['shifts', 'GROUP BY s.id'],
  ['employees', 'FROM users u'],
  ['pinned', 'sa.is_pinned = 1'],
  ['pairings', 'employee_pairings'],
  ['contracts', 'user_employment_contracts'],
  ['unavailability', 'user_unavailability'],
  ['history', 'INTERVAL 90 DAY'],
  ['external', "sc.status = 'published' OR sc.id = ?"],
  ['proposal', 'schedule_replan_proposals'],
];

const SCHEDULE_ROW = {
  id: 1,
  department_id: 3,
  start_date: '2026-05-01',
  end_date: '2026-05-31',
};

const SHIFT_ROW = {
  id: 10,
  date: '2026-05-01',
  start_time: '08:00',
  end_time: '16:00',
  min_staff: 1,
  max_staff: 5,
  department_id: 3,
  skill_names: '',
};

const EMPLOYEE_ROW = {
  id: 1,
  skill_names: '',
  max_hours_per_week: 40,
  min_hours_per_week: 0,
  max_consecutive_days: 5,
};

/**
 * Answers each read from the fixture that matches it.
 *
 * Everything defaults to empty, so a test states only what it is about. An
 * unmatched statement throws by design — see the file header.
 */
const primeQueries = (execute: jest.Mock, fixtures: Fixtures = {}) => {
  const table: Fixtures = {
    schedule: [SCHEDULE_ROW],
    // No org-unit bridge by default — the loan pool then stays untouched,
    // matching every existing test's expectations unless a test opts in.
    deptOrgUnit: [],
    loanedIn: [],
    shifts: [SHIFT_ROW],
    employees: [EMPLOYEE_ROW],
    ...fixtures,
  };
  execute.mockImplementation(async (sql: string) => {
    const hit = MATCHERS.find(([, fragment]) => sql.includes(fragment));
    if (!hit) throw new Error(`no fixture matches this query:\n${sql}`);
    return [table[hit[0]] ?? [], null];
  });
};

/** The call the service made for a given read, as `[sql, params]`. */
const queryFor = (execute: jest.Mock, key: keyof Fixtures): [string, unknown[]] => {
  const fragment = MATCHERS.find(([name]) => name === key)![1];
  const call = execute.mock.calls.find((c) => String(c[0]).includes(fragment));
  if (!call) throw new Error(`the service never issued the ${key} query`);
  return call as [string, unknown[]];
};

const wasQueried = (execute: jest.Mock, key: keyof Fixtures): boolean => {
  const fragment = MATCHERS.find(([name]) => name === key)![1];
  return execute.mock.calls.some((c) => String(c[0]).includes(fragment));
};

/**
 * The problem the optimizer was handed, whichever engine ran.
 *
 * Tests placed inside the "engine selection" describe inherit its
 * OPTIMIZATION_ENGINE, so asserting against `generateGreedySchedule` alone
 * passes locally and fails in CI when or-tools is selected and the greedy is
 * never called. Reading from whichever path received the call makes the
 * assertion about the PROBLEM, which is the subject, rather than about engine
 * selection, which is not.
 */
const lastProblemGiven = (): any => {
  const instance = (ScheduleOptimizer as jest.Mock).mock.results.at(-1)!.value;
  const call =
    instance.generateGreedySchedule.mock.calls.at(-1) ?? instance.optimize.mock.calls.at(-1);
  if (!call) throw new Error('the optimizer was never called');
  return call[0];
};

describe('AutoScheduleService.generate', () => {
  const originalEngine = config.optimization.engine;

  beforeEach(() => {
    // These plumbing tests assert on the greedy path; select it explicitly so
    // the default 'or-tools' route (which would call optimize()) is bypassed.
    config.optimization.engine = 'greedy';
    (ScheduleOptimizer as jest.Mock).mockImplementation(() => ({
      generateGreedySchedule: jest.fn().mockResolvedValue([
        { shiftId: '10', employeeId: '1' },
        { shiftId: '11', employeeId: '2' },
      ]),
      optimize: jest.fn().mockResolvedValue({
        status: 'OPTIMAL',
        assignments: [
          { shiftId: '10', employeeId: '1' },
          { shiftId: '11', employeeId: '2' },
        ],
      }),
    }));
  });

  afterEach(() => {
    config.optimization.engine = originalEngine;
  });

  it('throws when the schedule does not exist', async () => {
    const { pool, execute } = makePool();
    primeQueries(execute, { schedule: [] });
    await expect(new AutoScheduleService(pool).generate(99, 1)).rejects.toThrow(
      /Schedule not found/
    );
  });

  it('returns EMPTY when the schedule has no shifts', async () => {
    const { pool, execute } = makePool();
    primeQueries(execute, { shifts: [] });
    const out = await new AutoScheduleService(pool).generate(1, 7);
    expect(out.status).toBe('EMPTY');
    expect(out.totalShifts).toBe(0);
    expect(out.assignmentsCreated).toBe(0);
  });

  it('runs the optimizer and persists each returned assignment', async () => {
    const { pool, conn, execute } = makePool();
    primeQueries(execute, {
      shifts: [
        { ...SHIFT_ROW, min_staff: 2, skill_names: 'Triage' },
        {
          ...SHIFT_ROW,
          id: 11,
          start_time: '16:00',
          end_time: '23:59',
          max_staff: 4,
          skill_names: null,
        },
      ],
      employees: [{ ...EMPLOYEE_ROW, skill_names: 'Triage' }],
    });
    conn.execute.mockResolvedValue([{ affectedRows: 2 }, null]);

    const out = await new AutoScheduleService(pool).generate(1, 7);

    expect(out.status).toBe('OK');
    expect(out.totalShifts).toBe(2);
    expect(out.assignmentsCreated).toBe(2);
    expect(out.coveragePercentage).toBe(100);
    expect(out.engine).toBe('greedy');
    expect(out.degraded).toBe(false);
    expect(conn.commit).toHaveBeenCalled();
  });

  /**
   * Approving an employee loan must actually change who is schedulable, not
   * just the loan row's own status. `departments.org_unit_id` bridges a
   * loan's org-unit scope to the shift's department scope, so a person on an
   * approved loan INTO that org unit must be a scheduling candidate exactly
   * like a real department member — even though they have no
   * `user_departments` row.
   */
  it('admits a person on an approved loan into the bridged org unit as a candidate', async () => {
    const { pool, conn, execute } = makePool();
    primeQueries(execute, {
      deptOrgUnit: [{ org_unit_id: 55 }],
      loanedIn: [{ user_id: 42 }],
      employees: [EMPLOYEE_ROW, { ...EMPLOYEE_ROW, id: 42, skill_names: '' }],
    });
    conn.execute.mockResolvedValue([{ affectedRows: 1 }, null]);

    await new AutoScheduleService(pool).generate(1, 7);

    const [sql, params] = queryFor(execute, 'loanedIn');
    expect(sql).toMatch(/to_org_unit_id = \?/);
    expect(params[0]).toBe(55);

    const [empSql] = queryFor(execute, 'employees');
    expect(empSql).toMatch(/LEFT JOIN user_departments ud/);
    expect(empSql).toMatch(/u\.id IN \(42\)/);

    const problem = lastProblemGiven();
    expect(problem.employees.map((e: any) => e.id)).toEqual(expect.arrayContaining(['1', '42']));
  });

  it('skips the loan lookup entirely when the department has no org-unit bridge', async () => {
    const { pool, conn, execute } = makePool();
    primeQueries(execute, { deptOrgUnit: [] });
    conn.execute.mockResolvedValue([{ affectedRows: 1 }, null]);

    await new AutoScheduleService(pool).generate(1, 7);

    expect(wasQueried(execute, 'loanedIn')).toBe(false);
  });

  /**
   * A PUBLISHED schedule is not re-planned in place. Applying first and
   * reporting afterwards means the change to people's commitments has already
   * happened by the time the planner can judge it — so the run records a plan
   * and writes nothing.
   */
  it('proposes rather than applies when the schedule is published', async () => {
    const { pool, conn, execute } = makePool();
    primeQueries(execute, {
      schedule: [{ ...SCHEDULE_ROW, status: 'published' }],
      proposal: [
        {
          id: 44,
          schedule_id: 1,
          proposed_by: 7,
          status: 'pending',
          engine: 'greedy',
          payload: JSON.stringify({
            assignments: [{ shiftId: 10, userId: 1 }],
            brokenCommitments: [],
            keptCommitments: 0,
            totalShifts: 1,
          }),
          decided_by: null,
          decision_reason: null,
          created_at: 't',
        },
      ],
    });
    // The proposal's own transaction (supersede + insert).
    conn.execute
      .mockResolvedValueOnce([{ affectedRows: 0 }, null])
      .mockResolvedValueOnce([{ insertId: 44 }, null]);

    const out = await new AutoScheduleService(pool).generate(1, 7);

    expect(out.status).toBe('PROPOSED');
    expect(out.proposalId).toBe(44);
    // Nothing was created. Reporting the proposed count here would say work
    // happened that has not.
    expect(out.assignmentsCreated).toBe(0);
    expect(
      conn.execute.mock.calls.some((c) => String(c[0]).includes('INTO shift_assignments'))
    ).toBe(false);
  });

  it('persists with one multi-row INSERT and counts only rows actually inserted', async () => {
    const { pool, conn, execute } = makePool();
    primeQueries(execute, {
      shifts: [SHIFT_ROW, { ...SHIFT_ROW, id: 11 }],
      employees: [EMPLOYEE_ROW, { ...EMPLOYEE_ROW, id: 2 }],
    });
    // INSERT IGNORE skipped one row (a duplicate assignment already existed).
    conn.execute.mockResolvedValue([{ affectedRows: 1 }, null]);

    const out = await new AutoScheduleService(pool).generate(1, 7);

    // Two assignments -> ONE statement with two value groups, not two statements.
    expect(conn.execute).toHaveBeenCalledTimes(1);
    const [sql, params] = conn.execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/VALUES \(\?, \?, \?, \?\), \(\?, \?, \?, \?\)/);
    expect(params).toHaveLength(8); // 4 bound values per row

    // ...and the count reflects rows the database actually inserted, so an
    // IGNOREd duplicate is not reported as created.
    expect(out.assignmentsCreated).toBe(1);
  });

  /**
   * A month is not independent of the one before it: rest, consecutive days
   * and weekly hours all run across the boundary. WHICH schedule precedes this
   * one used to be answered by taking every other schedule in the window with
   * no filter on its status, so drafts and abandoned generations counted
   * alongside what actually happened.
   */
  describe('boundary continuity', () => {
    it('reads only published schedules plus the resolved predecessor', async () => {
      const { pool, conn, execute } = makePool();
      primeQueries(execute, { predecessor: [{ id: 77 }] });
      conn.execute.mockResolvedValue([{ affectedRows: 1 }, null]);

      await new AutoScheduleService(pool).generate(1, 7);

      const [sql, params] = queryFor(execute, 'external');
      // A draft that is not the chosen predecessor must stop constraining
      // anything: at most one of several candidate generations will ever be
      // published, and counting them all inflates one person's history at the
      // boundary by however many exist.
      expect(sql).toContain("sc.status = 'published' OR sc.id = ?");
      expect(params[1]).toBe(77);
    });

    it('prefers the schedule the manager chose over the default', async () => {
      const { pool, conn, execute } = makePool();
      primeQueries(execute, { schedule: [{ ...SCHEDULE_ROW, previous_schedule_id: 42 }] });
      conn.execute.mockResolvedValue([{ affectedRows: 1 }, null]);

      await new AutoScheduleService(pool).generate(1, 7);

      // The default lookup is skipped entirely: an explicit choice is the
      // answer, and when several generations cover the period only the manager
      // knows which one happened.
      expect(wasQueried(execute, 'predecessor')).toBe(false);
      expect(queryFor(execute, 'external')[1][1]).toBe(42);
    });

    it('resolves the default from published schedules ending before this one starts', async () => {
      const { pool, conn, execute } = makePool();
      primeQueries(execute, { predecessor: [{ id: 77 }] });
      conn.execute.mockResolvedValue([{ affectedRows: 1 }, null]);

      await new AutoScheduleService(pool).generate(1, 7);

      const [sql, params] = queryFor(execute, 'predecessor');
      // Published, because an unpublished draft is not what happened — and
      // defaulting to one would silently pick a single candidate generation
      // out of several, which is what the explicit column exists to prevent.
      expect(sql).toContain("status = 'published'");
      expect(sql).toContain('end_date <');
      expect(params).toEqual([3, 1, '2026-05-01']);
    });

    it('matches nothing rather than dropping the filter when there is no predecessor', async () => {
      const { pool, conn, execute } = makePool();
      primeQueries(execute);
      conn.execute.mockResolvedValue([{ affectedRows: 1 }, null]);

      await new AutoScheduleService(pool).generate(1, 7);

      // A NULL here would make `sc.id = NULL` unknown and silently drop the
      // OR branch — the same result by accident rather than by intent, and
      // the wrong one the day the branch matters.
      expect(queryFor(execute, 'external')[1][1]).toBe(0);
    });
  });

  /**
   * Equity measured across months rather than reset by each one.
   *
   * Without carried history "weekend work is spread evenly" was true of every
   * month in isolation and could be false of the year: the same person could
   * take the unpopular end every month with nothing in the objective noticing.
   */
  describe('carried equity history', () => {
    const twoEmployees = { employees: [EMPLOYEE_ROW, { ...EMPLOYEE_ROW, id: 2 }] };

    it('reads the horizon from published schedules only, before this period', async () => {
      const { pool, conn, execute } = makePool();
      primeQueries(execute, twoEmployees);
      conn.execute.mockResolvedValue([{ affectedRows: 1 }, null]);

      await new AutoScheduleService(pool).generate(1, 7);

      const [sql, params] = queryFor(execute, 'history');
      // A draft's weekends would otherwise follow someone into the next month
      // having never been worked.
      expect(sql).toContain("sc.status = 'published'");
      expect(sql).toContain('INTERVAL 90 DAY');
      expect(sql).toContain('s.date < ?');
      expect(params).toEqual([1, '2026-05-01', '2026-05-01']);
    });

    it("carries a deviation from the candidates' average, not a raw count", async () => {
      const { pool, conn, execute } = makePool();
      primeQueries(execute, {
        ...twoEmployees,
        // Employee 1 worked two weekend days; employee 2 worked none.
        history: [
          { user_id: 1, date: '2026-04-04', start_time: '08:00', end_time: '16:00' },
          { user_id: 1, date: '2026-04-05', start_time: '08:00', end_time: '16:00' },
        ],
      });
      conn.execute.mockResolvedValue([{ affectedRows: 1 }, null]);

      await new AutoScheduleService(pool).generate(1, 7);

      const problem = lastProblemGiven();
      // The average is 1, so the deviations are +1 and −1; normalised so the
      // least loaded sits at zero they become 2 and 0. The spread the
      // objective minimises is unchanged by that shift, and no load variable
      // needs a negative lower bound.
      expect(problem.employees[0].carried_load.weekend).toBe(2);
      expect(problem.employees[1].carried_load.weekend).toBe(0);
    });

    it('starts everyone level when the history is even', async () => {
      const { pool, conn, execute } = makePool();
      primeQueries(execute, {
        ...twoEmployees,
        history: [
          { user_id: 1, date: '2026-04-04', start_time: '08:00', end_time: '16:00' },
          { user_id: 2, date: '2026-04-05', start_time: '08:00', end_time: '16:00' },
        ],
      });
      conn.execute.mockResolvedValue([{ affectedRows: 1 }, null]);

      await new AutoScheduleService(pool).generate(1, 7);

      const problem = lastProblemGiven();
      // The point of a deviation: one weekend each is the same as none each.
      expect(problem.employees[0].carried_load.weekend).toBe(0);
      expect(problem.employees[1].carried_load.weekend).toBe(0);
    });

    it('counts a night shift as night history and not as weekend', async () => {
      const { pool, conn, execute } = makePool();
      primeQueries(execute, {
        ...twoEmployees,
        // A Wednesday 22:00–06:00: night, not weekend.
        history: [{ user_id: 1, date: '2026-04-08', start_time: '22:00', end_time: '06:00' }],
      });
      conn.execute.mockResolvedValue([{ affectedRows: 1 }, null]);

      await new AutoScheduleService(pool).generate(1, 7);

      const problem = lastProblemGiven();
      expect(problem.employees[0].carried_load.night).toBe(1);
      expect(problem.employees[0].carried_load.weekend).toBe(0);
    });

    it('counts a date once however many shifts it held', async () => {
      const { pool, conn, execute } = makePool();
      primeQueries(execute, {
        ...twoEmployees,
        history: [
          { user_id: 1, date: '2026-04-04', start_time: '08:00', end_time: '12:00' },
          { user_id: 1, date: '2026-04-04', start_time: '13:00', end_time: '17:00' },
        ],
      });
      conn.execute.mockResolvedValue([{ affectedRows: 1 }, null]);

      await new AutoScheduleService(pool).generate(1, 7);

      // The unit is what the person loses: two shifts on one Saturday cost one
      // Saturday, the same unit the in-period measure uses.
      expect(lastProblemGiven().employees[0].carried_load.weekend).toBe(1);
    });

    it('does not query history at all when there are no candidates', async () => {
      const { pool, conn, execute } = makePool();
      primeQueries(execute, { employees: [] });
      conn.execute.mockResolvedValue([{ affectedRows: 0 }, null]);

      await new AutoScheduleService(pool).generate(1, 7);

      // The id list is interpolated, so an empty one would produce `IN ()` —
      // a syntax error rather than an empty result.
      expect(wasQueried(execute, 'history')).toBe(false);
    });
  });

  it('rolls back when an INSERT fails', async () => {
    const { pool, conn, execute } = makePool();
    primeQueries(execute);
    conn.execute.mockRejectedValue(new Error('insert failed'));

    await expect(new AutoScheduleService(pool).generate(1, 7)).rejects.toThrow(/insert failed/);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('expands an unavailability date range into a per-day list per user', async () => {
    const { pool, conn, execute } = makePool();
    primeQueries(execute, {
      employees: [{ ...EMPLOYEE_ROW, id: 7 }],
      unavailability: [
        {
          user_id: 7,
          start_date: new Date('2026-05-01T00:00:00Z'),
          end_date: new Date('2026-05-03T00:00:00Z'),
        },
      ],
    });
    conn.execute.mockResolvedValue([{ affectedRows: 2 }, null]);

    await new AutoScheduleService(pool).generate(1, 1);

    expect(lastProblemGiven().employees[0].unavailable_dates).toEqual([
      '2026-05-01',
      '2026-05-02',
      '2026-05-03',
    ]);
  });

  it('feeds other-schedule assignments into the optimizer as busy time', async () => {
    // The ±14-day window query exists so the engines see cross-schedule
    // commitments; this pins the per-user grouping of those rows.
    const { pool, conn, execute } = makePool();
    primeQueries(execute, {
      external: [
        { user_id: 1, date: '2026-05-01', start_time: '08:00', end_time: '16:00' },
        { user_id: 1, date: '2026-05-02', start_time: '08:00', end_time: '16:00' },
      ],
    });
    conn.execute.mockResolvedValue([{ affectedRows: 1 }, null]);

    await new AutoScheduleService(pool).generate(1, 7);

    expect(lastProblemGiven().employees[0].existing_assignments).toEqual([
      { date: '2026-05-01', start_time: '08:00', end_time: '16:00' },
      { date: '2026-05-02', start_time: '08:00', end_time: '16:00' },
    ]);
  });
});

describe('AutoScheduleService.generate — engine selection and fallback signalling', () => {
  const originalEngine = config.optimization.engine;

  afterEach(() => {
    config.optimization.engine = originalEngine;
  });

  it('reports engine="or-tools", not degraded, when CP-SAT solves', async () => {
    config.optimization.engine = 'or-tools';
    const optimize = jest.fn().mockResolvedValue({
      status: 'OPTIMAL',
      assignments: [{ shiftId: '10', employeeId: '1' }],
    });
    const generateGreedySchedule = jest.fn();
    (ScheduleOptimizer as jest.Mock).mockImplementation(() => ({
      optimize,
      generateGreedySchedule,
    }));

    const { pool, conn, execute } = makePool();
    primeQueries(execute);
    conn.execute.mockResolvedValue([{ affectedRows: 1 }, null]);

    const out = await new AutoScheduleService(pool).generate(1, 7);

    expect(optimize).toHaveBeenCalled();
    expect(generateGreedySchedule).not.toHaveBeenCalled();
    expect(out.engine).toBe('or-tools');
    expect(out.degraded).toBe(false);
    expect(out.degradedReason).toBeUndefined();
  });

  it('signals a degraded greedy fallback when CP-SAT is unavailable', async () => {
    config.optimization.engine = 'or-tools';
    // optimize() runs its own greedy fallback internally and reports it.
    const optimize = jest.fn().mockResolvedValue({
      status: 'GREEDY_FALLBACK',
      assignments: [{ shiftId: '10', employeeId: '1' }],
      error: 'python3 not found',
    });
    (ScheduleOptimizer as jest.Mock).mockImplementation(() => ({
      optimize,
      generateGreedySchedule: jest.fn(),
    }));

    const { pool, conn, execute } = makePool();
    primeQueries(execute);
    conn.execute.mockResolvedValue([{ affectedRows: 1 }, null]);

    const out = await new AutoScheduleService(pool).generate(1, 7);

    expect(out.engine).toBe('greedy');
    expect(out.degraded).toBe(true);
    expect(out.degradedReason).toContain('python3 not found');
  });

  it('uses the greedy draft engine directly (not degraded) when selected explicitly', async () => {
    config.optimization.engine = 'greedy';
    const optimize = jest.fn();
    const generateGreedySchedule = jest.fn().mockResolvedValue([{ shiftId: '10', employeeId: '1' }]);
    (ScheduleOptimizer as jest.Mock).mockImplementation(() => ({
      optimize,
      generateGreedySchedule,
    }));

    const { pool, conn, execute } = makePool();
    primeQueries(execute);
    conn.execute.mockResolvedValue([{ affectedRows: 1 }, null]);

    const out = await new AutoScheduleService(pool).generate(1, 7);

    expect(generateGreedySchedule).toHaveBeenCalled();
    expect(optimize).not.toHaveBeenCalled();
    expect(out.engine).toBe('greedy');
    expect(out.degraded).toBe(false);
  });

  /**
   * The diff is the deliverable, so both halves of it need covering — and the
   * broken half is the one that matters. A published assignment that
   * disappears is someone who was told they were working and now is not; a
   * re-solve must never do that silently.
   */
  it('reports commitments kept and broken, and warns about the broken ones', async () => {
    const { pool, conn, execute } = makePool();
    primeQueries(execute, {
      shifts: [SHIFT_ROW, { ...SHIFT_ROW, id: 11, date: '2026-05-02' }],
      // Two published commitments; the optimizer below returns only the first.
      pinned: [
        { user_id: 1, shift_id: 10 },
        { user_id: 1, shift_id: 11 },
      ],
    });
    conn.execute.mockResolvedValue([{ affectedRows: 1 }, null]);

    // Both engine paths return the same single assignment, so this test does
    // not depend on which one the ambient OPTIMIZATION_ENGINE selects — the
    // subject is the diff, not engine selection.
    const kept = [
      {
        employeeId: '1',
        shiftId: '10',
        date: '2026-05-01',
        startTime: '08:00',
        endTime: '16:00',
        hours: 8,
      },
    ];
    (ScheduleOptimizer as jest.Mock).mockImplementation(() => ({
      generateGreedySchedule: jest.fn().mockResolvedValue(kept),
      optimize: jest.fn().mockResolvedValue({
        status: 'OPTIMAL',
        assignments: kept,
        statistics: { isOptimal: true },
      }),
    }));

    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    const result = await new AutoScheduleService(pool).generate(1, 1);

    expect(result.keptCommitments).toBe(1);
    expect(result.brokenCommitments).toEqual([{ userId: 1, shiftId: 11 }]);
    // Named in the log, not merely counted: the affected person is the point.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('affected users: 1'));
    warn.mockRestore();
  });

  it('ignores malformed skill and qualification lists from the database', async () => {
    // GROUP_CONCAT emits an empty segment when a nullable column is NULL, so
    // rows that state no requirement arrive as "name:" or "name::". Those must
    // be skipped rather than parsed as level 0, which would silently
    // disqualify everyone.
    const { pool, conn, execute } = makePool();
    primeQueries(execute, {
      shifts: [
        { ...SHIFT_ROW, skill_names: 'Triage', skill_levels: 'Triage:', qualified_staff: 'Triage::' },
      ],
      employees: [{ ...EMPLOYEE_ROW, skill_names: 'Triage', skill_levels: 'Triage:' }],
    });
    conn.execute.mockResolvedValue([{ affectedRows: 0 }, null]);

    await new AutoScheduleService(pool).generate(1, 1);

    const problem = lastProblemGiven();
    expect(problem.shifts[0].required_skill_levels).toEqual({});
    expect(problem.shifts[0].qualified_staff).toEqual({});
    expect(problem.employees[0].skill_levels).toEqual({});
  });

  it('carries well-formed skill levels and qualification requirements through', async () => {
    // The counterpart of the malformed case: the parsers must still populate
    // when the columns ARE set, or the previous test would pass against a
    // parser that simply returned nothing.
    const { pool, conn, execute } = makePool();
    primeQueries(execute, {
      shifts: [
        {
          ...SHIFT_ROW,
          skill_names: 'Triage',
          skill_levels: 'Triage:3',
          qualified_staff: 'Triage:5:1',
        },
      ],
      employees: [{ ...EMPLOYEE_ROW, skill_names: 'Triage', skill_levels: 'Triage:4' }],
    });
    conn.execute.mockResolvedValue([{ affectedRows: 0 }, null]);

    await new AutoScheduleService(pool).generate(1, 1);

    const problem = lastProblemGiven();
    expect(problem.shifts[0].required_skill_levels).toEqual({ Triage: 3 });
    expect(problem.shifts[0].qualified_staff).toEqual({ Triage: { level: 5, count: 1 } });
    expect(problem.employees[0].skill_levels).toEqual({ Triage: 4 });
  });

  /**
   * `hourly_rate` steers the solver's search only — it must reach the
   * problem handed to the optimizer (so the objective can use it), but must
   * never reach anything an unprivileged caller can read: the method's own
   * return value, which is what routes actually send back as the HTTP
   * response.
   */
  describe('hourly_rate: internal to the solver, never returned to the caller', () => {
    it('carries the rate into the problem given to the optimizer', async () => {
      const { pool, conn, execute } = makePool();
      primeQueries(execute, { employees: [{ ...EMPLOYEE_ROW, hourly_rate: '15.50' }] });
      conn.execute.mockResolvedValue([{ affectedRows: 0 }, null]);

      await new AutoScheduleService(pool).generate(1, 1);

      // DECIMAL columns arrive from mysql2 as strings; the service must
      // convert, not forward the raw string as if it were the number.
      expect(lastProblemGiven().employees[0].hourly_rate).toBe(15.5);
    });

    it('omits the field rather than inventing zero when the column is null', async () => {
      const { pool, conn, execute } = makePool();
      primeQueries(execute, { employees: [{ ...EMPLOYEE_ROW, hourly_rate: null }] });
      conn.execute.mockResolvedValue([{ affectedRows: 0 }, null]);

      await new AutoScheduleService(pool).generate(1, 1);

      expect(lastProblemGiven().employees[0].hourly_rate).toBeUndefined();
    });

    it('never appears anywhere in what generate() returns to its caller', async () => {
      const { pool, conn, execute } = makePool();
      primeQueries(execute, { employees: [{ ...EMPLOYEE_ROW, hourly_rate: '99.00' }] });
      conn.execute.mockResolvedValue([{ affectedRows: 0 }, null]);

      const result = await new AutoScheduleService(pool).generate(1, 1);

      expect(JSON.stringify(result)).not.toContain('99');
      expect(result).not.toHaveProperty('hourly_rate');
    });
  });
});
