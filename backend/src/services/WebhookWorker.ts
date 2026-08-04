/**
 * Outbound webhook delivery worker (#315).
 *
 * Same shape as OutboxWorker/PushWorker (interval poll, FOR UPDATE SKIP
 * LOCKED batch claim, unref'd timer — see OutboxWorker for the #394
 * rationale), plus exponential backoff: `next_attempt_at` is pushed forward
 * on every failure (2^attempts minutes, capped at 60) instead of the flat
 * "eligible again next poll" the other two outboxes use, because a webhook
 * endpoint that's down tends to stay down — see the migration header for why
 * that distinction matters here specifically.
 *
 * Unlike email/push, there is no "is this configured" gate: a webhook
 * delivery only exists because WebhookService.dispatch already found a
 * matching active subscription, so the worker always polls — an
 * organization with none simply never has rows to find.
 *
 * @author Luca Ostinelli
 */

import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { logger } from '../config/logger';
import { signPayload } from './WebhookService';

const MAX_ATTEMPTS = 6;
const BATCH_SIZE = 20;
const DEFAULT_POLL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_BACKOFF_MINUTES = 60;

let timer: ReturnType<typeof setInterval> | null = null;

interface WebhookDeliveryRow extends RowDataPacket {
  id: number;
  subscription_id: number;
  event_type: string;
  payload: string;
  attempts: number;
  url: string;
  secret: string;
}

const backoffMinutes = (attempts: number): number => Math.min(2 ** attempts, MAX_BACKOFF_MINUTES);

/** POSTs one signed delivery. Throws on any non-2xx response or network failure. */
async function deliver(row: WebhookDeliveryRow): Promise<{ status: number }> {
  const signature = signPayload(row.secret, row.payload);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(row.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
        'X-Webhook-Event': row.event_type,
      },
      body: row.payload,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw Object.assign(new Error(`Webhook endpoint responded ${response.status}`), {
        responseStatus: response.status,
      });
    }
    return { status: response.status };
  } finally {
    clearTimeout(timeout);
  }
}

/** Process one batch of pending deliveries. Returns the number attempted. */
export async function processWebhookOutboxOnce(pool: Pool): Promise<number> {
  const conn: PoolConnection = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<WebhookDeliveryRow[]>(
      `SELECT wd.id, wd.subscription_id, wd.event_type, wd.payload, wd.attempts,
              ws.url, ws.secret
         FROM webhook_deliveries wd
         JOIN webhook_subscriptions ws ON ws.id = wd.subscription_id
        WHERE wd.status = 'pending' AND wd.attempts < ? AND wd.next_attempt_at <= NOW()
        ORDER BY wd.created_at
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED`,
      [MAX_ATTEMPTS]
    );

    for (const row of rows) {
      try {
        const { status } = await deliver(row);
        await conn.execute(
          `UPDATE webhook_deliveries
              SET status = 'sent', attempts = attempts + 1, response_status = ?, processed_at = NOW()
            WHERE id = ?`,
          [status, row.id]
        );
      } catch (err) {
        const attempts = row.attempts + 1;
        const failed = attempts >= MAX_ATTEMPTS;
        const message = err instanceof Error ? err.message : String(err);
        const responseStatus = (err as { responseStatus?: number } | undefined)?.responseStatus ?? null;
        await conn.execute(
          `UPDATE webhook_deliveries
              SET status = ?, attempts = ?, response_status = ?, last_error = ?, processed_at = ?,
                  next_attempt_at = ?
            WHERE id = ?`,
          [
            failed ? 'failed' : 'pending',
            attempts,
            responseStatus,
            message,
            failed ? new Date() : null,
            new Date(Date.now() + backoffMinutes(attempts) * 60_000),
            row.id,
          ]
        );
        logger.warn(
          `Webhook delivery ${row.id} failed (attempt ${attempts}/${MAX_ATTEMPTS})${failed ? ' — giving up' : ` — retrying in ${backoffMinutes(attempts)}m`}: ${message}`
        );
      }
    }

    await conn.commit();
    return rows.length;
  } catch (err) {
    await conn.rollback();
    logger.error('Webhook outbox poll failed', { error: err instanceof Error ? err.message : err });
    return 0;
  } finally {
    conn.release();
  }
}

/** Starts the poller. Call once at startup; the timer is unref'd so it never keeps the process alive on its own. */
export function startWebhookWorker(pool: Pool, pollMs: number = DEFAULT_POLL_MS): void {
  if (timer) return;
  timer = setInterval(() => {
    void processWebhookOutboxOnce(pool);
  }, pollMs);
  timer.unref?.();
  logger.info('Webhook outbox worker started');
}

/** Stop the poller on graceful shutdown. */
export function stopWebhookWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
