/**
 * PayrollExportWorker tests — batch delivery, exponential backoff, the
 * start/stop gate, and provider lookup. `fetch` is mocked (via GustoProvider)
 * so no real HTTP request is made.
 */

export {};

const originalFetch = global.fetch;

const makeConn = (rows: unknown[]) => ({
  beginTransaction: jest.fn().mockResolvedValue(undefined),
  query: jest.fn().mockResolvedValue([rows, null]),
  execute: jest.fn().mockResolvedValue([{ affectedRows: 1 }, null]),
  commit: jest.fn().mockResolvedValue(undefined),
  rollback: jest.fn().mockResolvedValue(undefined),
  release: jest.fn(),
});

/**
 * `PayrollExportService.buildBatch` reads through the outer `pool`, not the
 * transaction's `conn` — a second, independent read, same as the rest of
 * this pool fake needs both a `getConnection` (for the job-row transaction)
 * and its own `execute` (for the batch query).
 */
const poolWith = (conn: ReturnType<typeof makeConn>, batchRows: unknown[] = []) =>
  ({
    getConnection: jest.fn().mockResolvedValue(conn),
    execute: jest.fn().mockResolvedValue([batchRows, null]),
  }) as never;

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  provider: 'gusto',
  range_start: '2026-05-01',
  range_end: '2026-05-31',
  attempts: 0,
  ...overrides,
});

const batchLine = (overrides: Record<string, unknown> = {}) => ({
  user_id: 7,
  full_name: 'Anna Demo',
  email: 'anna@example.com',
  hours: '40.00',
  gross_pay: '800.00',
  ...overrides,
});

import {
  processPayrollExportOutboxOnce,
  startPayrollExportWorker,
  stopPayrollExportWorker,
} from '../services/PayrollExportWorker';
import { config } from '../config';

beforeEach(() => {
  jest.clearAllMocks();
  stopPayrollExportWorker();
  global.fetch = jest.fn();
  config.gusto.apiKey = 'test-key';
  config.gusto.companyId = 'test-company';
});

afterEach(() => {
  global.fetch = originalFetch;
  config.gusto.apiKey = undefined;
  config.gusto.companyId = undefined;
});

describe('processPayrollExportOutboxOnce', () => {
  it('marks a job sent and records the provider reference on success', async () => {
    const conn = makeConn([row()]);
    const pool = poolWith(conn, [batchLine()]);
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'run_123' }),
    });

    const count = await processPayrollExportOutboxOnce(pool);

    expect(count).toBe(1);
    const [sql, params] = conn.execute.mock.calls[0];
    expect(sql).toMatch(/status = 'sent'/);
    expect(params).toEqual(['run_123', 1]);
    expect(conn.commit).toHaveBeenCalled();

    // The batch actually reached the provider.
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.employee_compensations).toEqual([
      { employee_email: 'anna@example.com', hours: 40, gross_pay_cents: 80000 },
    ]);
  });

  it('keeps a job pending with a computed backoff when the provider rejects it', async () => {
    const conn = makeConn([row({ id: 2, attempts: 1 })]);
    const pool = poolWith(conn, [batchLine()]);
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 422,
      text: () => Promise.resolve('invalid pay period'),
    });

    await processPayrollExportOutboxOnce(pool);

    const [sql, params] = conn.execute.mock.calls[0];
    expect(sql).toMatch(/SET status = \?/);
    expect(params[0]).toBe('pending'); // attempts 2 < MAX 6
    expect(params[1]).toBe(2);
    expect(params[2]).toMatch(/422/);
    const nextAttemptAt = params[4] as Date;
    expect(nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 3 * 60_000);
    expect(nextAttemptAt.getTime()).toBeLessThan(Date.now() + 5 * 60_000);
  });

  it('marks a job failed once MAX_ATTEMPTS is reached', async () => {
    const conn = makeConn([row({ id: 4, attempts: 5 })]);
    const pool = poolWith(conn, [batchLine()]);
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 500, text: () => Promise.resolve('') });

    await processPayrollExportOutboxOnce(pool);

    const params = conn.execute.mock.calls[0][1];
    expect(params[0]).toBe('failed');
  });

  it('fails the job when no provider is registered for its provider column', async () => {
    const conn = makeConn([row({ provider: 'workday' })]);
    const pool = poolWith(conn, [batchLine()]);

    await processPayrollExportOutboxOnce(pool);

    const params = conn.execute.mock.calls[0][1];
    expect(params[2]).toMatch(/No payroll provider registered/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fails the job when Gusto is not configured, without making a request', async () => {
    config.gusto.apiKey = undefined;
    const conn = makeConn([row()]);
    const pool = poolWith(conn, [batchLine()]);

    await processPayrollExportOutboxOnce(pool);

    const params = conn.execute.mock.calls[0][1];
    expect(params[2]).toMatch(/not configured/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('only claims jobs whose next_attempt_at has already elapsed', async () => {
    const conn = makeConn([]);
    const pool = poolWith(conn);
    await processPayrollExportOutboxOnce(pool);
    expect(conn.query.mock.calls[0][0]).toMatch(/next_attempt_at <= NOW\(\)/);
  });

  it('rolls back and returns 0 when the poll query throws', async () => {
    const conn = makeConn([]);
    conn.query.mockRejectedValueOnce(new Error('db gone'));
    const count = await processPayrollExportOutboxOnce(poolWith(conn));
    expect(count).toBe(0);
    expect(conn.rollback).toHaveBeenCalled();
  });
});

describe('startPayrollExportWorker', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    stopPayrollExportWorker();
    jest.useRealTimers();
  });

  it('schedules polls unconditionally (no configuration gate)', () => {
    const pool = poolWith(makeConn([]));
    startPayrollExportWorker(pool, 10);
    jest.advanceTimersByTime(25);
    expect((pool as { getConnection: jest.Mock }).getConnection).toHaveBeenCalled();
  });

  it('does not schedule a second interval on a second call while one is already running', () => {
    const pool = poolWith(makeConn([]));
    startPayrollExportWorker(pool, 10);
    const countAfterFirstCall = jest.getTimerCount();
    startPayrollExportWorker(pool, 10);
    expect(jest.getTimerCount()).toBe(countAfterFirstCall);
  });

  it('stop halts further polls', () => {
    const pool = poolWith(makeConn([]));
    startPayrollExportWorker(pool, 10);
    jest.advanceTimersByTime(25);
    const callsSoFar = (pool as { getConnection: jest.Mock }).getConnection.mock.calls.length;
    stopPayrollExportWorker();
    jest.advanceTimersByTime(50);
    expect((pool as { getConnection: jest.Mock }).getConnection.mock.calls.length).toBe(callsSoFar);
  });
});

/** Same shape as the other outbox workers' unref regression pin. */
describe('startPayrollExportWorker (real timers)', () => {
  afterEach(() => {
    stopPayrollExportWorker();
  });

  it('unrefs its interval, so it cannot keep the process alive by itself', () => {
    const pool = poolWith(makeConn([]));
    const setIntervalSpy = jest.spyOn(global, 'setInterval');

    startPayrollExportWorker(pool, 60_000);

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    const handle = setIntervalSpy.mock.results[0].value as ReturnType<typeof setInterval>;
    expect(handle.hasRef()).toBe(false);

    setIntervalSpy.mockRestore();
  });
});
