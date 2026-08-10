/**
 * Native push outbox delivery worker.
 *
 * Mirrors `PushWorker`'s shape exactly (poll interval, `FOR UPDATE SKIP
 * LOCKED` batch claim, attempt counting, unref'd timer) — see that file for
 * the rationale, which applies unchanged here. The one real difference: a
 * `NativePushGoneError` (APNs/FCM reporting the token itself as permanently
 * invalid) deactivates the device token immediately instead of retrying it
 * up to MAX_ATTEMPTS, the same reasoning `PushWorker` applies to a 404/410.
 *
 * @author Luca Ostinelli
 */

import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { logger } from '../config/logger';
import { isNativePushConfigured, sendNativePush, NativePushGoneError, DevicePlatform } from './NativePushService';

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 20;
const DEFAULT_POLL_MS = 30_000;

let timer: ReturnType<typeof setInterval> | null = null;

interface NativePushOutboxRow extends RowDataPacket {
  id: number;
  device_token_id: number;
  payload: string;
  attempts: number;
  platform: DevicePlatform;
  token: string;
}

/**
 * Process one batch of pending native push messages. Returns the number of
 * rows attempted. Exported for tests and one-shot drains, same as
 * `processPushOutboxOnce`.
 */
export async function processNativePushOutboxOnce(pool: Pool): Promise<number> {
  const conn: PoolConnection = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<NativePushOutboxRow[]>(
      `SELECT npo.id, npo.device_token_id, npo.payload, npo.attempts,
              dpt.platform, dpt.token
         FROM native_push_outbox npo
         JOIN device_push_tokens dpt ON dpt.id = npo.device_token_id
        WHERE npo.status = 'pending' AND npo.attempts < ?
        ORDER BY npo.created_at
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED`,
      [MAX_ATTEMPTS]
    );

    for (const row of rows) {
      try {
        await sendNativePush({ platform: row.platform, token: row.token }, JSON.parse(row.payload));
        await conn.execute(
          `UPDATE native_push_outbox SET status = 'sent', attempts = attempts + 1, processed_at = NOW()
            WHERE id = ?`,
          [row.id]
        );
      } catch (err) {
        const attempts = row.attempts + 1;
        const gone = err instanceof NativePushGoneError;
        const failed = gone || attempts >= MAX_ATTEMPTS;
        const message = err instanceof Error ? err.message : String(err);
        await conn.execute(
          `UPDATE native_push_outbox
              SET status = ?, attempts = ?, last_error = ?, processed_at = ?
            WHERE id = ?`,
          [failed ? 'failed' : 'pending', attempts, message, failed ? new Date() : null, row.id]
        );
        if (gone) {
          await conn.execute(`UPDATE device_push_tokens SET is_active = FALSE WHERE id = ?`, [
            row.device_token_id,
          ]);
        }
        logger.warn(
          `Native push outbox ${row.id} delivery failed (attempt ${attempts}/${MAX_ATTEMPTS})${gone ? ' — token gone, deactivated' : failed ? ' — giving up' : ''}: ${message}`
        );
      }
    }

    await conn.commit();
    return rows.length;
  } catch (err) {
    await conn.rollback();
    logger.error('Native push outbox poll failed', { error: err instanceof Error ? err.message : err });
    return 0;
  } finally {
    conn.release();
  }
}

/**
 * Starts the poller when native push is configured. Call once at startup;
 * the timer is unref'd so it never keeps the process alive on its own.
 */
export function startNativePushWorker(pool: Pool, pollMs: number = DEFAULT_POLL_MS): void {
  if (!isNativePushConfigured() || timer) return;
  timer = setInterval(() => {
    void processNativePushOutboxOnce(pool);
  }, pollMs);
  timer.unref?.();
  logger.info('Native push outbox worker started');
}

/** Stop the poller on graceful shutdown. */
export function stopNativePushWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
