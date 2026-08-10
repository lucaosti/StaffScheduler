/**
 * ReportsService tests (F08).
 */

import { ReportsService } from '../services/ReportsService';

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute } as never, execute };
};

describe('ReportsService.hoursWorkedByUser', () => {
  it('returns the rows mapped to numeric hours', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [
        { user_id: 1, full_name: 'Anna Demo', hours: '40.00' },
        { user_id: 2, full_name: 'Bruno Demo', hours: 28 },
      ],
      null,
    ]);
    const service = new ReportsService(pool);
    const rows = await service.hoursWorkedByUser('2026-04-01', '2026-04-30');
    expect(rows).toEqual([
      { userId: 1, fullName: 'Anna Demo', hours: 40 },
      { userId: 2, fullName: 'Bruno Demo', hours: 28 },
    ]);
    expect(execute.mock.calls[0][1]).toEqual(['2026-04-01', '2026-04-30']);
  });

  it('appends the department filter when provided', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);
    const service = new ReportsService(pool);
    await service.hoursWorkedByUser('2026-04-01', '2026-04-30', 5);
    expect(execute.mock.calls[0][0]).toMatch(/s\.department_id = \?/);
    expect(execute.mock.calls[0][1]).toEqual(['2026-04-01', '2026-04-30', 5]);
  });

  it('falls back to zero hours when the aggregate is not a number', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ user_id: 1, full_name: 'Anna Demo', hours: null }], null]);
    const service = new ReportsService(pool);
    const rows = await service.hoursWorkedByUser('2026-04-01', '2026-04-30');
    expect(rows[0].hours).toBe(0);
  });
});

describe('ReportsService.fairnessForSchedule', () => {
  it('returns zeroed stats for an empty schedule', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);
    const service = new ReportsService(pool);
    const out = await service.fairnessForSchedule(99);
    expect(out.stats).toEqual({ count: 0, min: 0, max: 0, mean: 0, stddev: 0 });
    expect(out.perUser).toEqual([]);
  });

  it('computes min, max, mean, stddev from the per-user rows', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [
        { user_id: 1, full_name: 'A', hours: 40 },
        { user_id: 2, full_name: 'B', hours: 30 },
        { user_id: 3, full_name: 'C', hours: 20 },
      ],
      null,
    ]);
    const service = new ReportsService(pool);
    const out = await service.fairnessForSchedule(1);
    expect(out.stats.count).toBe(3);
    expect(out.stats.min).toBe(20);
    expect(out.stats.max).toBe(40);
    expect(out.stats.mean).toBeCloseTo(30, 5);
    // Population stddev of [40,30,20] = sqrt(((10^2 + 0 + 10^2)/3)) = sqrt(200/3)
    expect(out.stats.stddev).toBeCloseTo(Math.sqrt(200 / 3), 5);
  });

  it('falls back to zero hours per-user when the aggregate is not a number', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ user_id: 1, full_name: 'A', hours: null }], null]);
    const service = new ReportsService(pool);
    const out = await service.fairnessForSchedule(1);
    expect(out.perUser[0].hours).toBe(0);
  });
});

describe('ReportsService.costByDepartment', () => {
  it('maps numeric strings from MySQL aggregates', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [
        { department_id: 1, department_name: 'Emergency', hours: '160.00', cost: '4000.00' },
      ],
      null,
    ]);
    const service = new ReportsService(pool);
    const rows = await service.costByDepartment('2026-04-01', '2026-04-30');
    expect(rows).toEqual([
      { departmentId: 1, departmentName: 'Emergency', hours: 160, cost: 4000 },
    ]);
  });

  it('falls back to zero hours and cost when the aggregates are not numbers', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [{ department_id: 1, department_name: 'Emergency', hours: null, cost: null }],
      null,
    ]);
    const service = new ReportsService(pool);
    const rows = await service.costByDepartment('2026-04-01', '2026-04-30');
    expect(rows).toEqual([
      { departmentId: 1, departmentName: 'Emergency', hours: 0, cost: 0 },
    ]);
  });
});

describe('ReportsService.complianceViolationsTrend', () => {
  it('groups violation counts by day and rule code', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [
        { date: '2026-05-01', code: 'MAX_WEEKLY_HOURS', count: 3 },
        { date: '2026-05-01', code: 'MIN_REST_HOURS', count: '1' },
        { date: '2026-05-02', code: 'MAX_WEEKLY_HOURS', count: 2 },
      ],
      null,
    ]);
    const service = new ReportsService(pool);
    const rows = await service.complianceViolationsTrend('2026-05-01', '2026-05-31');
    expect(rows).toEqual([
      { date: '2026-05-01', code: 'MAX_WEEKLY_HOURS', count: 3 },
      { date: '2026-05-01', code: 'MIN_REST_HOURS', count: 1 },
      { date: '2026-05-02', code: 'MAX_WEEKLY_HOURS', count: 2 },
    ]);
    expect(execute.mock.calls[0][1]).toEqual(['2026-05-01', '2026-05-31']);
  });

  it('normalises a Date object in the date column to YYYY-MM-DD', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [{ date: new Date('2026-05-01T00:00:00Z'), code: 'MAX_WEEKLY_HOURS', count: 1 }],
      null,
    ]);
    const service = new ReportsService(pool);
    const rows = await service.complianceViolationsTrend('2026-05-01', '2026-05-31');
    expect(rows[0].date).toBe('2026-05-01');
  });

  it('returns an empty trend when nothing was recorded', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null]);
    const service = new ReportsService(pool);
    expect(await service.complianceViolationsTrend('2026-05-01', '2026-05-31')).toEqual([]);
  });

  it('falls back to zero when the count aggregate is not a number', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [{ date: '2026-05-01', code: 'MAX_WEEKLY_HOURS', count: null }],
      null,
    ]);
    const service = new ReportsService(pool);
    const rows = await service.complianceViolationsTrend('2026-05-01', '2026-05-31');
    expect(rows[0].count).toBe(0);
  });
});
