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
