/**
 * Redis connection manager — shared-state backend, on by default.
 *
 * Why Redis is used automatically (not opt-in): the shared caches (JTI
 * blacklist, auth-context, module state) are correct and consistent across
 * multiple backend instances only when they live outside the process, so
 * Redis is enabled by default and the app uses it whenever it is reachable.
 * That makes horizontal scaling and restart-surviving token revocation the
 * default behaviour rather than something an operator must remember to turn
 * on. It is not a *hard* dependency, though: the caches fall back to
 * process-local state transparently when Redis is unreachable, so a bare
 * `npm run dev` without a Redis running still works — it simply loses the
 * cross-instance guarantees it would not have had anyway. `REDIS_ENABLED=false`
 * suppresses connection attempts entirely for deployments that cannot run
 * Redis.
 *
 * Why a lazy singleton: the client connects only on first use, so importing
 * this module never opens a socket in tests. `lazyConnect` plus a bounded
 * retry strategy means a transiently unavailable Redis degrades to
 * reconnection attempts rather than crashing the process, and the
 * connection-error log is emitted once (not per failed command) so a
 * Redis-less dev environment is not flooded.
 *
 * Why ioredis over node-redis: ioredis has first-class cluster/sentinel
 * support and a mature reconnection model, which matter the moment this is
 * used for real multi-instance deployments; the API surface used here is
 * small enough that the choice is easy to revisit.
 */

import Redis from 'ioredis';
import { config } from './index';
import { logger } from './logger';

let client: Redis | null = null;
let subscriber: Redis | null = null;
let errorLogged = false;

/** True when Redis is enabled; callers use this to pick Redis vs. in-process state. */
export const isRedisConfigured = (): boolean => config.redis.enabled && Boolean(config.redis.url);

/**
 * Returns the shared client, creating it on first call. Returns null when
 * Redis is not configured, so callers fall back to process-local behaviour
 * without a special case at every site.
 */
export const getRedis = (): Redis | null => {
  if (!isRedisConfigured()) return null;
  if (client) return client;

  client = new Redis(config.redis.url as string, {
    // Do not open the socket until the first command: keeps module import
    // side-effect-free and lets the process start even if Redis is briefly
    // unreachable.
    lazyConnect: true,
    // Bounded backoff: retry a few times with growing delay, then stop
    // hammering. Individual callers treat a rejected command as "fall back",
    // so an outage degrades gracefully rather than blocking requests.
    maxRetriesPerRequest: 2,
    // Fail a connection attempt fast so a Redis-less local run falls back to
    // in-process state in ~1s instead of hanging a request on a dead socket.
    connectTimeout: 1000,
    retryStrategy: (times) => (times > 10 ? null : Math.min(times * 200, 2000)),
  });

  client.on('error', (err) => {
    // Log once, at warn: a Redis blip (or a Redis-less local run) is expected
    // operational noise the caches recover from, not an application fault, and
    // logging every failed reconnect would flood the output. Reset on a
    // successful reconnect so a later, genuinely new outage is still surfaced.
    if (!errorLogged) {
      logger.warn('Redis connection error (caches fall back to in-process state)', {
        message: err.message,
      });
      errorLogged = true;
    }
  });
  client.on('ready', () => {
    errorLogged = false;
  });

  return client;
};

/**
 * Returns a DEDICATED client for pub/sub subscription, or null when Redis is
 * off. A separate connection is mandatory: once an ioredis client enters
 * subscriber mode it can no longer issue ordinary commands, so the shared
 * `getRedis()` client (used for cache GET/SET/PUBLISH) must not be the one that
 * SUBSCRIBEs. `duplicate()` clones the shared client's configuration, keeping
 * the retry/timeout behaviour consistent. Created lazily and cached.
 */
export const getRedisSubscriber = (): Redis | null => {
  if (!isRedisConfigured()) return null;
  if (subscriber) return subscriber;
  const base = getRedis();
  if (!base) return null;
  subscriber = base.duplicate();
  subscriber.on('error', (err) => {
    logger.warn('Redis subscriber connection error', { message: err.message });
  });
  return subscriber;
};

/** Liveness check for the health endpoint. False when unconfigured or unreachable. */
export const isRedisHealthy = async (): Promise<boolean> => {
  const redis = getRedis();
  if (!redis) return false;
  try {
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
};

/** Closes both clients on graceful shutdown; no-op when never connected. */
export const closeRedis = async (): Promise<void> => {
  const closers = [subscriber, client].map(async (c) => {
    if (!c) return;
    try {
      await c.quit();
    } catch {
      /* already closed */
    }
  });
  await Promise.all(closers);
  subscriber = null;
  client = null;
};
