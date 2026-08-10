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
  const conn: PoolConnection = await pool.getConnection();
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
    await conn.rollback();
    logger.error(`${config.label} poll failed`, { error: err instanceof Error ? err.message : err });
    return 0;
  } finally {
    conn.release();
  }
}

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
 */
export function createPollingWorker(label: string, processOnce: (pool: Pool) => Promise<number>): PollingWorkerController {
  let timer: ReturnType<typeof setInterval> | null = null;

  return {
    start(pool: Pool, pollMs: number, isEnabled?: () => boolean): void {
      if (timer || (isEnabled && !isEnabled())) return;
      timer = setInterval(() => {
        void processOnce(pool);
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
