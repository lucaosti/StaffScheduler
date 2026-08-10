/**
 * PayrollExportService unit tests.
 */

import { PayrollExportService } from '../services/PayrollExportService';

type Tuple = [unknown, unknown];

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute } as never, execute };
};

describe('PayrollExportService.buildBatch', () => {
  it('maps numeric strings from MySQL aggregates and omits zero-hour employees', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [
        { user_id: 1, full_name: 'Anna Demo', email: 'anna@example.com', hours: '40.00', gross_pay: '800.00' },
      ],
      null,
    ] as Tuple);

    const batch = await new PayrollExportService(pool).buildBatch('2026-05-01', '2026-05-31');

    expect(batch).toEqual({
      rangeStart: '2026-05-01',
      rangeEnd: '2026-05-31',
      lines: [
        { userId: 1, fullName: 'Anna Demo', email: 'anna@example.com', hours: 40, grossPay: 800 },
      ],
    });
    // The zero-hours filter is a HAVING clause, not a JS-side filter.
    expect(execute.mock.calls[0][0]).toMatch(/HAVING hours > 0/);
    expect(execute.mock.calls[0][1]).toEqual(['2026-05-01', '2026-05-31']);
  });

  it('returns an empty batch when nobody worked in the range', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);
    const batch = await new PayrollExportService(pool).buildBatch('2026-05-01', '2026-05-31');
    expect(batch.lines).toEqual([]);
  });

  it('falls back to zero hours/pay when the aggregates are not numbers', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [{ user_id: 1, full_name: 'Anna Demo', email: 'anna@example.com', hours: null, gross_pay: null }],
      null,
    ] as Tuple);
    const batch = await new PayrollExportService(pool).buildBatch('2026-05-01', '2026-05-31');
    expect(batch.lines[0]).toMatchObject({ hours: 0, grossPay: 0 });
  });
});

describe('PayrollExportService job CRUD', () => {
  it('creates a job and re-reads it', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ insertId: 9 }, null] as Tuple)
      .mockResolvedValueOnce([
        [
          {
            id: 9,
            provider: 'gusto',
            range_start: '2026-05-01',
            range_end: '2026-05-31',
            status: 'pending',
            attempts: 0,
            provider_reference: null,
            last_error: null,
            created_by: 1,
            created_at: 'x',
            processed_at: null,
          },
        ],
        null,
      ] as Tuple);

    const job = await new PayrollExportService(pool).createJob('gusto', '2026-05-01', '2026-05-31', 1);
    expect(job).toMatchObject({ id: 9, provider: 'gusto', status: 'pending' });
  });

  it('throws when the newly inserted job cannot be re-read', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ insertId: 9 }, null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple);

    await expect(
      new PayrollExportService(pool).createJob('gusto', '2026-05-01', '2026-05-31', 1)
    ).rejects.toThrow('Failed to create payroll export job');
  });

  it('getById returns null for an unknown job', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);
    expect(await new PayrollExportService(pool).getById(99)).toBeNull();
  });

  it('list returns jobs newest first', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([
      [
        {
          id: 1,
          provider: 'gusto',
          range_start: '2026-05-01',
          range_end: '2026-05-31',
          status: 'sent',
          attempts: 1,
          provider_reference: 'run_1',
          last_error: null,
          created_by: 1,
          created_at: 'x',
          processed_at: 'y',
        },
      ],
      null,
    ] as Tuple);
    const jobs = await new PayrollExportService(pool).list();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].providerReference).toBe('run_1');
  });
});
