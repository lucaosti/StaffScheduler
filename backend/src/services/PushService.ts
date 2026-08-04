/**
 * Web Push transport (web-push / VAPID) and subscription management (#310).
 *
 * Mirrors MailerService's shape deliberately: gated the same way
 * (`isPushConfigured()` — a deployment without VAPID keys sends nothing and
 * creates no outbox intent, same reasoning as `isEmailConfigured()`), and
 * the underlying `web-push` transport is configured lazily so importing this
 * module costs nothing until the first send.
 *
 * @author Luca Ostinelli
 */

import webpush from 'web-push';
import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { config } from '../config';

export interface PushSubscriptionKeys {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushSubscription {
  id: number;
  userId: number;
  endpoint: string;
  isActive: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

const mapRow = (row: RowDataPacket): PushSubscription => ({
  id: row.id as number,
  userId: row.user_id as number,
  endpoint: row.endpoint as string,
  isActive: Boolean(row.is_active),
  createdAt: row.created_at as string,
  lastUsedAt: (row.last_used_at as string | null) ?? null,
});

let vapidConfigured = false;

/** True when VAPID keys are present — the single gate every push write/send path consults. */
export function isPushConfigured(): boolean {
  return Boolean(config.webPush.vapidPublicKey && config.webPush.vapidPrivateKey);
}

/** Configures the web-push library's VAPID details exactly once. */
function ensureVapidConfigured(): void {
  if (vapidConfigured) return;
  webpush.setVapidDetails(
    config.webPush.vapidSubject,
    config.webPush.vapidPublicKey as string,
    config.webPush.vapidPrivateKey as string
  );
  vapidConfigured = true;
}

/** Test-only: clears the memoised VAPID configuration so a test can reconfigure it. */
export function resetVapidConfigured(): void {
  vapidConfigured = false;
}

export interface PushPayload {
  title: string;
  body?: string;
  link?: string;
}

/**
 * Delivers one push message to one subscription. Thrown errors carry
 * web-push's own `statusCode` — the outbox worker uses 404/410 to tell an
 * expired subscription (deactivate, don't retry) from a transient failure
 * (retry). Refuses to run when Web Push is not configured, which is a
 * programming error (callers must gate on isPushConfigured first) — the
 * same contract MailerService.sendEmail carries.
 */
export async function sendPush(subscription: PushSubscriptionKeys, payload: PushPayload): Promise<void> {
  if (!isPushConfigured()) {
    throw new Error('sendPush called while Web Push is not configured');
  }
  ensureVapidConfigured();
  await webpush.sendNotification(subscription, JSON.stringify(payload));
}

export class PushService {
  constructor(private pool: Pool) {}

  /**
   * Registers (or reactivates) a device subscription. `endpoint` is the
   * natural dedup key — re-subscribing the same browser install updates its
   * keys in place rather than accumulating duplicate rows.
   */
  async subscribe(userId: number, subscription: PushSubscriptionKeys): Promise<PushSubscription> {
    await this.pool.execute<ResultSetHeader>(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, is_active)
       VALUES (?, ?, ?, ?, TRUE)
       ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), p256dh = VALUES(p256dh),
         auth = VALUES(auth), is_active = TRUE`,
      [userId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth]
    );
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM push_subscriptions WHERE endpoint = ? LIMIT 1`,
      [subscription.endpoint]
    );
    return mapRow(rows[0]);
  }

  /** Deactivates a device's subscription (does not delete — same audit-trail reasoning as email_outbox). */
  async unsubscribe(userId: number, endpoint: string): Promise<void> {
    await this.pool.execute(
      `UPDATE push_subscriptions SET is_active = FALSE WHERE user_id = ? AND endpoint = ?`,
      [userId, endpoint]
    );
  }

  async deactivate(subscriptionId: number): Promise<void> {
    await this.pool.execute(`UPDATE push_subscriptions SET is_active = FALSE WHERE id = ?`, [subscriptionId]);
  }

  async listActiveForUser(userId: number): Promise<PushSubscription[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM push_subscriptions WHERE user_id = ? AND is_active = TRUE ORDER BY created_at DESC`,
      [userId]
    );
    return rows.map(mapRow);
  }
}
