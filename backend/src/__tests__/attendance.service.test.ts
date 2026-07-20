/**
 * AttendanceService unit tests.
 *
 * Uses a queueable mysql2 Pool fake, same pattern as timeOff.service.test.ts.
 */

import { AttendanceService } from '../services/AttendanceService';

type Tuple = [unknown, unknown];

const buildRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  user_id: 5,
  shift_assignment_id: null,
  clock_in: '2026-07-10T08:00:00.000Z',
  clock_out: null,
  status: 'pending',
  reviewer_id: null,
  reviewed_at: null,
  review_notes: null,
  notes: null,
  created_at: '2026-07-10T08:00:00.000Z',
  updated_at: '2026-07-10T08:00:00.000Z',
  ...overrides,
});

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute } as never, execute };
};

describe('AttendanceService.clockIn', () => {
  it('refuses to clock in when an open record already exists', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ id: 1 }], null] as Tuple); // open-record check

    const service = new AttendanceService(pool);
    await expect(service.clockIn(5)).rejects.toThrow(/open attendance record already exists/);
  });

  it('creates a pending record with no assignment link when the day is ambiguous', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[], null] as Tuple) // open-record check: none
      .mockResolvedValueOnce([[], null] as Tuple) // findTodaysAssignment: no unambiguous match
      .mockResolvedValueOnce([{ insertId: 10 }, null] as Tuple) // INSERT
      .mockResolvedValueOnce([[buildRow({ id: 10 })], null] as Tuple); // getById

    const service = new AttendanceService(pool);
    const created = await service.clockIn(5);

    expect(created.id).toBe(10);
    expect(created.status).toBe('pending');
    expect(execute.mock.calls[2][0]).toMatch(/INSERT INTO attendance_records/);
  });
});

describe('AttendanceService.clockOut', () => {
  it('refuses when the record belongs to another user', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple) // UPDATE matched 0
      .mockResolvedValueOnce([[buildRow({ user_id: 999 })], null] as Tuple); // getById

    const service = new AttendanceService(pool);
    await expect(service.clockOut(5, 1)).rejects.toThrow(/Forbidden/);
  });

  it('refuses to clock out an already-closed record', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple)
      .mockResolvedValueOnce([[buildRow({ user_id: 5, clock_out: '2026-07-10T16:00:00.000Z' })], null] as Tuple);

    const service = new AttendanceService(pool);
    await expect(service.clockOut(5, 1)).rejects.toThrow(/already clocked out/);
  });

  it('clocks out successfully', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple) // UPDATE
      .mockResolvedValueOnce([[buildRow({ clock_out: '2026-07-10T16:00:00.000Z' })], null] as Tuple); // getById

    const service = new AttendanceService(pool);
    const result = await service.clockOut(5, 1);
    expect(result.clockOut).toBe('2026-07-10T16:00:00.000Z');
  });
});

describe('AttendanceService.approve', () => {
  it('refuses to approve a record that is still clocked in', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple)
      .mockResolvedValueOnce([[buildRow({ clock_out: null })], null] as Tuple);

    const service = new AttendanceService(pool);
    await expect(service.approve(1, 99)).rejects.toThrow(/still clocked in/);
  });

  it('refuses to approve a record that is not pending', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple)
      .mockResolvedValueOnce([[buildRow({ clock_out: '2026-07-10T16:00:00.000Z', status: 'rejected' })], null] as Tuple);

    const service = new AttendanceService(pool);
    await expect(service.approve(1, 99)).rejects.toThrow(/Cannot approve record in status 'rejected'/);
  });

  it('approves a completed pending record', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple) // UPDATE
      .mockResolvedValueOnce([[buildRow({ clock_out: '2026-07-10T16:00:00.000Z', status: 'approved', reviewer_id: 99 })], null] as Tuple);

    const service = new AttendanceService(pool);
    const result = await service.approve(1, 99, 'looks fine');
    expect(result.status).toBe('approved');
    expect(result.reviewerId).toBe(99);
  });
});

describe('AttendanceService.reject', () => {
  it('rejects only when status is pending', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple)
      .mockResolvedValueOnce([[buildRow({ status: 'approved' })], null] as Tuple);

    const service = new AttendanceService(pool);
    await expect(service.reject(1, 99)).rejects.toThrow(/Cannot reject record in status 'approved'/);
  });
});

describe('AttendanceService.getCostEstimate', () => {
  it('combines planned and actual cost from separate aggregate queries', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ hours: '40.00', cost: '1000.00' }], null] as Tuple) // planned
      .mockResolvedValueOnce([[{ hours: '8.00', cost: '224.00' }], null] as Tuple); // actual

    const service = new AttendanceService(pool);
    const estimate = await service.getCostEstimate({ startDate: '2026-07-01', endDate: '2026-07-31' });

    expect(estimate.plannedHours).toBe(40);
    expect(estimate.plannedCost).toBe(1000);
    expect(estimate.actualHours).toBe(8);
    expect(estimate.actualCost).toBe(224);
  });
});

