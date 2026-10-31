/**
 * Borrowing a pooled connection so it cannot be leaked.
 *
 * WHY THIS EXISTS. 23 services each wrote the same connection lifecycle by
 * hand, 52 times over:
 *
 *   const conn = await this.pool.getConnection();
 *   try { … } catch { … } finally { conn.release(); }
 *
 * All 52 were written correctly. That is the argument FOR this helper rather
 * than against it: they were 52 independent chances to omit the `finally`, and
 * omitting it leaks a pooled connection on the error path only — a failure that
 * surfaces later, under load, as pool exhaustion, with nothing in the stack
 * pointing at the transaction that caused it. Here the release cannot be
 * forgotten, because there is one place left to forget it.
 *
 * WHY THIS DOES NOT OWN THE TRANSACTION. The obvious version of this helper
 * also runs `beginTransaction`/`commit`/`rollback` around the callback. It was
 * rejected after measuring the call sites: in 45 of the 52, work continues
 * AFTER `commit()` inside the same `try` — a post-commit read, a notification,
 * a log line. Handing the transaction to the helper would run that work inside
 * the transaction, silently changing what is atomic; splitting each site at its
 * commit boundary instead is 45 individual judgements about transaction scope,
 * in code where the tests mock the connection and mostly do not assert ordering
 * relative to `commit()`. Guaranteeing the release is the property worth having
 * structurally; the begin/commit/rollback stay visible at the call site, where
 * the reader can see exactly what is atomic. See #721.
 *
 * TWO CALL SITES DELIBERATELY KEEP THE EXPLICIT FORM, because a callback would
 * change their control flow rather than merely their shape:
 *
 *   - `UserDirectoryService.importFromVcf` borrows a connection INSIDE a `for`
 *     loop over vCards and uses `continue` to skip a bad card. A `continue`
 *     cannot cross a function boundary, and a `return` would abandon the
 *     remaining cards instead of skipping one.
 *   - `ShiftSwapService.respondAsTarget` returns early from inside the `try`
 *     while further work follows the statement; inside a callback that return
 *     would yield to the callback, not to the method, and the following work
 *     would run when today it does not.
 *
 * Both are correct as written. Rewriting them to fit the helper would mean
 * restructuring real control flow for uniformity's sake, which is the trade
 * this refactor exists to avoid.
 *
 * @author Luca Ostinelli
 */

import type { Pool, PoolConnection } from 'mysql2/promise';
import { logger } from '../config/logger';
import { ServiceUnavailableError } from '../errors';

/**
 * Runs `work` with a connection borrowed from `pool`, releasing it afterwards
 * whether `work` resolves or throws. Errors propagate untouched — a service's
 * typed errors (`ConflictError`, `NotFoundError`, …) are how the route layer
 * renders a status, so swallowing one here would turn a 409 into a 500.
 *
 * Transactions are the caller's business: begin, commit and roll back on the
 * connection this hands over.
 */
export const usingConnection = async <T>(
  pool: Pool,
  work: (conn: PoolConnection) => Promise<T>
): Promise<T> => {
  const conn = await pool.getConnection();
  try {
    return await work(conn);
  } finally {
    conn.release();
  }
};

/** How many times `withTransaction` runs a unit of work that keeps losing lock conflicts. */
export const TRANSACTION_ATTEMPTS = 3;

/** Base of the pause before a retry; each attempt waits longer, with jitter. */
const RETRY_BASE_DELAY_MS = 20;

/**
 * InnoDB's two lock-conflict outcomes: ER_LOCK_DEADLOCK (1213) — it picked
 * this transaction as a deadlock victim and rolled it back — and
 * ER_LOCK_WAIT_TIMEOUT (1205) — a lock was not granted within
 * `innodb_lock_wait_timeout`. Matched on the driver's code and errno, never
 * on the message.
 */
const isLockConflict = (error: unknown): boolean => {
  const { code, errno } = (error ?? {}) as { code?: unknown; errno?: unknown };
  return code === 'ER_LOCK_DEADLOCK' || code === 'ER_LOCK_WAIT_TIMEOUT' || errno === 1213 || errno === 1205;
};

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `work` inside a transaction: commits when it resolves, rolls back and
 * rethrows when it rejects, and always releases the connection.
 *
 * Used by `Database.transaction()` and available to any new call site whose
 * unit of work genuinely ends at the commit. Existing sites were deliberately
 * NOT migrated onto it — see the module header for why.
 *
 * WHY IT RETRIES A LOCK CONFLICT (#964). A deadlock is not a fault in the
 * request: InnoDB detected a cycle between two correct transactions and rolled
 * one back, and MySQL's documented remedy is to run that transaction again.
 * Concurrent org-unit placements hit exactly this (UPDATE then INSERT on the
 * same index ranges) and answered 500 for 61 of 130 requests at concurrency
 * 16. Ordering locks consistently removes the cycles a service can foresee;
 * gap locks between neighbouring keys can still produce ones it cannot, so the
 * retry lives here, once, rather than in each service. It is safe because the
 * whole unit of work — not one statement — is re-run on a fresh transaction,
 * after the server has already undone the first attempt; `work` must
 * therefore keep its side effects inside the transaction, which is the
 * contract of this helper anyway. Bounded and jittered so contending
 * transactions spread out instead of colliding again in lockstep; one that
 * keeps losing is reported as a 503 (retry later), never as the generic 500.
 *
 * Rejected: retrying inside every call site (52 hand-written transactions
 * would each need it, and most would not get it); retrying only the failed
 * statement (after a deadlock the transaction is gone, there is nothing left
 * to continue).
 */
export const withTransaction = async <T>(
  pool: Pool,
  work: (conn: PoolConnection) => Promise<T>
): Promise<T> => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await runTransaction(pool, work);
    } catch (error) {
      if (!isLockConflict(error)) throw error;
      if (attempt >= TRANSACTION_ATTEMPTS) {
        logger.warn('Transaction kept losing lock conflicts; giving up', {
          attempts: attempt,
          code: (error as { code?: string }).code,
        });
        throw new ServiceUnavailableError('The request conflicted with concurrent changes; please retry');
      }
      await pause(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1) * (0.5 + Math.random()));
    }
  }
};

const runTransaction = <T>(
  pool: Pool,
  work: (conn: PoolConnection) => Promise<T>
): Promise<T> =>
  usingConnection(pool, async (conn) => {
    try {
      await conn.beginTransaction();
      const result = await work(conn);
      await conn.commit();
      return result;
    } catch (error) {
      // WHY THE ROLLBACK IS ITSELF GUARDED. `rollback()` talks to the server,
      // so it fails exactly when the server is the problem — a dropped
      // connection, a timeout. Letting that rejection escape replaces the
      // error that actually explains the failure (the constraint violation,
      // the NotFoundError) with the symptom that followed it, and the original
      // is then unrecoverable: the caller sees "connection lost" and the real
      // cause is gone. The original always propagates; the rollback failure is
      // logged, because it is worth knowing and worth nothing as a return
      // value. A call site writing this by hand would have to think of it, and
      // none of the 52 that used to did.
      try {
        await conn.rollback();
      } catch (rollbackError) {
        logger.error('Rollback failed; propagating the original error', {
          rollbackError: (rollbackError as Error).message,
          originalError: (error as Error).message,
        });
      }
      throw error;
    }
  });
