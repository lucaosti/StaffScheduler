/**
 * PushWorker tests — batch delivery, retry/failure accounting, the
 * gone-subscription deactivation path, and the start/stop gate.
 * PushService is mocked so no real web-push send is touched.
 */

export {};

const sendPush = jest.fn();
const isPushConfigured = jest.fn();
jest.mock('../services/PushService', () => ({
  sendPush: (...args: unknown[]) => sendPush(...args),
  isPushConfigured: () => isPushConfigured(),
}));

import { processPushOutboxOnce, startPushWorker, stopPushWorker } from '../services/PushWorker';

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
  payload: JSON.stringify({ title: 't' }),
  attempts: 0,
  endpoint: 'https://push.example/x',
  p256dh: 'p',
  auth: 'a',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  stopPushWorker();
});

describe('processPushOutboxOnce', () => {
  it('marks a row sent on successful delivery', async () => {
    const conn = makeConn([row()]);
    sendPush.mockResolvedValueOnce(undefined);

    const count = await processPushOutboxOnce(poolWith(conn));

    expect(count).toBe(1);
    expect(sendPush).toHaveBeenCalledWith(
      { endpoint: 'https://push.example/x', keys: { p256dh: 'p', auth: 'a' } },
      { title: 't' }
    );
    expect(conn.execute.mock.calls[0][0]).toMatch(/status = 'sent'/);
    expect(conn.commit).toHaveBeenCalled();
  });

  it('keeps a row pending and records the error on a transient failure', async () => {
    const conn = makeConn([row({ id: 2, attempts: 1 })]);
    sendPush.mockRejectedValueOnce(new Error('push service down'));

    await processPushOutboxOnce(poolWith(conn));

    const [sql, params] = conn.execute.mock.calls[0];
    expect(sql).toMatch(/SET status = \?/);
    expect(params[0]).toBe('pending'); // attempts 2 < MAX 5
    expect(params[1]).toBe(2);
    expect(params[2]).toMatch(/push service down/);
    // Only one execute call — the subscription is not deactivated for a transient failure.
    expect(conn.execute).toHaveBeenCalledTimes(1);
  });

  it('marks a row failed once MAX_ATTEMPTS is reached', async () => {
    const conn = makeConn([row({ id: 3, attempts: 4 })]);
    sendPush.mockRejectedValueOnce(new Error('still down'));

    await processPushOutboxOnce(poolWith(conn));

    const params = conn.execute.mock.calls[0][1];
    expect(params[0]).toBe('failed'); // attempts 5 >= MAX 5
  });

  it('deactivates the subscription immediately on a 404/410 (gone) response, without waiting for MAX_ATTEMPTS', async () => {
    const conn = makeConn([row({ id: 4, subscription_id: 99, attempts: 0 })]);
    const gone = Object.assign(new Error('Gone'), { statusCode: 410 });
    sendPush.mockRejectedValueOnce(gone);

    await processPushOutboxOnce(poolWith(conn));

    expect(conn.execute).toHaveBeenCalledTimes(2);
    const [outboxSql, outboxParams] = conn.execute.mock.calls[0];
    expect(outboxSql).toMatch(/push_outbox/);
    expect(outboxParams[0]).toBe('failed'); // gone => failed immediately, attempts 1 < MAX
    const [subSql, subParams] = conn.execute.mock.calls[1];
    expect(subSql).toMatch(/push_subscriptions SET is_active = FALSE/);
    expect(subParams).toEqual([99]);
  });

  it('treats a 404 the same as a 410', async () => {
    const conn = makeConn([row({ id: 5 })]);
    const gone = Object.assign(new Error('Not Found'), { statusCode: 404 });
    sendPush.mockRejectedValueOnce(gone);

    await processPushOutboxOnce(poolWith(conn));

    expect(conn.execute.mock.calls[1][0]).toMatch(/is_active = FALSE/);
  });

  it('rolls back and returns 0 when the poll query throws', async () => {
    const conn = makeConn([]);
    conn.query.mockRejectedValueOnce(new Error('db gone'));
    const count = await processPushOutboxOnce(poolWith(conn));
    expect(count).toBe(0);
    expect(conn.rollback).toHaveBeenCalled();
  });
});

describe('startPushWorker', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    stopPushWorker();
    jest.useRealTimers();
  });

  it('does not start (schedules no poll) when Web Push is not configured', () => {
    isPushConfigured.mockReturnValue(false);
    const pool = poolWith(makeConn([]));
    startPushWorker(pool, 10);
    jest.advanceTimersByTime(50);
    expect((pool as { getConnection: jest.Mock }).getConnection).not.toHaveBeenCalled();
  });

  it('schedules polls when Web Push is configured, and stop halts them', () => {
    isPushConfigured.mockReturnValue(true);
    const pool = poolWith(makeConn([]));
    startPushWorker(pool, 10);
    jest.advanceTimersByTime(25);
    expect((pool as { getConnection: jest.Mock }).getConnection).toHaveBeenCalled();
    const callsSoFar = (pool as { getConnection: jest.Mock }).getConnection.mock.calls.length;
    stopPushWorker();
    jest.advanceTimersByTime(50);
    expect((pool as { getConnection: jest.Mock }).getConnection.mock.calls.length).toBe(callsSoFar);
  });

  it('does not schedule a second interval on a second call while one is already running', () => {
    isPushConfigured.mockReturnValue(true);
    const pool = poolWith(makeConn([]));

    startPushWorker(pool, 10);
    const countAfterFirstCall = jest.getTimerCount();

    startPushWorker(pool, 10);
    expect(jest.getTimerCount()).toBe(countAfterFirstCall);
  });

  it('lets a stopped worker be restarted, and it polls again', () => {
    isPushConfigured.mockReturnValue(true);
    const pool = poolWith(makeConn([]));

    startPushWorker(pool, 10);
    jest.advanceTimersByTime(25);
    const callsAfterFirstRun = (pool as { getConnection: jest.Mock }).getConnection.mock.calls.length;
    expect(callsAfterFirstRun).toBeGreaterThan(0);

    stopPushWorker();
    startPushWorker(pool, 10);
    jest.advanceTimersByTime(25);

    expect((pool as { getConnection: jest.Mock }).getConnection.mock.calls.length).toBeGreaterThan(
      callsAfterFirstRun
    );
  });
});

/**
 * Real timers, deliberately — see OutboxWorker's identical test for why: this
 * is the direct regression pin for the #394 class of bug (a `setInterval`
 * that keeps its ref would keep a bare process alive on its own, and outlive
 * whatever test started it).
 */
describe('startPushWorker (real timers)', () => {
  afterEach(() => {
    stopPushWorker();
  });

  it('unrefs its interval, so it cannot keep the process alive by itself', () => {
    isPushConfigured.mockReturnValue(true);
    const pool = poolWith(makeConn([]));
    const setIntervalSpy = jest.spyOn(global, 'setInterval');

    startPushWorker(pool, 60_000);

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    const handle = setIntervalSpy.mock.results[0].value as ReturnType<typeof setInterval>;
    expect(handle.hasRef()).toBe(false);

    setIntervalSpy.mockRestore();
  });
});
