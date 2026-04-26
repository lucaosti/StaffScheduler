/**
 * In-memory EventBus for Server-Sent Events (F18).
 *
 * Per-user subscription set. Other services call `publish(userId, event)`
 * after meaningful state changes; subscribers receive a serialized SSE
 * frame on the open HTTP response. No persistence: SSE is best-effort,
 * the source of truth is always the database.
 *
 * Single-process only — for multi-instance deployments swap this for a
 * Redis pub/sub implementation behind the same surface.
 *
 * @author Luca Ostinelli
 */

import type { Response } from 'express';

export interface BusEvent {
  type: string;
  payload?: unknown;
}

class EventBus {
  private subscribers = new Map<number, Set<Response>>();

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

  publish(userId: number, event: BusEvent): void {
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
export type { EventBus };
