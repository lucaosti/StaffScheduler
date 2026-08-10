/**
 * Native (Capacitor) push transport and device-token management.
 *
 * A genuinely separate transport from Web Push (`PushService.ts`), not a
 * reuse: `PushService`/`PushWorker` deliver browser Web Push (VAPID,
 * `PushSubscription` with `endpoint`/`p256dh`/`auth`) — that mechanism does
 * not exist inside a Capacitor WebView, which has no browser Push API.
 * Native push instead needs a device token from Apple Push Notification
 * service (iOS) / Firebase Cloud Messaging (Android), obtained via
 * Capacitor's `@capacitor/push-notifications` plugin, and delivered
 * server-side through APNs/FCM directly rather than `web-push`.
 *
 * Mirrors `PushService`'s shape deliberately: gated the same way
 * (`isNativePushConfigured()` — a deployment without FCM/APNs credentials
 * sends nothing and creates no outbox intent, same reasoning as
 * `isPushConfigured()`/`isEmailConfigured()`), and every send attempted
 * while unconfigured fails loudly rather than silently doing nothing — the
 * same posture `GustoProvider` takes for its own "no vendor credentials in
 * this environment" case. No real vendor credentials exist in this
 * repository; implementation and tests use fixtures/mocks only.
 *
 * @author Luca Ostinelli
 */

import jwt from 'jsonwebtoken';
import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { config } from '../config';

export type DevicePlatform = 'ios' | 'android';

export interface DevicePushToken {
  id: number;
  userId: number;
  platform: DevicePlatform;
  token: string;
  isActive: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface NativePushPayload {
  title: string;
  body?: string;
  link?: string;
}

const mapRow = (row: RowDataPacket): DevicePushToken => ({
  id: row.id as number,
  userId: row.user_id as number,
  platform: row.platform as DevicePlatform,
  token: row.token as string,
  isActive: Boolean(row.is_active),
  createdAt: row.created_at as string,
  lastUsedAt: (row.last_used_at as string | null) ?? null,
});

/** True when at least one of the two platform transports has credentials set. */
export function isNativePushConfigured(): boolean {
  return isFcmConfigured() || isApnsConfigured();
}

function isFcmConfigured(): boolean {
  return Boolean(config.nativePush.fcmServerKey);
}

function isApnsConfigured(): boolean {
  return Boolean(
    config.nativePush.apnsKeyId &&
      config.nativePush.apnsTeamId &&
      config.nativePush.apnsPrivateKey &&
      config.nativePush.apnsBundleId
  );
}

/**
 * Thrown when the target platform's push service reports the token itself
 * as permanently invalid (uninstalled app, unregistered device, expired
 * token) — the outbox worker's signal to deactivate the token immediately
 * rather than retry, mirroring `PushWorker`'s use of web-push's 404/410.
 */
export class NativePushGoneError extends Error {}

export class NativePushService {
  constructor(private pool: Pool) {}

  /**
   * Registers (or reactivates) a device token. `token` is the natural dedup
   * key — a device re-registering (app reinstall, OS-issued token rotation)
   * updates the row in place rather than accumulating duplicates.
   */
  async registerToken(userId: number, platform: DevicePlatform, token: string): Promise<DevicePushToken> {
    await this.pool.execute<ResultSetHeader>(
      `INSERT INTO device_push_tokens (user_id, platform, token, is_active)
       VALUES (?, ?, ?, TRUE)
       ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), platform = VALUES(platform), is_active = TRUE`,
      [userId, platform, token]
    );
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM device_push_tokens WHERE token = ? LIMIT 1`,
      [token]
    );
    return mapRow(rows[0]);
  }

  /** Deactivates a device's token (does not delete — same audit-trail reasoning as email_outbox). */
  async deactivateToken(userId: number, token: string): Promise<void> {
    await this.pool.execute(
      `UPDATE device_push_tokens SET is_active = FALSE WHERE user_id = ? AND token = ?`,
      [userId, token]
    );
  }

  async deactivate(tokenId: number): Promise<void> {
    await this.pool.execute(`UPDATE device_push_tokens SET is_active = FALSE WHERE id = ?`, [tokenId]);
  }

  async listActiveForUser(userId: number): Promise<DevicePushToken[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM device_push_tokens WHERE user_id = ? AND is_active = TRUE ORDER BY created_at DESC`,
      [userId]
    );
    return rows.map(mapRow);
  }
}

// ── Delivery ─────────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 15_000;

let cachedApnsJwt: { token: string; mintedAt: number } | null = null;
const APNS_JWT_TTL_MS = 55 * 60 * 1000; // APNs allows up to 60 minutes; refresh a little early.

