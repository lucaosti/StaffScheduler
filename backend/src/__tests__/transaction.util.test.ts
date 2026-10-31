/**
 * Tests for the connection-lifecycle helpers.
 *
 * These exist to pin the one property the helpers were introduced for: the
 * connection goes back to the pool on EVERY path, including the ones a hand-
 * written block is most likely to miss — a throw from the work, and a throw
 * from the rollback itself. 52 call sites depend on that, so it is asserted
 * directly rather than inferred from their behaviour.
 *
 * @author Luca Ostinelli
 */

import { usingConnection, withTransaction, TRANSACTION_ATTEMPTS } from '../utils/transaction';
import { ConflictError, ServiceUnavailableError } from '../errors';
import { logger } from '../config/logger';

const makePool = () => {
  const conn = {
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
    execute: jest.fn().mockResolvedValue([[], null]),
  };
  const pool = { getConnection: jest.fn().mockResolvedValue(conn) } as never;
  return { pool, conn };
};

describe('usingConnection', () => {
  it('hands the borrowed connection to the callback and returns its value', async () => {
    const { pool, conn } = makePool();
    const result = await usingConnection(pool, async (c) => {
      expect(c).toBe(conn);
      return 'value';
    });
    expect(result).toBe('value');
  });

  it('releases the connection when the work succeeds', async () => {
    const { pool, conn } = makePool();
    await usingConnection(pool, async () => undefined);
    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  it('releases the connection when the work throws', async () => {
    // The path a hand-written block omits by forgetting `finally`, and the one
    // that leaks: it only fires on failure, so it survives every happy-path
    // test and surfaces later as pool exhaustion.
    const { pool, conn } = makePool();
    await expect(
      usingConnection(pool, async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  it('propagates the original error object, not a wrapper', async () => {
    // Services throw typed errors and the route layer renders a status from
    // them; wrapping one here would turn a 409 into a 500.
    const { pool } = makePool();
    const original = new ConflictError('already exists');
    await expect(usingConnection(pool, async () => Promise.reject(original))).rejects.toBe(
      original
    );
  });

  it('does not begin a transaction of its own', async () => {
    // Transactions are the caller's business: the 45 sites with post-commit
    // work inside their try depend on this helper NOT owning the boundary.
    const { pool, conn } = makePool();
    await usingConnection(pool, async () => undefined);
    expect(conn.beginTransaction).not.toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.rollback).not.toHaveBeenCalled();
  });

  it('releases even when acquiring succeeded but the callback never resolves cleanly', async () => {
    const { pool, conn } = makePool();
    await expect(usingConnection(pool, () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(conn.release).toHaveBeenCalledTimes(1);
  });
});

describe('withTransaction', () => {
  it('begins, runs the work, commits, and returns its value', async () => {
    const { pool, conn } = makePool();
    const result = await withTransaction(pool, async () => 42);
    expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
    expect(result).toBe(42);
  });

  it('rolls back and rethrows when the work fails', async () => {
    const { pool, conn } = makePool();
    const failure = new ConflictError('conflict');
    await expect(withTransaction(pool, async () => Promise.reject(failure))).rejects.toBe(failure);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  /**
   * A failing rollback must not eat the error that explains the failure.
   *
   * `rollback()` talks to the server, so it fails precisely when the server is
   * the problem — and that is exactly when the original error (the constraint
   * violation, the NotFoundError) is most needed and least recoverable. Letting
   * the rollback's rejection escape would hand the caller the symptom and
   * discard the cause.
   */
  it('propagates the ORIGINAL error when the rollback also fails', async () => {
    const { pool, conn } = makePool();
    conn.rollback.mockRejectedValue(new Error('connection lost'));
    const original = new ConflictError('duplicate key');
    await expect(withTransaction(pool, async () => Promise.reject(original))).rejects.toBe(
      original
    );
  });

  it('logs the rollback failure rather than discarding it silently', async () => {
    const { pool, conn } = makePool();
    conn.rollback.mockRejectedValue(new Error('connection lost'));
    const error = jest.spyOn(logger, 'error').mockImplementation(() => logger);
    await expect(withTransaction(pool, async () => Promise.reject(new Error('original')))).rejects.toThrow(
      'original'
    );
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('Rollback failed'),
      expect.objectContaining({ rollbackError: 'connection lost', originalError: 'original' })
    );
    error.mockRestore();
  });

  it('releases the connection even if the rollback itself fails', async () => {
    // Otherwise a database that has already gone away takes a pooled
    // connection with it on every failing request.
    const { pool, conn } = makePool();
    conn.rollback.mockRejectedValue(new Error('connection lost'));
    await expect(
      withTransaction(pool, async () => {
        throw new Error('original');
      })
    ).rejects.toThrow('original');
    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  it('releases the connection when the commit fails', async () => {
    const { pool, conn } = makePool();
    conn.commit.mockRejectedValue(new Error('commit failed'));
    await expect(withTransaction(pool, async () => 'v')).rejects.toThrow('commit failed');
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  it('commits exactly once for a unit of work that succeeds', async () => {
    const { pool, conn } = makePool();
    await withTransaction(pool, async (c) => {
      await c.execute('INSERT INTO t VALUES (?)', [1]);
      await c.execute('UPDATE t SET x = ?', [2]);
    });
    expect(conn.execute).toHaveBeenCalledTimes(2);
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });
});

/**
 * A deadlock is InnoDB choosing a victim, not a fault in the request (#964):
 * the victim's transaction is already rolled back and running it again is the
 * documented remedy. So the helper retries the whole unit of work a bounded
 * number of times, and only a transaction that keeps losing surfaces — as a
 * typed 503, never as the generic 500.
 */
describe('withTransaction — lock-conflict retry (#964)', () => {
  const lockError = (code: string, errno: number) => Object.assign(new Error(code), { code, errno });

  it.each([
    ['ER_LOCK_DEADLOCK', 1213],
    ['ER_LOCK_WAIT_TIMEOUT', 1205],
  ])('runs the work again after %s and returns its value', async (code, errno) => {
    const { pool, conn } = makePool();
    const work = jest.fn().mockRejectedValueOnce(lockError(code, errno)).mockResolvedValueOnce('second try');
    await expect(withTransaction(pool, work)).resolves.toBe('second try');
    expect(work).toHaveBeenCalledTimes(2);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.release).toHaveBeenCalledTimes(2);
  });

  it('gives up after a bounded number of attempts with a 503, not a 500', async () => {
    const { pool } = makePool();
    const work = jest.fn().mockRejectedValue(lockError('ER_LOCK_DEADLOCK', 1213));
    const failure = await withTransaction(pool, work).catch((e: unknown) => e);
    expect(work).toHaveBeenCalledTimes(TRANSACTION_ATTEMPTS);
    expect(failure).toBeInstanceOf(ServiceUnavailableError);
    expect(failure).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
  });

  it('does not retry any other failure', async () => {
    const { pool } = makePool();
    const original = new ConflictError('duplicate key');
    const work = jest.fn().mockRejectedValue(original);
    await expect(withTransaction(pool, work)).rejects.toBe(original);
    expect(work).toHaveBeenCalledTimes(1);
  });
});
