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

import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { logger } from '../config/logger';

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

  /** Best-effort write. Callers should not block on the result. */
  async notify(input: CreateNotificationInput): Promise<Notification> {
    const [res] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO notifications (user_id, type, title, body, link)
       VALUES (?, ?, ?, ?, ?)`,
      [input.userId, input.type, input.title, input.body ?? null, input.link ?? null]
    );
    const created = await this.getById(res.insertId);
    if (!created) throw new Error('Failed to retrieve created notification');
    logger.info(`Notification created: id=${created.id} user=${input.userId} type=${input.type}`);
    return created;
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