/**
 * Mints (and caches) the ES256 JWT APNs requires as the provider token on
 * every request. `jsonwebtoken` is already a dependency for this project's
 * own session tokens; APNs' provider-token scheme is a plain ES256 JWT, so
 * no separate library is needed.
 */
function apnsProviderJwt(): string {
  if (cachedApnsJwt && Date.now() - cachedApnsJwt.mintedAt < APNS_JWT_TTL_MS) {
    return cachedApnsJwt.token;
  }
  // Env vars cannot carry literal newlines portably across every deployment
  // target (Docker Compose env files, some CI secret stores), so the PEM is
  // accepted with escaped `\n` sequences and unescaped here.
  const privateKey = (config.nativePush.apnsPrivateKey as string).replace(/\\n/g, '\n');
  const token = jwt.sign({ iss: config.nativePush.apnsTeamId, iat: Math.floor(Date.now() / 1000) }, privateKey, {
    algorithm: 'ES256',
    header: { alg: 'ES256', kid: config.nativePush.apnsKeyId as string },
  });
  cachedApnsJwt = { token, mintedAt: Date.now() };
  return token;
}

/** Test-only: clears the memoised APNs provider JWT so a test can reconfigure it. */
export function resetApnsJwtCache(): void {
  cachedApnsJwt = null;
}

async function sendFcm(token: string, payload: NativePushPayload): Promise<void> {
  if (!isFcmConfigured()) {
    throw new Error('sendNativePush called for an android token while FCM is not configured');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `key=${config.nativePush.fcmServerKey}`,
      },
      body: JSON.stringify({
        to: token,
        notification: { title: payload.title, body: payload.body },
        data: payload.link ? { link: payload.link } : undefined,
      }),
      signal: controller.signal,
    });
    const result = (await response.json().catch(() => ({}))) as {
      failure?: number;
      results?: Array<{ error?: string }>;
    };
    // FCM's legacy HTTP API answers 200 even for a per-token failure — the
    // per-result `error` field is where an unregistered/invalid token shows
    // up, not the HTTP status.
    const resultError = result.results?.[0]?.error;
    if (resultError === 'NotRegistered' || resultError === 'InvalidRegistration') {
      throw new NativePushGoneError(`FCM reports token gone: ${resultError}`);
    }
    if (!response.ok || (result.failure ?? 0) > 0) {
      throw new Error(`FCM send failed${resultError ? `: ${resultError}` : ` (HTTP ${response.status})`}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function sendApns(token: string, payload: NativePushPayload): Promise<void> {
  if (!isApnsConfigured()) {
    throw new Error('sendNativePush called for an ios token while APNs is not configured');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    // APNs' HTTP/2 API is exposed here over ordinary fetch/JSON rather than a
    // hand-rolled HTTP/2 client — structurally faithful to APNs' documented
    // request shape (bearer provider JWT, `apns-topic` header, JSON aps
    // payload), but this repository has no live Apple developer account to
    // integration-test the transport against continuously; verify the
    // current endpoint/transport requirements against Apple's own reference
    // before relying on this in production, the same caveat `GustoProvider`
    // carries for its own vendor integration.
    const response = await fetch(`https://api.push.apple.com/3/device/${token}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `bearer ${apnsProviderJwt()}`,
        'apns-topic': config.nativePush.apnsBundleId as string,
      },
      body: JSON.stringify({
        aps: { alert: { title: payload.title, body: payload.body } },
        link: payload.link,
      }),
      signal: controller.signal,
    });
    if (response.status === 410 || response.status === 400) {
      const body = (await response.json().catch(() => ({}))) as { reason?: string };
      if (body.reason === 'Unregistered' || body.reason === 'BadDeviceToken') {
        throw new NativePushGoneError(`APNs reports token gone: ${body.reason}`);
      }
      throw new Error(`APNs send failed: ${body.reason ?? response.status}`);
    }
    if (!response.ok) {
      throw new Error(`APNs responded ${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Delivers one push message to one device token. Refuses to run when native
 * push is not configured at all, or when the specific platform the token
 * belongs to has no credentials — same contract `sendPush` carries (callers
 * must gate on `isNativePushConfigured()` first).
 */
export async function sendNativePush(
  device: { platform: DevicePlatform; token: string },
  payload: NativePushPayload
): Promise<void> {
  if (!isNativePushConfigured()) {
    throw new Error('sendNativePush called while native push is not configured');
  }
  if (device.platform === 'android') {
    await sendFcm(device.token, payload);
  } else {
    await sendApns(device.token, payload);
  }
}
