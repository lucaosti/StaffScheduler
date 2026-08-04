/**
 * Web Push outbox delivery worker (#310).
 *
 * Mirrors OutboxWorker's shape exactly (poll interval, FOR UPDATE SKIP
 * LOCKED batch claim, attempt counting, unref'd timer) — see that file for
 * the rationale, which applies unchanged here. The one real difference:
 * a push send failing with 404/410 means the push service has permanently
 * discarded the subscription (the user uninstalled the app, revoked
 * permission, or the browser rotated the endpoint), which is not a
 * transient failure to retry — the subscription is deactivated immediately
 * instead of being retried up to MAX_ATTEMPTS.
 *
 * @author Luca Ostinelli
 */

import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { logger } from '../config/logger';
import { isPushConfigured, sendPush } from './PushService';

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 20;
const DEFAULT_POLL_MS = 30_000;

let timer: ReturnType<typeof setInterval> | null = null;

interface PushOutboxRow extends RowDataPacket {
  id: number;
  subscription_id: number;
  payload: string;
  attempts: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** A push-service response carries the failure reason as an HTTP status code. */
const isGoneStatus = (err: unknown): boolean => {
  const status = (err as { statusCode?: number } | undefined)?.statusCode;
  return status === 404 || status === 410;
};

/**
 * Process one batch of pending push messages. Returns the number of rows
 * attempted. Exported for tests and one-shot drains, same as
 * `processOutboxOnce`.
 */
export async function processPushOutboxOnce(pool: Pool): Promise<number> {
  const conn: PoolConnection = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<PushOutboxRow[]>(
      `SELECT po.id, po.subscription_id, po.payload, po.attempts,
              ps.endpoint, ps.p256dh, ps.auth
         FROM push_outbox po
         JOIN push_subscriptions ps ON ps.id = po.subscription_id
        WHERE po.status = 'pending' AND po.attempts < ?
        ORDER BY po.created_at
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED`,
      [MAX_ATTEMPTS]
    );

    for (const row of rows) {
      try {
        await sendPush(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          JSON.parse(row.payload)
        );
        await conn.execute(
          `UPDATE push_outbox SET status = 'sent', attempts = attempts + 1, processed_at = NOW()
            WHERE id = ?`,
          [row.id]
        );
      } catch (err) {
        const attempts = row.attempts + 1;
        const gone = isGoneStatus(err);
        const failed = gone || attempts >= MAX_ATTEMPTS;
        const message = err instanceof Error ? err.message : String(err);
        await conn.execute(
          `UPDATE push_outbox
              SET status = ?, attempts = ?, last_error = ?, processed_at = ?
            WHERE id = ?`,
          [failed ? 'failed' : 'pending', attempts, message, failed ? new Date() : null, row.id]
        );
        if (gone) {
          await conn.execute(`UPDATE push_subscriptions SET is_active = FALSE WHERE id = ?`, [
            row.subscription_id,
          ]);
        }
        logger.warn(
          `Push outbox ${row.id} delivery failed (attempt ${attempts}/${MAX_ATTEMPTS})${gone ? ' — subscription gone, deactivated' : failed ? ' — giving up' : ''}: ${message}`
        );
      }
    }

    await conn.commit();
    return rows.length;
  } catch (err) {
    await conn.rollback();
    logger.error('Push outbox poll failed', { error: err instanceof Error ? err.message : err });
    return 0;
  } finally {
    conn.release();
  }
}

/**
 * Starts the poller when Web Push is configured. Call once at startup; the
 * timer is unref'd so it never keeps the process alive on its own.
 */
export function startPushWorker(pool: Pool, pollMs: number = DEFAULT_POLL_MS): void {
  if (!isPushConfigured() || timer) return;
  timer = setInterval(() => {
    void processPushOutboxOnce(pool);
  }, pollMs);
  timer.unref?.();
  logger.info('Web Push outbox worker started');
}

/** Stop the poller on graceful shutdown. */
export function stopPushWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
