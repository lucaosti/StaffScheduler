/**
 * Shared ephemeral cache — Redis-backed with a transparent in-process fallback.
 *
 * Why this module exists: three pieces of hot, short-lived state used to live
 * in process-local Maps (the JWT-revocation blacklist, the per-user
 * auth-context cache, the module-enablement cache). That silently pinned the
 * backend to a single instance — revocations were lost on restart and never
 * seen by a sibling process. Centralising them here, behind one small async
 * API backed by Redis, makes them a single source of truth shared by every
 * instance while keeping the call sites trivial.
 *
 * Why a fallback instead of a hard Redis dependency: Redis is on by default
 * (see config/redis.ts) but must not be *required* — a bare `npm run dev` or
 * a deployment that opts out with REDIS_ENABLED=false has to keep working.
 * Every method therefore tries Redis and, on absence or error, uses an
 * in-process store with the same bounded-size + TTL semantics the original
 * Maps had. Correctness is identical for a single instance either way; only
 * the cross-instance guarantee (which a single instance never needed) depends
 * on Redis. A Redis command that throws is caught and treated as "fall back
 * for this call" rather than surfaced, so a Redis blip degrades to
 * single-instance behaviour instead of failing requests.
 *
 * Why a shared Redis store needs no pub/sub for invalidation: because the
 * cache lives entirely in Redis (not a local copy per instance), a DEL is
 * instantly visible to every instance — there is no stale local replica to
 * broadcast an invalidation for. The in-process fallback is per-instance by
 * definition, which is acceptable precisely because it only runs when Redis
 * (and thus multi-instance operation) is not in play.
 */

import { getRedis, isRedisConfigured } from '../config/redis';

/**
 * Bounded in-process TTL map used when Redis is unavailable. Exported so its
 * eviction/prune behaviour can be unit-tested with a small capacity (the real
 * stores use 100k/10k bounds that are impractical to fill through the public
 * cache API).
 */
export class MemoryTtlStore<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

  constructor(private readonly maxEntries: number) {}

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V, ttlMs: number): void {
    // FIFO eviction at capacity — same bound the original Maps enforced so a
    // fallback under sustained load stays memory-safe.
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  /** Drops expired entries; called on a timer so the fallback never grows unbounded while idle. */
  prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (now > entry.expiresAt) this.entries.delete(key);
    }
  }
}

const BLACKLIST_MAX = 100_000;
const AUTHCTX_MAX = 10_000;
const BLACKLIST_PREFIX = 'jti:blacklist:';
const AUTHCTX_PREFIX = 'auth:ctx:';

const memBlacklist = new MemoryTtlStore<true>(BLACKLIST_MAX);
const memAuthCtx = new MemoryTtlStore<string>(AUTHCTX_MAX);

// Prune the fallback stores hourly. unref() so the timer never blocks process
// exit; harmless no-op work when Redis is handling everything.
const pruneTimer = setInterval(() => {
  memBlacklist.prune();
  memAuthCtx.prune();
}, 60 * 60 * 1000);
pruneTimer.unref();

/** Redis client only when configured; null selects the in-process fallback. */
const redis = () => (isRedisConfigured() ? getRedis() : null);

/**
 * Revokes a token by its JTI until `ttlMs` from now (its natural expiry), so a
 * logged-out or compromised token is rejected until it would have expired
 * anyway. Redis stores it with native EX so it self-cleans.
 */
export const blacklistJti = async (jti: string, ttlMs: number): Promise<void> => {
  const ttlSec = Math.max(1, Math.ceil(ttlMs / 1000));
  const client = redis();
  if (client) {
    try {
      await client.set(`${BLACKLIST_PREFIX}${jti}`, '1', 'EX', ttlSec);
      return;
    } catch {
      /* fall through to memory */
    }
  }
  memBlacklist.set(jti, true, ttlMs);
};

/** True when the JTI has been revoked and not yet expired. */
export const isJtiBlacklisted = async (jti: string): Promise<boolean> => {
  const client = redis();
  if (client) {
    try {
      return (await client.exists(`${BLACKLIST_PREFIX}${jti}`)) === 1;
    } catch {
      /* fall through to memory */
    }
  }
  return memBlacklist.get(jti) === true;
};

/** Returns the cached auth-context JSON for a user, or null on miss/expiry. */
export const getAuthContext = async (userId: number): Promise<string | null> => {
  const client = redis();
  if (client) {
    try {
      return await client.get(`${AUTHCTX_PREFIX}${userId}`);
    } catch {
      /* fall through to memory */
    }
  }
  return memAuthCtx.get(String(userId)) ?? null;
};

/** Caches a user's resolved auth context for `ttlMs`. */
export const setAuthContext = async (userId: number, json: string, ttlMs: number): Promise<void> => {
  const ttlSec = Math.max(1, Math.ceil(ttlMs / 1000));
  const client = redis();
  if (client) {
    try {
      await client.set(`${AUTHCTX_PREFIX}${userId}`, json, 'EX', ttlSec);
      return;
    } catch {
      /* fall through to memory */
    }
  }
  memAuthCtx.set(String(userId), json, ttlMs);
};

/**
 * Drops a user's cached auth context after a grant/role/delegation change so
 * the next request re-resolves fresh permissions. With Redis this is instantly
 * visible to every instance; the memory fallback clears only this instance
 * (all there is when Redis is absent).
 */
export const invalidateAuthContext = async (userId: number): Promise<void> => {
  const client = redis();
  if (client) {
    try {
      await client.del(`${AUTHCTX_PREFIX}${userId}`);
    } catch {
      /* fall through to also clear memory */
    }
  }
  memAuthCtx.delete(String(userId));
};
