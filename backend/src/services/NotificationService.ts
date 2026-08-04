/**
 * Notifications service (F03).
 *
 * Stores per-user in-app notifications. Other services call `notify()`
 * after meaningful events (assignment created, shift swap approved,
 * time-off accepted, etc.). Email delivery is best-effort: if a transport
 * has been configured we'll fire one off; otherwise we just keep the
 * in-app row.
 *
 * @author Luca Ostinelli
 */

import { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { logger } from '../config/logger';
import { isEmailConfigured } from './MailerService';
import { isPushConfigured } from './PushService';

interface Notification {
  id: number;
  userId: number;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  isRead: boolean;
  createdAt: string;
  readAt: string | null;
}

interface CreateNotificationInput {
  userId: number;
  type: string;
  title: string;
  body?: string;
  link?: string;
}

const mapRow = (row: RowDataPacket): Notification => ({
  id: row.id as number,
  userId: row.user_id as number,
  type: row.type as string,
  title: row.title as string,
  body: (row.body as string) ?? null,
  link: (row.link as string) ?? null,
  isRead: Boolean(row.is_read),
  createdAt: row.created_at as string,
  readAt: (row.read_at as string | null) ?? null,
});

export class NotificationService {
  constructor(private pool: Pool) {}

  /**
   * The same two writes, on a caller's connection and inside their transaction.
   *
   * WHY THIS IS EXPOSED. Some events must not be able to happen without the
   * person hearing about it — applying a replanning plan removes shifts people
   * were told they were working. Calling `notify()` there would open a SECOND
   * transaction: the plan could commit and the notification fail, leaving
   * someone unassigned and uninformed, which is the failure the outbox exists
   * to rule out. Joining the caller's transaction makes the notification as
   * durable as the change it announces.
   *
   * Returns the new notification's id rather than the row: the caller's
   * transaction has not committed yet, so reading it back through the pool
   * would not see it.
   */
  async notifyWithin(conn: PoolConnection, input: CreateNotificationInput): Promise<number> {
    const [res] = await conn.execute<ResultSetHeader>(
      `INSERT INTO notifications (user_id, type, title, body, link)
       VALUES (?, ?, ?, ?, ?)`,
      [input.userId, input.type, input.title, input.body ?? null, input.link ?? null]
    );

    // Same-transaction outbox write — only when email can actually be sent and
    // the recipient has an address, so a no-SMTP deployment never accumulates
    // rows and the no-email path is unchanged.
    if (isEmailConfigured()) {
      const [users] = await conn.execute<RowDataPacket[]>(
        `SELECT email FROM users WHERE id = ? LIMIT 1`,
        [input.userId]
      );
      const recipient = users[0]?.email as string | undefined;
      if (recipient) {
        await conn.execute(
          `INSERT INTO email_outbox (notification_id, recipient_email, subject, body)
           VALUES (?, ?, ?, ?)`,
          [res.insertId, recipient, input.title, input.body ?? input.title]
        );
      }
    }

    // Same reasoning, same transaction, for Web Push (#310): one outbox row
    // per ACTIVE device subscription the recipient has registered, so a
    // person with push on two devices gets it on both, and one with none
    // configured accumulates nothing.
    if (isPushConfigured()) {
      const [subscriptions] = await conn.execute<RowDataPacket[]>(
        `SELECT id FROM push_subscriptions WHERE user_id = ? AND is_active = TRUE`,
        [input.userId]
      );
      if (subscriptions.length > 0) {
        const payload = JSON.stringify({ title: input.title, body: input.body, link: input.link });
        for (const sub of subscriptions) {
          await conn.execute(
            `INSERT INTO push_outbox (notification_id, subscription_id, payload)
             VALUES (?, ?, ?)`,
            [res.insertId, sub.id, payload]
          );
        }
      }
    }
    return res.insertId;
  }

  /**
   * Create an in-app notification and, when email is configured, atomically
   * enqueue its email in the outbox (transactional outbox pattern). Both writes
   * commit together or not at all, so a delivered notification always has its
   * email intent recorded, and a rolled-back one never leaves a phantom email.
   * The email is delivered later by the outbox worker with retries.
   */
  async notify(input: CreateNotificationInput): Promise<Notification> {
    const conn = await this.pool.getConnection();
    let insertId: number;
    try {
      await conn.beginTransaction();
      insertId = await this.notifyWithin(conn, input);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    const created = await this.getById(insertId);
    if (!created) throw new Error('Failed to retrieve created notification');
    logger.info(`Notification created: id=${created.id} user=${input.userId} type=${input.type}`);
    return created;
  }

  /**
   * Fire-and-forget variant of notify(). Errors are logged but never propagate
   * to the caller. Use in batch loops where a single failed notification should
   * not abort the surrounding operation.
   */
  notifyAsync(input: CreateNotificationInput): void {
    this.notify(input).catch((err) =>
      logger.error('Background notification failed', {
        error: (err as Error).message,
        userId: input.userId,
        type: input.type,
      })
    );
  }

  async getById(id: number): Promise<Notification | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM notifications WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows.length === 0 ? null : mapRow(rows[0]);
  }

  async listForUser(
    userId: number,
    options: { unreadOnly?: boolean; limit?: number } = {}
  ): Promise<Notification[]> {
    const limit = Math.max(1, Math.min(200, options.limit ?? 50));
    const conditions = ['user_id = ?'];
    const params: Array<string | number> = [userId];
    if (options.unreadOnly) {
      conditions.push('is_read = 0');
    }
    // See AuditLogService.list: a bound LIMIT fails under the prepared-statement
    // protocol, so GET /api/notifications returned 500 on every call. `limit` is
    // clamped to 1..200 above, never raw input.
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM notifications
        WHERE ${conditions.join(' AND ')}
        ORDER BY created_at DESC
        LIMIT ${limit}`,
      params
    );
    return rows.map(mapRow);
  }

  async markRead(id: number, userId: number): Promise<boolean> {
    const [res] = await this.pool.execute<ResultSetHeader>(
      `UPDATE notifications
          SET is_read = 1, read_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ? AND is_read = 0`,
      [id, userId]
    );
    return res.affectedRows > 0;
  }

  async markAllRead(userId: number): Promise<number> {
    const [res] = await this.pool.execute<ResultSetHeader>(
      `UPDATE notifications
          SET is_read = 1, read_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND is_read = 0`,
      [userId]
    );
    return res.affectedRows;
  }

  async unreadCount(userId: number): Promise<number> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0`,
      [userId]
    );
    return (rows[0] as { c: number }).c;
  }
}
