/**
 * WebhookWorker tests — batch delivery, exponential backoff, and the
 * start/stop gate. `fetch` is mocked so no real HTTP request is made.
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

const poolWith = (conn: ReturnType<typeof makeConn>) =>
  ({ getConnection: jest.fn().mockResolvedValue(conn) }) as never;

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  subscription_id: 10,
  event_type: 'schedule.published',
  payload: JSON.stringify({ scheduleId: 1 }),
  attempts: 0,
  url: 'https://example.com/hook',
  secret: 'shh',
  ...overrides,
});

import { processWebhookOutboxOnce, startWebhookWorker, stopWebhookWorker } from '../services/WebhookWorker';

beforeEach(() => {
  jest.clearAllMocks();
  stopWebhookWorker();
  global.fetch = jest.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('processWebhookOutboxOnce', () => {
  it('marks a row sent on a 2xx response, recording the response status', async () => {
    const conn = makeConn([row()]);
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200 });

    const count = await processWebhookOutboxOnce(poolWith(conn));

    expect(count).toBe(1);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://example.com/hook');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Webhook-Signature']).toMatch(/^sha256=/);
    expect(init.headers['X-Webhook-Event']).toBe('schedule.published');
    expect(init.body).toBe(JSON.stringify({ scheduleId: 1 }));

    expect(conn.execute.mock.calls[0][0]).toMatch(/status = 'sent'/);
    expect(conn.execute.mock.calls[0][1]).toEqual([200, 1]);
    expect(conn.commit).toHaveBeenCalled();
  });

  it('keeps a row pending with a computed backoff on a non-2xx response', async () => {
    const conn = makeConn([row({ id: 2, attempts: 1 })]);
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 503 });

    await processWebhookOutboxOnce(poolWith(conn));

    const [sql, params] = conn.execute.mock.calls[0];
    expect(sql).toMatch(/SET status = \?/);
    expect(params[0]).toBe('pending'); // attempts 2 < MAX 6
    expect(params[1]).toBe(2);
    expect(params[2]).toBe(503); // response_status captured even on failure
    expect(params[3]).toMatch(/503/);
    // next_attempt_at (param index 5) pushed forward by 2^2 = 4 minutes.
    const nextAttemptAt = params[5] as Date;
    expect(nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 3 * 60_000);
    expect(nextAttemptAt.getTime()).toBeLessThan(Date.now() + 5 * 60_000);
  });

  it('aborts the request once the delivery timeout elapses', async () => {
    jest.useFakeTimers();
    try {
      const conn = makeConn([row({ id: 6 })]);
      (global.fetch as jest.Mock).mockImplementationOnce(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(new Error('This operation was aborted')));
          })
      );

      const resultPromise = processWebhookOutboxOnce(poolWith(conn));
      await jest.advanceTimersByTimeAsync(10_000);
      await resultPromise;

      const params = conn.execute.mock.calls[0][1];
      expect(params[3]).toMatch(/aborted/);
    } finally {
      jest.useRealTimers();
    }
  });

  it('records a null response_status on a network-level failure (no response at all)', async () => {
    const conn = makeConn([row({ id: 3 })]);
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await processWebhookOutboxOnce(poolWith(conn));

    const params = conn.execute.mock.calls[0][1];
    expect(params[2]).toBeNull();
    expect(params[3]).toMatch(/ECONNREFUSED/);
  });

  it('stringifies a non-Error rejection as the last_error message', async () => {
    const conn = makeConn([row({ id: 5 })]);
    (global.fetch as jest.Mock).mockRejectedValueOnce('endpoint unreachable');

    await processWebhookOutboxOnce(poolWith(conn));

    const params = conn.execute.mock.calls[0][1];
    expect(params[3]).toBe('endpoint unreachable');
  });

  it('marks a row failed once MAX_ATTEMPTS is reached', async () => {
    const conn = makeConn([row({ id: 4, attempts: 5 })]);
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 500 });

    await processWebhookOutboxOnce(poolWith(conn));

    const params = conn.execute.mock.calls[0][1];
    expect(params[0]).toBe('failed'); // attempts 6 >= MAX 6
  });

  it('only claims rows whose next_attempt_at has already elapsed', async () => {
    const conn = makeConn([]);
    await processWebhookOutboxOnce(poolWith(conn));
    expect(conn.query.mock.calls[0][0]).toMatch(/next_attempt_at <= NOW\(\)/);
  });

  it('rolls back and returns 0 when the poll query throws', async () => {
    const conn = makeConn([]);
    conn.query.mockRejectedValueOnce(new Error('db gone'));
    const count = await processWebhookOutboxOnce(poolWith(conn));
    expect(count).toBe(0);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it('rolls back and returns 0 when the poll query rejects with a non-Error value', async () => {
    const conn = makeConn([]);
    conn.query.mockRejectedValueOnce('connection pool exhausted');
    const count = await processWebhookOutboxOnce(poolWith(conn));
    expect(count).toBe(0);
    expect(conn.rollback).toHaveBeenCalled();
  });
});

describe('startWebhookWorker', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    stopWebhookWorker();
    jest.useRealTimers();
  });

  it('schedules polls unconditionally (no configuration gate)', () => {
    const pool = poolWith(makeConn([]));
    startWebhookWorker(pool, 10);
    jest.advanceTimersByTime(25);
    expect((pool as { getConnection: jest.Mock }).getConnection).toHaveBeenCalled();
  });

  it('defaults to the standard poll interval when none is given', () => {
    const pool = poolWith(makeConn([]));
    startWebhookWorker(pool);
    jest.advanceTimersByTime(30_000);
    expect((pool as { getConnection: jest.Mock }).getConnection).toHaveBeenCalled();
  });

  it('stop halts further polls', () => {
    const pool = poolWith(makeConn([]));
    startWebhookWorker(pool, 10);
    jest.advanceTimersByTime(25);
    const callsSoFar = (pool as { getConnection: jest.Mock }).getConnection.mock.calls.length;
    stopWebhookWorker();
    jest.advanceTimersByTime(50);
    expect((pool as { getConnection: jest.Mock }).getConnection.mock.calls.length).toBe(callsSoFar);
  });

  it('does not schedule a second interval on a second call while one is already running', () => {
    const pool = poolWith(makeConn([]));
    startWebhookWorker(pool, 10);
    const countAfterFirstCall = jest.getTimerCount();
    startWebhookWorker(pool, 10);
    expect(jest.getTimerCount()).toBe(countAfterFirstCall);
  });

  it('lets a stopped worker be restarted, and it polls again', () => {
    const pool = poolWith(makeConn([]));
    startWebhookWorker(pool, 10);
    jest.advanceTimersByTime(25);
    const callsAfterFirstRun = (pool as { getConnection: jest.Mock }).getConnection.mock.calls.length;
    expect(callsAfterFirstRun).toBeGreaterThan(0);

    stopWebhookWorker();
    startWebhookWorker(pool, 10);
    jest.advanceTimersByTime(25);

    expect((pool as { getConnection: jest.Mock }).getConnection.mock.calls.length).toBeGreaterThan(
      callsAfterFirstRun
    );
  });
});

/** Same #394 regression pin as OutboxWorker/PushWorker's identical test. */
describe('startWebhookWorker (real timers)', () => {
  afterEach(() => {
    stopWebhookWorker();
  });

  it('unrefs its interval, so it cannot keep the process alive by itself', () => {
    const pool = poolWith(makeConn([]));
    const setIntervalSpy = jest.spyOn(global, 'setInterval');

    startWebhookWorker(pool, 60_000);

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    const handle = setIntervalSpy.mock.results[0].value as ReturnType<typeof setInterval>;
    expect(handle.hasRef()).toBe(false);

    setIntervalSpy.mockRestore();
  });
});
