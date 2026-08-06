/**
 * Payroll export delivery worker.
 *
 * Same shape as `WebhookWorker`: interval poll, `FOR UPDATE SKIP LOCKED`
 * batch claim, unref'd timer, exponential backoff on failure. A payroll
 * export is an outbound call to a third party that can be slow or
 * transiently unavailable — the same case webhooks already solve for, so
 * this reuses the mechanism rather than inventing a second one.
 *
 * Providers are looked up by the job's own `provider` column through a small
 * registry built once at module load — additive: a new provider is a new
 * entry in `PROVIDERS`, not a change to the polling loop.
 *
 * @author Luca Ostinelli
 */

import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { logger } from '../config/logger';
import { PayrollExportService } from './PayrollExportService';
import { GustoProvider } from './GustoProvider';
import type { PayrollProvider } from './PayrollProvider';

const MAX_ATTEMPTS = 6;
const BATCH_SIZE = 10;
const DEFAULT_POLL_MS = 60_000;
const MAX_BACKOFF_MINUTES = 60;

const PROVIDERS: Record<string, PayrollProvider> = {
  gusto: new GustoProvider(),
};

let timer: ReturnType<typeof setInterval> | null = null;

interface PayrollExportJobRow extends RowDataPacket {
  id: number;
  provider: string;
  range_start: string;
  range_end: string;
  attempts: number;
}

const backoffMinutes = (attempts: number): number => Math.min(2 ** attempts, MAX_BACKOFF_MINUTES);

/** Process one batch of pending export jobs. Returns the number attempted. */
export async function processPayrollExportOutboxOnce(pool: Pool): Promise<number> {
  const conn: PoolConnection = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<PayrollExportJobRow[]>(
      `SELECT id, provider, range_start, range_end, attempts
         FROM payroll_export_jobs
        WHERE status = 'pending' AND attempts < ? AND next_attempt_at <= NOW()
        ORDER BY created_at
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED`,
      [MAX_ATTEMPTS]
    );

    const service = new PayrollExportService(pool);

    for (const row of rows) {
      const provider = PROVIDERS[row.provider];
      try {
        if (!provider) {
          throw new Error(`No payroll provider registered for "${row.provider}"`);
        }
        const rangeStart = typeof row.range_start === 'string' ? row.range_start : String(row.range_start);
        const rangeEnd = typeof row.range_end === 'string' ? row.range_end : String(row.range_end);
        const batch = await service.buildBatch(rangeStart, rangeEnd);
        const { providerReference } = await provider.export(batch);
        await conn.execute(
          `UPDATE payroll_export_jobs
              SET status = 'sent', attempts = attempts + 1, provider_reference = ?, processed_at = NOW()
            WHERE id = ?`,
          [providerReference, row.id]
        );
      } catch (err) {
        const attempts = row.attempts + 1;
        const failed = attempts >= MAX_ATTEMPTS;
        const message = err instanceof Error ? err.message : String(err);
        await conn.execute(
          `UPDATE payroll_export_jobs
              SET status = ?, attempts = ?, last_error = ?, processed_at = ?, next_attempt_at = ?
            WHERE id = ?`,
          [
            failed ? 'failed' : 'pending',
            attempts,
            message,
            failed ? new Date() : null,
            new Date(Date.now() + backoffMinutes(attempts) * 60_000),
            row.id,
          ]
        );
        logger.warn(
          `Payroll export job ${row.id} (${row.provider}) failed (attempt ${attempts}/${MAX_ATTEMPTS})` +
            `${failed ? ' — giving up' : ` — retrying in ${backoffMinutes(attempts)}m`}: ${message}`
        );
      }
    }

    await conn.commit();
    return rows.length;
  } catch (err) {
    await conn.rollback();
    logger.error('Payroll export outbox poll failed', { error: err instanceof Error ? err.message : err });
    return 0;
  } finally {
    conn.release();
  }
}

/** Starts the poller. Call once at startup; the timer is unref'd so it never keeps the process alive on its own. */
export function startPayrollExportWorker(pool: Pool, pollMs: number = DEFAULT_POLL_MS): void {
  if (timer) return;
  timer = setInterval(() => {
    void processPayrollExportOutboxOnce(pool);
  }, pollMs);
  timer.unref?.();
  logger.info('Payroll export outbox worker started');
}

/** Stop the poller on graceful shutdown. */
export function stopPayrollExportWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
