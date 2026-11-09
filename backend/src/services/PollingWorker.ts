/**
 * Shared machinery for the outbox-style delivery workers (email, web push,
 * native push, webhooks, payroll export).
 *
 * All five follow the identical shape independently documented in each of
 * their own files: poll on an interval, claim a disjoint batch with
 * `FOR UPDATE SKIP LOCKED` inside one transaction, attempt delivery per row,
 * commit, and expose start/stop with a singleton unref'd timer so replicas
 * can run the same worker without duplicating deliveries and a bare process
 * never gets kept alive by a timer alone (#394). That shape was previously
 * hand-copied five times — this module is the one implementation; each
 * worker file supplies only what's actually different: the claim query, how
 * to deliver one row, and how a delivery's outcome gets written back.
 *
 * @author Luca Ostinelli
 */

import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { usingConnection } from '../utils/transaction';
import { logger } from '../config/logger';

/**
 * One poll's outcome for a single claimed row: either it was delivered, or
 * it failed and the caller needs to record why (and whether that failure is
 * terminal — e.g. a push subscription reported permanently gone — rather
 * than one to retry).
 */
export interface DeliveryOutcome<Row, Result> {
  onSent(conn: PoolConnection, row: Row, result: Result): Promise<void>;
  onFailure(conn: PoolConnection, row: Row, attempts: number, message: string, err: unknown): Promise<void>;
}

export interface PollingBatchConfig<Row extends RowDataPacket, Result = void> {
  /** Name used in log lines, e.g. "Webhook outbox". */
  label: string;
  /** The row's own current attempt count, read after `deliver` throws. */
  attemptsOf(row: Row): number;
  /** Claims and returns the batch inside the already-open transaction. */
  claim(conn: PoolConnection): Promise<Row[]>;
  /**
   * Attempts delivery for one row, resolving with whatever `onSent` needs to
   * record (e.g. the response status). Throws (any value) on failure.
   */
  deliver(row: Row): Promise<Result>;
  /** Writes back one row's outcome — success or failure — inside the transaction. */
  outcome: DeliveryOutcome<Row, Result>;
}

/**
 * Claims one batch, attempts delivery for each row, and commits every
 * outcome in the same transaction the batch was claimed in — so a crash
 * between claim and write-back never double-delivers (the claim is rolled
 * back with everything else) and never loses the claim silently either.
 *
 * Returns the number of rows attempted, or 0 if the poll itself failed
 * (connection/query error) before any row was reached.
 */
export async function runPollingBatch<Row extends RowDataPacket, Result = void>(
  pool: Pool,
  config: PollingBatchConfig<Row, Result>
): Promise<number> {
  return usingConnection(pool, async (conn) => {
    try {
      await conn.beginTransaction();
      const rows = await config.claim(conn);

      for (const row of rows) {
        try {
          const result = await config.deliver(row);
          await config.outcome.onSent(conn, row, result);
        } catch (err) {
          const attempts = config.attemptsOf(row) + 1;
          const message = err instanceof Error ? err.message : String(err);
          await config.outcome.onFailure(conn, row, attempts, message, err);
        }
      }

      await conn.commit();
      return rows.length;
    } catch (err) {
      // Guarded: a poll fails mostly because the connection or the server
      // went away, which is exactly when the rollback fails too. Unguarded,
      // that second rejection escaped the tick as an unhandled rejection and
      // took the process down with it (#825).
      await conn.rollback().catch(() => undefined);
      logger.error(`${config.label} poll failed`, { error: err instanceof Error ? err.message : err });
      return 0;
    }
  });
}

/** Longest pause between attempts while a worker's dependency stays down. */
const MAX_BACKOFF_MS = 60_000;

export interface PollingWorkerController {
  /**
   * Starts the periodic poller. A no-op if already running, or if `isEnabled`
   * is given and returns false — the worker's own gate (e.g. SMTP configured)
   * rather than this module's concern. The timer is unref'd so it can never
   * keep a bare process alive by itself.
   */
  start(pool: Pool, pollMs: number, isEnabled?: () => boolean): void;
  /** Stops the poller. Safe to call whether or not it was running. */
  stop(): void;
}

/**
 * Builds the start/stop pair for one worker: a singleton unref'd interval
 * timer calling `processOnce`, with its own module-scoped handle so a
 * second `start()` while one is already running arms nothing new.
 *
 * WHY THE TICK OWNS ITS FAILURES (#825). The tick used to be
 * `void processOnce(pool)`. When MySQL is down, `pool.getConnection()`
 * rejects before `runPollingBatch` reaches its own catch, the rejection had
 * no handler, and Node's default for an unhandled rejection is to exit — so
 * every replica, all polling the same database, crash-looped for as long as
 * the outage lasted. The tick now:
 *
 *   - catches everything `processOnce` rejects with, so nothing escapes;
 *   - logs an outage once, at its start, and once more when it ends, rather
 *     than at every tick of a multi-minute outage;
 *   - backs off exponentially from the poll interval (capped at a minute),
 *     so a down database is not hammered by five workers on every replica;
 *   - never starts while the previous tick is still running, so a slow or
 *     hanging poll cannot stack concurrent claims behind it.
 *
 * Backoff is measured against the interval timer rather than re-arming a
 * timeout per tick: the single unref'd interval stays the only timer, which
 * keeps start/stop and the "never keeps a bare process alive" property
 * exactly as they were.
 */
export function createPollingWorker(label: string, processOnce: (pool: Pool) => Promise<number>): PollingWorkerController {
  let timer: ReturnType<typeof setInterval> | null = null;
  /**
   * One run's tick. The in-flight flag and the backoff belong to the run, not
   * to the worker: a tick still in flight when the worker is stopped must not
   * hold back the ticks of a run started after it.
   */
  const createTick = (pool: Pool, pollMs: number) => {
    let running = false;
    let failures = 0;
    let nextAttemptAt = 0;
    return async (): Promise<void> => {
      if (running || Date.now() < nextAttemptAt) return;
      running = true;
      try {
        await processOnce(pool);
        if (failures > 0) logger.info(`${label} worker recovered after ${failures} failed poll(s)`);
        failures = 0;
        nextAttemptAt = 0;
      } catch (err) {
        failures += 1;
        const backoffMs = Math.min(pollMs * 2 ** failures, MAX_BACKOFF_MS);
        nextAttemptAt = Date.now() + backoffMs;
        if (failures === 1) {
          logger.error(`${label} worker poll failed; backing off until it recovers`, {
            error: err instanceof Error ? err.message : String(err),
            code: (err as { code?: unknown } | null)?.code,
          });
        } else {
          logger.debug(`${label} worker poll still failing`, { failures, backoffMs });
        }
      } finally {
        running = false;
      }
    };
  };

  return {
    start(pool: Pool, pollMs: number, isEnabled?: () => boolean): void {
      if (timer || (isEnabled && !isEnabled())) return;
      const tick = createTick(pool, pollMs);
      timer = setInterval(() => {
        void tick();
      }, pollMs);
      timer.unref?.();
      logger.info(`${label} worker started`);
    },
    stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
