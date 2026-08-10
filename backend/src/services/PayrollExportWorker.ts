/**
 * Payroll export delivery worker.
 *
 * Same shape as `WebhookWorker`: interval poll, `FOR UPDATE SKIP LOCKED`
 * batch claim, unref'd timer, exponential backoff on failure — now all via
 * `PollingWorker.ts`. A payroll export is an outbound call to a third party
 * that can be slow or transiently unavailable — the same case webhooks
 * already solve for, so this reuses the mechanism rather than inventing a
 * second one.
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
import { createPollingWorker, runPollingBatch } from './PollingWorker';

const MAX_ATTEMPTS = 6;
const BATCH_SIZE = 10;
const DEFAULT_POLL_MS = 60_000;
const MAX_BACKOFF_MINUTES = 60;

const PROVIDERS: Record<string, PayrollProvider> = {
  gusto: new GustoProvider(),
};

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
  const service = new PayrollExportService(pool);

  return runPollingBatch<PayrollExportJobRow, { providerReference: string }>(pool, {
    label: 'Payroll export outbox',
    attemptsOf: (row) => row.attempts,
    claim: (conn: PoolConnection) =>
      conn
        .query<PayrollExportJobRow[]>(
          `SELECT id, provider, range_start, range_end, attempts
             FROM payroll_export_jobs
            WHERE status = 'pending' AND attempts < ? AND next_attempt_at <= NOW()
            ORDER BY created_at
            LIMIT ${BATCH_SIZE}
            FOR UPDATE SKIP LOCKED`,
          [MAX_ATTEMPTS]
        )
        .then(([rows]) => rows),
    deliver: async (row) => {
      const provider = PROVIDERS[row.provider];
      if (!provider) {
        throw new Error(`No payroll provider registered for "${row.provider}"`);
      }
      const rangeStart = typeof row.range_start === 'string' ? row.range_start : String(row.range_start);
      const rangeEnd = typeof row.range_end === 'string' ? row.range_end : String(row.range_end);
      const batch = await service.buildBatch(rangeStart, rangeEnd);
      return provider.export(batch);
    },
    outcome: {
      onSent: (conn, row, result) =>
        conn
          .execute(
            `UPDATE payroll_export_jobs
                SET status = 'sent', attempts = attempts + 1, provider_reference = ?, processed_at = NOW()
              WHERE id = ?`,
            [result.providerReference, row.id]
          )
          .then(() => undefined),
      onFailure: async (conn, row, attempts, message) => {
        const failed = attempts >= MAX_ATTEMPTS;
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
      },
    },
  });
}

const worker = createPollingWorker('Payroll export outbox', processPayrollExportOutboxOnce);

/** Starts the poller. Call once at startup; the timer is unref'd so it never keeps the process alive on its own. */
export function startPayrollExportWorker(pool: Pool, pollMs: number = DEFAULT_POLL_MS): void {
  worker.start(pool, pollMs);
}

/** Stop the poller on graceful shutdown. */
export function stopPayrollExportWorker(): void {
  worker.stop();
}
