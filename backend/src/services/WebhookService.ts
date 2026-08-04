/**
 * Outbound webhooks (#315) — subscription management and dispatch.
 *
 * WHY THE SECRET IS STORED IN PLAINTEXT, UNLIKE THE KIOSK/REFRESH TOKEN
 * PATTERN. Those are bearer credentials — anyone who has the raw value can
 * authenticate as that principal, so only a hash is kept and the raw value
 * exists once, at issuance. An HMAC signing secret is different: WebhookWorker
 * must reproduce the SAME signature the subscriber will verify, which is only
 * possible if it holds the raw secret at delivery time, not a one-way hash of
 * it. This is the standard shape for webhook secrets (Stripe, GitHub, etc.) —
 * a shared symmetric secret, not a bearer credential.
 *
 * @author Luca Ostinelli
 */

import crypto, { randomBytes } from 'crypto';
import { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

export interface WebhookSubscription {
  id: number;
  organizationName: string;
  url: string;
  eventTypes: string[];
  isActive: boolean;
  createdAt: string;
}

/** Every event type a subscriber can subscribe to — dispatch call sites are typed against this. */
export type WebhookEventType =
  | 'schedule.published'
  | 'assignment.confirmed'
  | 'approval.decided';

const mapRow = (row: RowDataPacket): WebhookSubscription => ({
  id: row.id as number,
  organizationName: row.organization_name as string,
  url: row.url as string,
  eventTypes: (row.event_types as string).split(',').filter(Boolean),
  isActive: Boolean(row.is_active),
  createdAt: row.created_at as string,
});

export class WebhookService {
  constructor(private pool: Pool) {}

  async listForOrganization(organizationName: string): Promise<WebhookSubscription[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM webhook_subscriptions WHERE organization_name = ? ORDER BY created_at DESC`,
      [organizationName]
    );
    return rows.map(mapRow);
  }

  /** Returns the subscription AND the raw secret — the only time the secret is ever returned. */
  async create(
    organizationName: string,
    input: { url: string; eventTypes: WebhookEventType[] },
    createdBy: number | null
  ): Promise<{ subscription: WebhookSubscription; secret: string }> {
    const secret = randomBytes(32).toString('hex');
    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO webhook_subscriptions (organization_name, url, secret, event_types, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [organizationName, input.url, secret, input.eventTypes.join(','), createdBy]
    );
    const subscription = await this.getById(result.insertId);
    if (!subscription) throw new Error('Failed to retrieve created webhook subscription');
    return { subscription, secret };
  }

  async getById(id: number): Promise<WebhookSubscription | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM webhook_subscriptions WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows.length === 0 ? null : mapRow(rows[0]);
  }

  async update(
    id: number,
    input: { url?: string; eventTypes?: WebhookEventType[]; isActive?: boolean }
  ): Promise<WebhookSubscription | null> {
    const sets: string[] = [];
    const params: (string | number)[] = [];
    if (input.url !== undefined) {
      sets.push('url = ?');
      params.push(input.url);
    }
    if (input.eventTypes !== undefined) {
      sets.push('event_types = ?');
      params.push(input.eventTypes.join(','));
    }
    if (input.isActive !== undefined) {
      sets.push('is_active = ?');
      params.push(input.isActive ? 1 : 0);
    }
    if (sets.length === 0) return this.getById(id);
    params.push(id);
    await this.pool.execute(`UPDATE webhook_subscriptions SET ${sets.join(', ')} WHERE id = ?`, params);
    return this.getById(id);
  }

  async delete(id: number): Promise<void> {
    await this.pool.execute(`DELETE FROM webhook_subscriptions WHERE id = ?`, [id]);
  }

  async listDeliveries(subscriptionId: number, limit = 50): Promise<RowDataPacket[]> {
    const cappedLimit = Math.max(1, Math.min(200, limit));
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      // Inlined, not bound: a placeholder in LIMIT is rejected by the
      // prepared-statement protocol (same reasoning as AuditLogService.list).
      `SELECT id, event_type, status, attempts, response_status, last_error, created_at, processed_at
         FROM webhook_deliveries
        WHERE subscription_id = ?
        ORDER BY created_at DESC
        LIMIT ${cappedLimit}`,
      [subscriptionId]
    );
    return rows;
  }

  /**
   * Enqueues one delivery per ACTIVE subscription the organization has for
   * this event type. Takes an optional connection so a call site with its
   * own transaction (e.g. inside the same commit as the state change the
   * event announces) can enqueue atomically with it, the same seam
   * `NotificationService.notifyWithin` offers for email/push.
   */
  async dispatch(
    organizationName: string,
    eventType: WebhookEventType,
    payload: Record<string, unknown>,
    conn?: Pool | PoolConnection
  ): Promise<void> {
    const executor = conn ?? this.pool;
    const [rows] = await executor.execute<RowDataPacket[]>(
      `SELECT id, event_types FROM webhook_subscriptions WHERE organization_name = ? AND is_active = TRUE`,
      [organizationName]
    );
    const matching = rows.filter((row) => (row.event_types as string).split(',').includes(eventType));
    if (matching.length === 0) return;

    const serialized = JSON.stringify(payload);
    for (const row of matching) {
      await executor.execute(
        `INSERT INTO webhook_deliveries (subscription_id, event_type, payload) VALUES (?, ?, ?)`,
        [row.id, eventType, serialized]
      );
    }
  }
}

/** `X-Webhook-Signature: sha256=<hex>`, over the raw JSON body — verifiable by the subscriber with the shared secret. */
export function signPayload(secret: string, rawBody: string): string {
  return `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}
