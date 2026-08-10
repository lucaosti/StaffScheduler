/**
 * PollingWorker unit tests — the shared machinery extracted from the five
 * outbox-style workers (email, web push, native push, webhooks, payroll
 * export). Each worker's own test suite already exercises this through its
 * specific claim/deliver/outcome config; these pin the shared behavior
 * directly, independent of any one worker's row shape.
 */

import type { RowDataPacket } from 'mysql2/promise';
import { createPollingWorker, runPollingBatch } from '../services/PollingWorker';

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

  it('polls on the given interval and unrefs the timer', () => {
    const processOnce = jest.fn().mockResolvedValue(0);
    const worker = createPollingWorker('Test worker', processOnce);
    const setIntervalSpy = jest.spyOn(global, 'setInterval');

    worker.start({} as never, 1000);
    jest.advanceTimersByTime(2500);

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
