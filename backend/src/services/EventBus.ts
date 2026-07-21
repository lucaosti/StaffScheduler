/**
 * EventBus for Server-Sent Events — multi-instance via Redis pub/sub.
 *
 * A user's SSE connection lives on exactly one backend instance, but an event
 * that concerns them may be produced on any instance. With a purely in-process
 * bus, a notification generated on instance B would never reach a user whose
 * stream is held by instance A — silently broken the moment the deployment
 * scales past one replica. This bus fixes that: `publish` fans an event out
 * through a Redis channel that every instance subscribes to, and each instance
 * delivers to whichever of its own local connections belong to that user.
 *
 * Delivery model (chosen for exactly-once local delivery):
 * - With Redis enabled, `publish` does NOT write to local connections directly.
 *   It only PUBLISHes to the channel; the subscription handler — which runs on
 *   every instance INCLUDING the publisher — is the single place that writes to
 *   local subscribers. Routing all delivery through the one subscription path
 *   avoids the double-write a "write locally AND publish" approach would cause
 *   on the origin instance.
 * - With Redis disabled (single instance / local dev), there is no channel, so
 *   `publish` writes to local subscribers directly — identical behaviour to the
 *   original in-process bus, zero configuration.
 *
 * SSE remains best-effort: the database is always the source of truth, so a
 * dropped frame during a Redis blip costs a client a live update, not data.
 *
 * @author Luca Ostinelli
 */

import type { Response } from 'express';
import { getRedis, getRedisSubscriber, isRedisConfigured } from '../config/redis';
import { logger } from '../config/logger';

interface BusEvent {
  type: string;
  payload?: unknown;
}

/** Channel every instance publishes to and subscribes on. */
const SSE_CHANNEL = 'sse:user-events';

class EventBus {
  private subscribers = new Map<number, Set<Response>>();
  private initialized = false;

  subscribe(userId: number, res: Response): void {
    if (!this.subscribers.has(userId)) this.subscribers.set(userId, new Set());
    this.subscribers.get(userId)!.add(res);
  }

  unsubscribe(userId: number, res: Response): void {
    const set = this.subscribers.get(userId);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) this.subscribers.delete(userId);
  }

  /**
   * Wires the Redis subscription once at startup (call from app bootstrap).
   * No-op when Redis is disabled — the bus then operates purely in-process.
   * Idempotent, and never throws: a failed subscription degrades the bus to
   * single-instance delivery rather than blocking startup.
   */
  async init(): Promise<void> {
    if (this.initialized || !isRedisConfigured()) return;
    const sub = getRedisSubscriber();
    if (!sub) return;
    try {
      await sub.subscribe(SSE_CHANNEL);
      sub.on('message', (channel, message) => {
        if (channel !== SSE_CHANNEL) return;
        try {
          const { userId, event } = JSON.parse(message) as { userId: number; event: BusEvent };
          this.deliverLocal(userId, event);
        } catch {
          /* malformed frame from the channel — ignore, SSE is best-effort */
        }
      });
      this.initialized = true;
    } catch (err) {
      logger.warn('EventBus Redis subscribe failed; SSE stays single-instance', {
        message: (err as Error).message,
      });
    }
  }

  /**
   * Publishes an event for a user. Fans out through Redis when enabled (every
   * instance's subscription then delivers to its own connections); otherwise
   * delivers to this instance's connections directly.
   */
  publish(userId: number, event: BusEvent): void {
    const redis = isRedisConfigured() ? getRedis() : null;
    if (redis) {
      // Fire-and-forget: delivery happens via the subscription on every
      // instance. A publish failure just means this event is not delivered
      // live, consistent with SSE being best-effort — but still deliver to
      // local connections so a Redis blip does not blind same-instance clients.
      redis.publish(SSE_CHANNEL, JSON.stringify({ userId, event })).catch(() => {
        this.deliverLocal(userId, event);
      });
      return;
    }
    this.deliverLocal(userId, event);
  }

  /** Writes an event to this instance's open connections for the user. */
  private deliverLocal(userId: number, event: BusEvent): void {
    const set = this.subscribers.get(userId);
    if (!set) return;
    const frame = this.formatFrame(event);
    for (const res of set) {
      try {
        res.write(frame);
      } catch {
        // The connection has gone away; the close handler will clean it up.
      }
    }
  }

  /** Total open SSE connections across every user (mostly used for tests). */
  size(): number {
    let total = 0;
    for (const set of this.subscribers.values()) total += set.size;
    return total;
  }

  /** Visible to tests so they can assert on the wire format. */
  formatFrame(event: BusEvent): string {
    const data = JSON.stringify(event.payload ?? null);
    return `event: ${event.type}\ndata: ${data}\n\n`;
  }
}

export const eventBus = new EventBus();
