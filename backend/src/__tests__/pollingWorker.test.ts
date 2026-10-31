/**
 * PollingWorker unit tests — the shared machinery extracted from the five
 * outbox-style workers (email, web push, native push, webhooks, payroll
 * export). Each worker's own test suite already exercises this through its
 * specific claim/deliver/outcome config; these pin the shared behavior
 * directly, independent of any one worker's row shape.
 */

import type { RowDataPacket } from 'mysql2/promise';
import { createPollingWorker, runPollingBatch } from '../services/PollingWorker';
import { logger } from '../config/logger';

interface Row extends RowDataPacket {
  id: number;
  attempts: number;
}

const makeConn = () => ({
  beginTransaction: jest.fn().mockResolvedValue(undefined),
  commit: jest.fn().mockResolvedValue(undefined),
  rollback: jest.fn().mockResolvedValue(undefined),
  release: jest.fn(),
});

const makePool = (conn: ReturnType<typeof makeConn>) =>
  ({ getConnection: jest.fn().mockResolvedValue(conn) }) as never;

describe('runPollingBatch', () => {
  it('commits and returns the claimed count when every row delivers', async () => {
    const conn = makeConn();
    const onSent = jest.fn().mockResolvedValue(undefined);
    const count = await runPollingBatch(makePool(conn), {
      label: 'Test',
      attemptsOf: (r: Row) => r.attempts,
      claim: async () => [{ id: 1, attempts: 0 } as Row, { id: 2, attempts: 0 } as Row],
      deliver: async () => undefined,
      outcome: { onSent, onFailure: jest.fn() },
    });

    expect(count).toBe(2);
    expect(onSent).toHaveBeenCalledTimes(2);
    expect(conn.commit).toHaveBeenCalled();
    expect(conn.rollback).not.toHaveBeenCalled();
  });

  it('routes a per-row delivery failure to onFailure with the incremented attempt count, and still commits', async () => {
    const conn = makeConn();
    const onFailure = jest.fn().mockResolvedValue(undefined);
    const boom = new Error('delivery failed');
    const count = await runPollingBatch(makePool(conn), {
      label: 'Test',
      attemptsOf: (r: Row) => r.attempts,
      claim: async () => [{ id: 1, attempts: 2 } as Row],
      deliver: async () => {
        throw boom;
      },
      outcome: { onSent: jest.fn(), onFailure },
    });

    expect(count).toBe(1);
    expect(onFailure).toHaveBeenCalledWith(conn, { id: 1, attempts: 2 }, 3, 'delivery failed', boom);
    expect(conn.commit).toHaveBeenCalled();
  });

  it('stringifies a non-Error thrown by deliver', async () => {
    const conn = makeConn();
    const onFailure = jest.fn().mockResolvedValue(undefined);
    await runPollingBatch(makePool(conn), {
      label: 'Test',
      attemptsOf: (r: Row) => r.attempts,
      claim: async () => [{ id: 1, attempts: 0 } as Row],
      deliver: async () => {
        throw 'plain string failure';
      },
      outcome: { onSent: jest.fn(), onFailure },
    });

    expect(onFailure.mock.calls[0][3]).toBe('plain string failure');
  });

  it('rolls back and returns 0 when the claim query itself throws', async () => {
    const conn = makeConn();
    const count = await runPollingBatch(makePool(conn), {
      label: 'Test',
      attemptsOf: (r: Row) => r.attempts,
      claim: async () => {
        throw new Error('connection reset');
      },
      deliver: async () => undefined,
      outcome: { onSent: jest.fn(), onFailure: jest.fn() },
    });

    expect(count).toBe(0);
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it('releases the connection whether the batch succeeds or the poll itself fails', async () => {
    const okConn = makeConn();
    await runPollingBatch(makePool(okConn), {
      label: 'Test',
      attemptsOf: (r: Row) => r.attempts,
      claim: async () => [],
      deliver: async () => undefined,
      outcome: { onSent: jest.fn(), onFailure: jest.fn() },
    });
    expect(okConn.release).toHaveBeenCalledTimes(1);

    const failConn = makeConn();
    await runPollingBatch(makePool(failConn), {
      label: 'Test',
      attemptsOf: (r: Row) => r.attempts,
      claim: async () => {
        throw new Error('x');
      },
      deliver: async () => undefined,
      outcome: { onSent: jest.fn(), onFailure: jest.fn() },
    });
    expect(failConn.release).toHaveBeenCalledTimes(1);
  });
});

describe('createPollingWorker', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('polls on the given interval and unrefs the timer', async () => {
    const processOnce = jest.fn().mockResolvedValue(0);
    const worker = createPollingWorker('Test worker', processOnce);
    const setIntervalSpy = jest.spyOn(global, 'setInterval');

    worker.start({} as never, 1000);
    // Async: a tick that has not settled yet blocks the next one (#825), so
    // each tick's promise must be allowed to resolve between timer firings.
    await jest.advanceTimersByTimeAsync(2500);

    expect(processOnce).toHaveBeenCalledTimes(2);
    const handle = setIntervalSpy.mock.results[0].value as ReturnType<typeof setInterval>;
    expect(handle.hasRef()).toBe(false);

    worker.stop();
    setIntervalSpy.mockRestore();
  });

  it('does not start a second interval while one is already running', () => {
    const worker = createPollingWorker('Test worker', jest.fn().mockResolvedValue(0));
    worker.start({} as never, 1000);
    const countAfterFirst = jest.getTimerCount();
    worker.start({} as never, 1000);
    expect(jest.getTimerCount()).toBe(countAfterFirst);
    worker.stop();
  });

  it('does not start when isEnabled returns false', () => {
    const processOnce = jest.fn().mockResolvedValue(0);
    const worker = createPollingWorker('Test worker', processOnce);
    worker.start({} as never, 1000, () => false);
    jest.advanceTimersByTime(5000);
    expect(processOnce).not.toHaveBeenCalled();
  });

  it('starts when isEnabled returns true', () => {
    const processOnce = jest.fn().mockResolvedValue(0);
    const worker = createPollingWorker('Test worker', processOnce);
    worker.start({} as never, 1000, () => true);
    jest.advanceTimersByTime(1000);
    expect(processOnce).toHaveBeenCalledTimes(1);
    worker.stop();
  });

  it('stop is a no-op when the worker was never started', () => {
    const worker = createPollingWorker('Test worker', jest.fn());
    expect(() => worker.stop()).not.toThrow();
  });

  it('allows restarting after stop', () => {
    const processOnce = jest.fn().mockResolvedValue(0);
    const worker = createPollingWorker('Test worker', processOnce);
    worker.start({} as never, 1000);
    worker.stop();
    worker.start({} as never, 1000);
    jest.advanceTimersByTime(1000);
    expect(processOnce).toHaveBeenCalledTimes(1);
    worker.stop();
  });
});

/**
 * A database outage must not take the process down through a worker (#825).
 *
 * Every replica runs these pollers, so a poll whose rejection escapes as an
 * unhandled rejection crash-loops the whole fleet for as long as MySQL is
 * down. The worker owns its tick: it catches, logs the outage once rather than
 * once per tick, backs off, and never overlaps a tick still in flight.
 */
describe('createPollingWorker — failure handling (#825)', () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  beforeEach(() => {
    jest.useFakeTimers();
    unhandled.length = 0;
    process.on('unhandledRejection', onUnhandled);
  });
  afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
    jest.useRealTimers();
  });

  /** Lets the rejected tick's promise chain settle under fake timers. */
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  it('catches a rejected tick (the pool cannot connect) and logs it, leaving no unhandled rejection', async () => {
    const error = jest.spyOn(logger, 'error').mockImplementation(() => logger);
    const processOnce = jest.fn().mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
    const worker = createPollingWorker('Test worker', processOnce);

    worker.start({} as never, 1000);
    jest.advanceTimersByTime(1000);
    await flush();
    // Give Node a turn to report an unhandled rejection, if there is one.
    jest.useRealTimers();
    await new Promise((resolve) => setImmediate(resolve));

    expect(unhandled).toEqual([]);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Test worker'), expect.anything());
    worker.stop();
    error.mockRestore();
  });

  it('logs an outage once, not once per tick, and backs off between attempts', async () => {
    const error = jest.spyOn(logger, 'error').mockImplementation(() => logger);
    const processOnce = jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));
    const worker = createPollingWorker('Test worker', processOnce);

    worker.start({} as never, 1000);
    for (let i = 0; i < 30; i++) {
      jest.advanceTimersByTime(1000);
      await flush();
    }

    // Exponential backoff from the poll interval: attempts at 1, 3, 7, 15 s…
    // rather than every one of the 30 ticks.
    expect(processOnce.mock.calls.length).toBeLessThanOrEqual(6);
    expect(processOnce.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(error.mock.calls.filter(([msg]) => String(msg).includes('Test worker'))).toHaveLength(1);
    worker.stop();
    error.mockRestore();
  });

  it('resumes the normal cadence, and logs the recovery, once a tick succeeds again', async () => {
    const error = jest.spyOn(logger, 'error').mockImplementation(() => logger);
    const info = jest.spyOn(logger, 'info').mockImplementation(() => logger);
    const processOnce = jest.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(0);
    const worker = createPollingWorker('Test worker', processOnce);

    worker.start({} as never, 1000);
    for (let i = 0; i < 10; i++) {
      jest.advanceTimersByTime(1000);
      await flush();
    }
    // One failure, one backed-off tick, then every tick again.
    expect(processOnce.mock.calls.length).toBeGreaterThanOrEqual(8);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('recovered'));
    worker.stop();
    error.mockRestore();
    info.mockRestore();
  });

  it('never starts a tick while the previous one is still running', async () => {
    let finish!: () => void;
    const processOnce = jest.fn().mockImplementation(
      () => new Promise<number>((resolve) => { finish = () => resolve(0); })
    );
    const worker = createPollingWorker('Test worker', processOnce);

    worker.start({} as never, 1000);
    jest.advanceTimersByTime(5000);
    await flush();
    expect(processOnce).toHaveBeenCalledTimes(1);

    finish();
    await flush();
    jest.advanceTimersByTime(1000);
    await flush();
    expect(processOnce).toHaveBeenCalledTimes(2);
    worker.stop();
  });
});

describe('runPollingBatch — a rollback that fails too (#825)', () => {
  it('still resolves to 0 when the rollback after a failed claim rejects (the connection is gone)', async () => {
    const conn = makeConn();
    conn.rollback.mockRejectedValue(new Error('Connection lost: The server closed the connection.'));
    const error = jest.spyOn(logger, 'error').mockImplementation(() => logger);
    await expect(
      runPollingBatch(makePool(conn), {
        label: 'Test',
        attemptsOf: (r: Row) => r.attempts,
        claim: async () => {
          throw new Error('Connection lost');
        },
        deliver: async () => undefined,
        outcome: { onSent: jest.fn(), onFailure: jest.fn() },
      })
    ).resolves.toBe(0);
    expect(conn.release).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});
