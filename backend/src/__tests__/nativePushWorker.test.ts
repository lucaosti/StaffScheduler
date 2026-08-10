/**
 * NativePushWorker tests — batch delivery, retry/failure accounting, the
 * gone-token deactivation path, and the start/stop gate. NativePushService is
 * mocked so no real FCM/APNs send is touched.
 */

export {};

const sendNativePush = jest.fn();
const isNativePushConfigured = jest.fn();
class NativePushGoneError extends Error {}
jest.mock('../services/NativePushService', () => ({
  sendNativePush: (...args: unknown[]) => sendNativePush(...args),
  isNativePushConfigured: () => isNativePushConfigured(),
  NativePushGoneError,
}));

import {
  processNativePushOutboxOnce,
  startNativePushWorker,
  stopNativePushWorker,
} from '../services/NativePushWorker';

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
  device_token_id: 10,
  payload: JSON.stringify({ title: 't' }),
  attempts: 0,
  platform: 'android',
  token: 'device-token',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  stopNativePushWorker();
});

describe('processNativePushOutboxOnce', () => {
  it('marks a row sent on successful delivery', async () => {
    const conn = makeConn([row()]);
    sendNativePush.mockResolvedValueOnce(undefined);

    const count = await processNativePushOutboxOnce(poolWith(conn));

    expect(count).toBe(1);
    expect(sendNativePush).toHaveBeenCalledWith(
      { platform: 'android', token: 'device-token' },
      { title: 't' }
    );
    expect(conn.execute.mock.calls[0][0]).toMatch(/status = 'sent'/);
    expect(conn.commit).toHaveBeenCalled();
  });

  it('keeps a row pending and records the error on a transient failure', async () => {
    const conn = makeConn([row({ id: 2, attempts: 1 })]);
    sendNativePush.mockRejectedValueOnce(new Error('push service down'));

    await processNativePushOutboxOnce(poolWith(conn));

    const [sql, params] = conn.execute.mock.calls[0];
    expect(sql).toMatch(/SET status = \?/);
    expect(params[0]).toBe('pending'); // attempts 2 < MAX 5
    expect(params[1]).toBe(2);
    expect(params[2]).toMatch(/push service down/);
    expect(conn.execute).toHaveBeenCalledTimes(1);
  });

  it('marks a row failed once MAX_ATTEMPTS is reached', async () => {
    const conn = makeConn([row({ id: 3, attempts: 4 })]);
    sendNativePush.mockRejectedValueOnce(new Error('still down'));

    await processNativePushOutboxOnce(poolWith(conn));

    const params = conn.execute.mock.calls[0][1];
    expect(params[0]).toBe('failed'); // attempts 5 >= MAX 5
  });

  it('deactivates the device token immediately on NativePushGoneError, without waiting for MAX_ATTEMPTS', async () => {
    const conn = makeConn([row({ id: 4, device_token_id: 99, attempts: 0 })]);
    sendNativePush.mockRejectedValueOnce(new NativePushGoneError('gone'));

    await processNativePushOutboxOnce(poolWith(conn));

    expect(conn.execute).toHaveBeenCalledTimes(2);
    const [outboxSql, outboxParams] = conn.execute.mock.calls[0];
    expect(outboxSql).toMatch(/native_push_outbox/);
    expect(outboxParams[0]).toBe('failed'); // gone => failed immediately, attempts 1 < MAX
    const [tokenSql, tokenParams] = conn.execute.mock.calls[1];
    expect(tokenSql).toMatch(/device_push_tokens SET is_active = FALSE/);
    expect(tokenParams).toEqual([99]);
  });

  it('rolls back and returns 0 when the poll query throws', async () => {
    const conn = makeConn([]);
    conn.query.mockRejectedValueOnce(new Error('db gone'));
    const count = await processNativePushOutboxOnce(poolWith(conn));
    expect(count).toBe(0);
    expect(conn.rollback).toHaveBeenCalled();
  });
});

describe('startNativePushWorker', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    stopNativePushWorker();
    jest.useRealTimers();
  });

  it('does not start (schedules no poll) when native push is not configured', () => {
    isNativePushConfigured.mockReturnValue(false);
    const pool = poolWith(makeConn([]));
    startNativePushWorker(pool, 10);
    jest.advanceTimersByTime(50);
    expect((pool as { getConnection: jest.Mock }).getConnection).not.toHaveBeenCalled();
  });

  it('schedules polls when native push is configured, and stop halts them', () => {
    isNativePushConfigured.mockReturnValue(true);
    const pool = poolWith(makeConn([]));
    startNativePushWorker(pool, 10);
    jest.advanceTimersByTime(25);
    expect((pool as { getConnection: jest.Mock }).getConnection).toHaveBeenCalled();
    const callsSoFar = (pool as { getConnection: jest.Mock }).getConnection.mock.calls.length;
    stopNativePushWorker();
    jest.advanceTimersByTime(50);
    expect((pool as { getConnection: jest.Mock }).getConnection.mock.calls.length).toBe(callsSoFar);
  });

  it('does not schedule a second interval on a second call while one is already running', () => {
    isNativePushConfigured.mockReturnValue(true);
    const pool = poolWith(makeConn([]));

    startNativePushWorker(pool, 10);
    const countAfterFirstCall = jest.getTimerCount();

    startNativePushWorker(pool, 10);
    expect(jest.getTimerCount()).toBe(countAfterFirstCall);
  });
});

describe('startNativePushWorker (real timers)', () => {
  afterEach(() => {
    stopNativePushWorker();
  });

  it('unrefs its interval, so it cannot keep the process alive by itself', () => {
    isNativePushConfigured.mockReturnValue(true);
    const pool = poolWith(makeConn([]));
    const setIntervalSpy = jest.spyOn(global, 'setInterval');

    startNativePushWorker(pool, 60_000);

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    const handle = setIntervalSpy.mock.results[0].value as ReturnType<typeof setInterval>;
    expect(handle.hasRef()).toBe(false);

    setIntervalSpy.mockRestore();
  });
});