// ── Error ladders and list/estimate variants (coverage of every branch) ──────
// The affectedRows===0 ladders re-read the row to produce a precise typed
// error; each arm below pins one diagnosis so a refactor can't silently
// swap a 404 for a 409.

describe('AttendanceService.clockIn — failure diagnosis', () => {
  it('throws an internal error when the created row cannot be re-read', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[], null] as Tuple) // open-record check
      .mockResolvedValueOnce([[], null] as Tuple) // findTodaysAssignment
      .mockResolvedValueOnce([{ insertId: 10 }, null] as Tuple) // INSERT
      .mockResolvedValueOnce([[], null] as Tuple); // getById: gone

    await expect(new AttendanceService(pool).clockIn(5)).rejects.toThrow(
      'Failed to retrieve created attendance record'
    );
  });

  it('links the punch to an unambiguous shift assignment for today', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[], null] as Tuple) // open-record check
      .mockResolvedValueOnce([[{ id: 77 }], null] as Tuple) // one assignment today
      .mockResolvedValueOnce([{ insertId: 11 }, null] as Tuple)
      .mockResolvedValueOnce([[buildRow({ id: 11, shift_assignment_id: 77 })], null] as Tuple)
      .mockResolvedValue([{ insertId: 1 }, null] as Tuple); // audit insert

    const created = await new AttendanceService(pool).clockIn(5, 'note');

    expect(created.shiftAssignmentId).toBe(77);
    expect(execute.mock.calls[2][1]).toEqual([5, 77, 'note']);
  });
});

describe('AttendanceService.clockOut — failure diagnosis', () => {
  it('throws 404 when the record does not exist at all', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple) // UPDATE misses
      .mockResolvedValueOnce([[], null] as Tuple); // getById: nothing

    await expect(new AttendanceService(pool).clockOut(5, 99)).rejects.toThrow(
      'Attendance record not found'
    );
  });

  it('throws an internal error when the closed row cannot be re-read', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple) // UPDATE hits
      .mockResolvedValueOnce([[], null] as Tuple); // getById: gone

    await expect(new AttendanceService(pool).clockOut(5, 1)).rejects.toThrow(
      'Failed to retrieve clocked-out record'
    );
  });
});

describe('AttendanceService.list', () => {
  const run = async (filters: Parameters<AttendanceService['list']>[0]) => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildRow()], null] as Tuple);
    await new AttendanceService(pool).list(filters);
    return execute.mock.calls[0];
  };

  it('builds an unfiltered query with the hard row cap', async () => {
    const [sql, params] = await run({});
    expect(sql).not.toContain('WHERE');
    expect(sql).toContain('LIMIT 500');
    expect(params).toEqual([]);
  });

  it('filters by user', async () => {
    const [sql, params] = await run({ userId: 5 });
    expect(sql).toContain('user_id = ?');
    expect(params).toEqual([5]);
  });

  it('filters by status', async () => {
    const [sql, params] = await run({ status: 'approved' as never });
    expect(sql).toContain('status = ?');
    expect(params).toEqual(['approved']);
  });

  it('applies the date range only when both bounds are present', async () => {
    const [sqlBoth, paramsBoth] = await run({ rangeStart: '2026-07-01', rangeEnd: '2026-07-31' });
    expect(sqlBoth).toContain('DATE(clock_in) BETWEEN ? AND ?');
    expect(paramsBoth).toEqual(['2026-07-01', '2026-07-31']);

    const [sqlHalf] = await run({ rangeStart: '2026-07-01' });
    expect(sqlHalf).not.toContain('BETWEEN');
  });

  it('combines all filters with AND', async () => {
    const [sql, params] = await run({
      userId: 5,
      status: 'pending' as never,
      rangeStart: '2026-07-01',
      rangeEnd: '2026-07-31',
    });
    expect(sql).toContain('user_id = ? AND status = ? AND DATE(clock_in) BETWEEN ? AND ?');
    expect(params).toEqual([5, 'pending', '2026-07-01', '2026-07-31']);
  });
});

describe('AttendanceService.approve — failure diagnosis', () => {
  it('throws 404 when the record does not exist', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple);

    await expect(new AttendanceService(pool).approve(99, 2)).rejects.toThrow(
      'Attendance record not found'
    );
  });

  it('refuses self-approval even for a reviewer with the permission', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple)
      .mockResolvedValueOnce([[buildRow({ user_id: 2, clock_out: '2026-07-10T16:00:00.000Z' })], null] as Tuple);

    await expect(new AttendanceService(pool).approve(1, 2)).rejects.toThrow(
      /cannot approve your own/
    );
  });

  it('throws an internal error when the approved row cannot be re-read', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple);

    await expect(new AttendanceService(pool).approve(1, 2)).rejects.toThrow(
      'Failed to retrieve approved record'
    );
  });
});

