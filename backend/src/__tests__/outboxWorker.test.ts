/**
 * OutboxWorker tests — batch delivery, retry/failure accounting, and the
 * start/stop gate. MailerService is mocked so no real SMTP is touched.
 */

export {};

const sendEmail = jest.fn();
const isEmailConfigured = jest.fn();
jest.mock('../services/MailerService', () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
  isEmailConfigured: () => isEmailConfigured(),
}));

import {
  processOutboxOnce,
  startOutboxWorker,
  stopOutboxWorker,
} from '../services/OutboxWorker';

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

beforeEach(() => {
  jest.clearAllMocks();
  stopOutboxWorker();
});

describe('processOutboxOnce', () => {
  it('marks a row sent on successful delivery', async () => {
    const conn = makeConn([{ id: 1, recipient_email: 'a@b.c', subject: 's', body: 't', attempts: 0 }]);
    sendEmail.mockResolvedValueOnce(undefined);

    const count = await processOutboxOnce(poolWith(conn));

    expect(count).toBe(1);
    expect(sendEmail).toHaveBeenCalledWith({ to: 'a@b.c', subject: 's', text: 't' });
    expect(conn.execute.mock.calls[0][0]).toMatch(/status = 'sent'/);
    expect(conn.commit).toHaveBeenCalled();
  });

  it('keeps a row pending and records the error on a transient failure', async () => {
    const conn = makeConn([{ id: 2, recipient_email: 'a@b.c', subject: 's', body: null, attempts: 1 }]);
    sendEmail.mockRejectedValueOnce(new Error('smtp down'));

    await processOutboxOnce(poolWith(conn));

    const [sql, params] = conn.execute.mock.calls[0];
    expect(sql).toMatch(/SET status = \?/);
    expect(params[0]).toBe('pending'); // attempts 2 < MAX 5
    expect(params[1]).toBe(2);
    expect(params[2]).toMatch(/smtp down/);
  });

  it('marks a row failed once MAX_ATTEMPTS is reached', async () => {
    const conn = makeConn([{ id: 3, recipient_email: 'a@b.c', subject: 's', body: 't', attempts: 4 }]);
    sendEmail.mockRejectedValueOnce(new Error('still down'));

    await processOutboxOnce(poolWith(conn));

    const params = conn.execute.mock.calls[0][1];
    expect(params[0]).toBe('failed'); // attempts 5 >= MAX 5
  });

  it('rolls back and returns 0 when the poll query throws', async () => {
    const conn = makeConn([]);
    conn.query.mockRejectedValueOnce(new Error('db gone'));
    const count = await processOutboxOnce(poolWith(conn));
    expect(count).toBe(0);
    expect(conn.rollback).toHaveBeenCalled();
  });
});

describe('startOutboxWorker', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    stopOutboxWorker();
    jest.useRealTimers();
  });

  it('does not start (schedules no poll) when email is not configured', () => {
    isEmailConfigured.mockReturnValue(false);
    const pool = poolWith(makeConn([]));
    startOutboxWorker(pool, 10);
    jest.advanceTimersByTime(50);
    expect((pool as { getConnection: jest.Mock }).getConnection).not.toHaveBeenCalled();
  });

  it('schedules polls when email is configured, and stop halts them', () => {
    isEmailConfigured.mockReturnValue(true);
    const pool = poolWith(makeConn([]));
    startOutboxWorker(pool, 10);
    jest.advanceTimersByTime(25);
    expect((pool as { getConnection: jest.Mock }).getConnection).toHaveBeenCalled();
    const callsSoFar = (pool as { getConnection: jest.Mock }).getConnection.mock.calls.length;
    stopOutboxWorker();
    jest.advanceTimersByTime(50);
    expect((pool as { getConnection: jest.Mock }).getConnection.mock.calls.length).toBe(callsSoFar);
  });

  /**
   * `timer` is a module-level singleton, not per-instance state — a second
   * caller (e.g. a second startServer() attempt, or a test that fails to clean
   * up) must not be able to arm a second interval underneath the first. Two
   * live intervals would double the polling rate silently, and neither would
   * be reachable individually to stop.
   *
   * Asserted as "unchanged from after the first call" rather than "equals 1":
   * under Jest's modern fake timers, `getTimerCount()` also counts an internal
   * `setImmediate` Winston's Logger schedules on `logger.info(...)` even when
   * silent — a real count, just not evidence about THIS guard, and coupling
   * the assertion to that incidental number would make the test fail on a
   * logging-library upgrade for a reason that has nothing to do with the code
   * under test. The guard itself is what must hold: the second call adds
   * nothing.
   */
  it('does not schedule a second interval on a second call while one is already running', () => {
    isEmailConfigured.mockReturnValue(true);
    const pool = poolWith(makeConn([]));

    startOutboxWorker(pool, 10);
    const countAfterFirstCall = jest.getTimerCount();

    startOutboxWorker(pool, 10);
    expect(jest.getTimerCount()).toBe(countAfterFirstCall);
  });

  /**
   * The guard in startOutboxWorker() is `if (!isEmailConfigured() || timer) return`
   * — stopOutboxWorker() must null out `timer`, or a legitimate restart (e.g.
   * after a config reload) would be silently refused by that same guard,
   * indistinguishable from "already running".
   */
  it('lets a stopped worker be restarted, and it polls again', () => {
    isEmailConfigured.mockReturnValue(true);
    const pool = poolWith(makeConn([]));

    startOutboxWorker(pool, 10);
    jest.advanceTimersByTime(25);
    const callsAfterFirstRun = (pool as { getConnection: jest.Mock }).getConnection.mock.calls.length;
    expect(callsAfterFirstRun).toBeGreaterThan(0);

    stopOutboxWorker();
    startOutboxWorker(pool, 10);
    jest.advanceTimersByTime(25);

    expect((pool as { getConnection: jest.Mock }).getConnection.mock.calls.length).toBeGreaterThan(
      callsAfterFirstRun
    );
  });
});

/**
 * Real timers, deliberately: this is the one property fake timers cannot
 * observe, since `jest.useFakeTimers()` replaces the timer implementation
 * entirely and never exercises Node's real ref-counting. It is also the most
 * direct regression pin for #394 — an interval that keeps its ref would (a)
 * keep a bare `node index.js` process alive on its own with nothing left to
 * do, and (b) is exactly the kind of handle that outlives its owning test and
 * fires later, in whatever suite happens to be running under --runInBand.
 */
describe('startOutboxWorker (real timers)', () => {
  afterEach(() => {
    // Belt and suspenders: the interval is unref'd so it cannot keep the
    // process alive by itself, but stopping it anyway is the same discipline
    // every other describe block in this file already follows, and costs
    // nothing.
    stopOutboxWorker();
  });

  it('unrefs its interval, so it cannot keep the process alive by itself', () => {
    isEmailConfigured.mockReturnValue(true);
    const pool = poolWith(makeConn([]));
    const setIntervalSpy = jest.spyOn(global, 'setInterval');

    startOutboxWorker(pool, 60_000);

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    const handle = setIntervalSpy.mock.results[0].value as ReturnType<typeof setInterval>;
    expect(handle.hasRef()).toBe(false);

    setIntervalSpy.mockRestore();
  });
});
