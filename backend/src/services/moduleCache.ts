/**
 * Process-wide module-flag cache with cross-instance invalidation.
 *
 * WHY THIS EXISTS: `requireModule` runs on many requests, so ModuleService keeps
 * the whole `modules` table cached rather than querying per request. That cache
 * used to be a field on each ModuleService instance — which is wrong twice over:
 * several instances exist in one process (one per router factory), so a toggle
 * cleared only the instance that handled it; and with several backend replicas,
 * instance B kept serving the old flag after instance A toggled it. A disabled
 * module is a 404 contract, so stale flags are a correctness bug, not a nicety.
 *
 * WHY THIS DESIGN (pub/sub invalidation AND a TTL): the cache is a rarely-changed
 * whole-table snapshot, so the two candidate fixes were a short TTL (self-healing
 * but always up to TTL stale) or a Redis pub/sub invalidation signal (immediate
 * but silently wrong if a message is dropped or Redis is down). We use both: a
 * toggle publishes an invalidation that clears every replica immediately, and a
 * 30s TTL bounds the damage if that message is ever missed. Without Redis the
 * deployment is single-instance, where the local clear alone is already correct
 * and the TTL is simply belt-and-braces.
 *
 * The cache lives at module scope so every ModuleService in the process shares
 * one entry and a single invalidation clears them all.
 *
 * @author Luca Ostinelli
 */

import { getRedis, getRedisSubscriber } from '../config/redis';
import { logger } from '../config/logger';

/** Pub/sub channel carrying invalidations. Payload: '*' (global) or an org name. */
const CHANNEL = 'cache:modules';

/**
 * Backstop lifetime for a cached snapshot. Short enough that a missed
 * invalidation self-heals quickly, long enough that the hot path stays cheap.
 */
export const MODULE_CACHE_TTL_MS = 30_000;

interface Entry {
  map: Map<string, boolean>;
  at: number;
}

let globalEntry: Entry | null = null;
const orgEntries = new Map<string, Entry>();
let subscribed = false;

const isFresh = (entry: Entry): boolean => Date.now() - entry.at < MODULE_CACHE_TTL_MS;

/** The cached global flags, or null when absent or past the TTL. */
export function readGlobalModules(): Map<string, boolean> | null {
  if (!globalEntry || !isFresh(globalEntry)) return null;
  return globalEntry.map;
}

export function writeGlobalModules(map: Map<string, boolean>): void {
  globalEntry = { map, at: Date.now() };
}

/** The cached overrides for one org, or null when absent or past the TTL. */
export function readOrgModules(org: string): Map<string, boolean> | null {
  const entry = orgEntries.get(org);
  if (!entry || !isFresh(entry)) return null;
  return entry.map;
}

export function writeOrgModules(org: string, map: Map<string, boolean>): void {
  orgEntries.set(org, { map, at: Date.now() });
}

/**
 * Drop cached state in THIS process. Pass an org to drop only that org's
 * overrides; omit it to drop everything (a global flag change can affect every
 * org's effective value).
 */
export function clearModuleCaches(org?: string): void {
  if (org === undefined) {
    globalEntry = null;
    orgEntries.clear();
    return;
  }
  orgEntries.delete(org);
}

/**
 * Clear locally and tell every other replica to do the same. Called by
 * ModuleService after any write that changes an effective flag. Publishing is
 * best-effort: a Redis failure must not fail the toggle, and the TTL covers it.
 */
export async function invalidateModuleCache(org?: string): Promise<void> {
  clearModuleCaches(org);
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.publish(CHANNEL, org ?? '*');
  } catch (err) {
    logger.warn('Module cache invalidation publish failed; relying on TTL', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Subscribe to invalidations from other replicas. Call once at startup; a no-op
 * without Redis (single instance) or if already subscribed. Shares the process
 * subscriber with the EventBus, so the handler filters by channel.
 */
export async function initModuleCacheInvalidation(): Promise<void> {
  if (subscribed) return;
  const sub = getRedisSubscriber();
  if (!sub) return;
  try {
    await sub.subscribe(CHANNEL);
    sub.on('message', (channel: string, message: string) => {
      if (channel !== CHANNEL) return;
      clearModuleCaches(message === '*' ? undefined : message);
    });
    subscribed = true;
    logger.info('Module cache invalidation subscribed');
  } catch (err) {
    logger.warn('Module cache invalidation subscribe failed; relying on TTL', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Test hook: forget cached state and the subscription flag. */
export function resetModuleCacheForTests(): void {
  globalEntry = null;
  orgEntries.clear();
  subscribed = false;
}