describe('AttendanceService.reject — failure diagnosis and success', () => {
  it('throws 404 when the record does not exist', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple);

    await expect(new AttendanceService(pool).reject(99, 2)).rejects.toThrow(
      'Attendance record not found'
    );
  });

  it('refuses self-rejection', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 0 }, null] as Tuple)
      .mockResolvedValueOnce([[buildRow({ user_id: 2 })], null] as Tuple);

    await expect(new AttendanceService(pool).reject(1, 2)).rejects.toThrow(
      /cannot reject your own/
    );
  });

  it('rejects a pending record and audits the decision', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockResolvedValueOnce([[buildRow({ status: 'rejected', reviewer_id: 2 })], null] as Tuple)
      .mockResolvedValue([{ insertId: 1 }, null] as Tuple); // audit insert

    const rejected = await new AttendanceService(pool).reject(1, 2, 'late punch');

    expect(rejected.status).toBe('rejected');
    expect(execute.mock.calls[0][1]).toEqual([2, 'late punch', 1, 2]);
  });

  it('throws an internal error when the rejected row cannot be re-read', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple);

    await expect(new AttendanceService(pool).reject(1, 2)).rejects.toThrow(
      'Failed to retrieve rejected record'
    );
  });
});

describe('AttendanceService.getCostEstimate — department scoping', () => {
  it('omits the department condition when no departmentId is given', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ hours: 10, cost: 100 }], null] as Tuple)
      .mockResolvedValueOnce([[{ hours: 8, cost: 80 }], null] as Tuple);

    const estimate = await new AttendanceService(pool).getCostEstimate({
      startDate: '2026-07-01',
      endDate: '2026-07-31',
    });

    expect(execute.mock.calls[0][0]).not.toContain('department_id = ?');
    expect(execute.mock.calls[0][1]).toEqual(['2026-07-01', '2026-07-31']);
    expect(estimate.plannedHours).toBe(10);
    expect(estimate.actualCost).toBe(80);
  });

  it('scopes both aggregates when departmentId is given', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ hours: 10, cost: 100 }], null] as Tuple)
      .mockResolvedValueOnce([[{ hours: 8, cost: 80 }], null] as Tuple);

    await new AttendanceService(pool).getCostEstimate({
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      departmentId: 4,
    });

    expect(execute.mock.calls[0][0]).toContain('department_id = ?');
    expect(execute.mock.calls[0][1]).toEqual(['2026-07-01', '2026-07-31', 4]);
    expect(execute.mock.calls[1][1]).toEqual(['2026-07-01', '2026-07-31', 4]);
  });
});

describe('AttendanceService — residual default/fallback branches', () => {
  it('list() with no argument behaves like an empty filter', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);

    const result = await new AttendanceService(pool).list();

    expect(result).toEqual([]);
    expect(execute.mock.calls[0][0]).not.toContain('WHERE');
  });

  it('approve() and reject() default notes to null in the audit trail', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockResolvedValueOnce([[buildRow({ status: 'approved' })], null] as Tuple)
      .mockResolvedValue([{ insertId: 1 }, null] as Tuple);
    await new AttendanceService(pool).approve(1, 2);

    const { pool: pool2, execute: execute2 } = makePool();
    execute2
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockResolvedValueOnce([[buildRow({ status: 'rejected' })], null] as Tuple)
      .mockResolvedValue([{ insertId: 1 }, null] as Tuple);
    await new AttendanceService(pool2).reject(1, 2);

    // Both UPDATE statements received null for the notes placeholder.
    expect(execute.mock.calls[0][1][1]).toBeNull();
    expect(execute2.mock.calls[0][1][1]).toBeNull();
  });

  it('getCostEstimate() degrades to zeros when the driver returns null aggregates', async () => {
    // A no-GROUP-BY SUM always yields exactly one row, but the driver can
    // surface NULL (e.g. decimal handling differences); Number(null) is 0 and
    // the || 0 keeps NaN from a malformed value out of the API.
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ hours: null, cost: null }], null] as Tuple)
      .mockResolvedValueOnce([[{ hours: 'not-a-number', cost: undefined }], null] as Tuple);

    const estimate = await new AttendanceService(pool).getCostEstimate({
      startDate: '2026-07-01',
      endDate: '2026-07-31',
    });

    expect(estimate.plannedHours).toBe(0);
    expect(estimate.plannedCost).toBe(0);
    expect(estimate.actualHours).toBe(0);
    expect(estimate.actualCost).toBe(0);
  });
});
