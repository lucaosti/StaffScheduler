/**
 * Email outbox delivery worker.
 *
 * Polls the email_outbox table and delivers pending rows via MailerService,
 * completing the transactional-outbox pattern: NotificationService records the
 * email intent atomically with the notification, and this worker ships it
 * afterwards with retries. Delivery is therefore at-least-once and survives a
 * crash between commit and send.
 *
 * WHY POLLING (not a queue): the outbox already durably orders the work in the
 * database, so a simple interval poll is enough and adds no new infrastructure.
 * Rows are claimed with `FOR UPDATE SKIP LOCKED`, so running multiple backend
 * replicas is safe — each poll grabs a disjoint batch and no email is sent
 * twice by two workers racing.
 *
 * WHY GATED: the worker only runs when email is configured (isEmailConfigured);
 * a no-SMTP deployment never creates outbox rows and never starts the worker, so
 * there is nothing to poll and no wasted work.
 *
 * @author Luca Ostinelli
 */

import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { logger } from '../config/logger';
import { isEmailConfigured, sendEmail } from './MailerService';

/** Give up after this many attempts and mark the row failed (poison-message guard). */
const MAX_ATTEMPTS = 5;
/** Rows processed per poll — small so a lock during SMTP send is short-lived. */
const BATCH_SIZE = 20;
const DEFAULT_POLL_MS = 30_000;

let timer: ReturnType<typeof setInterval> | null = null;

interface OutboxRow extends RowDataPacket {
  id: number;
  recipient_email: string;
  subject: string;
  body: string | null;
  attempts: number;
}

/**
 * Process one batch of pending emails. Returns the number of rows attempted.
 * Each row's outcome is committed with the batch; a send failure increments the
 * attempt count and either leaves the row pending (retry next poll) or marks it
 * failed once MAX_ATTEMPTS is reached. Exported for tests and one-shot drains.
 */
export async function processOutboxOnce(pool: Pool): Promise<number> {
  const conn: PoolConnection = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Claim a disjoint batch; SKIP LOCKED lets parallel workers coexist.
    const [rows] = await conn.query<OutboxRow[]>(
      `SELECT id, recipient_email, subject, body, attempts
         FROM email_outbox
        WHERE status = 'pending' AND attempts < ?
        ORDER BY created_at
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED`,
      [MAX_ATTEMPTS]
    );

    for (const row of rows) {
      try {
        await sendEmail({ to: row.recipient_email, subject: row.subject, text: row.body ?? '' });
        await conn.execute(
          `UPDATE email_outbox SET status = 'sent', attempts = attempts + 1, processed_at = NOW()
            WHERE id = ?`,
          [row.id]
        );
      } catch (err) {
        const attempts = row.attempts + 1;
        const failed = attempts >= MAX_ATTEMPTS;
        const message = err instanceof Error ? err.message : String(err);
        await conn.execute(
          `UPDATE email_outbox
              SET status = ?, attempts = ?, last_error = ?, processed_at = ?
            WHERE id = ?`,
          [failed ? 'failed' : 'pending', attempts, message, failed ? new Date() : null, row.id]
        );
        logger.warn(
          `Outbox email ${row.id} delivery failed (attempt ${attempts}/${MAX_ATTEMPTS})${failed ? ' — giving up' : ''}: ${message}`
        );
      }
    }

    await conn.commit();
    return rows.length;
  } catch (err) {
    await conn.rollback();
    logger.error('Outbox poll failed', { error: err instanceof Error ? err.message : err });
    return 0;
  } finally {
    conn.release();
  }
}

/**
 * Start the periodic poller. No-op (returns without starting) when email is not
 * configured. Call once at startup; the timer is unref'd so it never keeps the
 * process alive on its own.
 */
export function startOutboxWorker(pool: Pool, pollMs: number = DEFAULT_POLL_MS): void {
  if (!isEmailConfigured() || timer) return;
  timer = setInterval(() => {
    void processOutboxOnce(pool);
  }, pollMs);
  timer.unref?.();
  logger.info('Email outbox worker started');
}

/** Stop the poller on graceful shutdown. */
export function stopOutboxWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
