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
 * this module never opens a socket in tests. A transiently unavailable Redis
 * degrades to reconnection attempts rather than crashing the process, and the
 * connection-error log is emitted once (not per failed command) so a
 * Redis-less dev environment is not flooded.
 *
 * Why reconnection never gives up (#969): the retry strategy used to return
 * null after ten attempts, which tells ioredis to stop for good — so a Redis
 * outage longer than ~11 s left the shared caches, the SSE fan-out, the
 * limiter's shared counters and the optimization queue degraded until the
 * process was restarted, even after Redis was back. Every caller already
 * falls back while Redis is away, so retrying costs nothing but a connection
 * attempt; it continues forever with exponential backoff capped at
 * RECONNECT_MAX_DELAY_MS, and with jitter so N replicas do not all reconnect
 * in the same instant. The same strategy is given to BullMQ's connections.
 *
 * Why ioredis over node-redis: ioredis has first-class cluster/sentinel
 * support and a mature reconnection model, which matter the moment this is
 * used for real multi-instance deployments; the API surface used here is
 * small enough that the choice is easy to revisit.
 */

import Redis from 'ioredis';
import { config } from './index';
import { logger } from './logger';
import { countRedisReconnectAttempt, setRedisConnected } from '../observability/metrics';

let client: Redis | null = null;
let subscriber: Redis | null = null;
let errorLogged = false;

/** Ceiling of the reconnection backoff. */
export const RECONNECT_MAX_DELAY_MS = 10_000;
const RECONNECT_BASE_DELAY_MS = 200;

/**
 * Delay before reconnection attempt `times` (1-based): exponential from
 * RECONNECT_BASE_DELAY_MS, capped at RECONNECT_MAX_DELAY_MS, then jittered
 * into the upper half of that ceiling ("equal jitter": never less than half
 * the backoff, so the cap still bounds how fast a down Redis is probed).
 * Never null — null would end reconnection permanently.
 */
export const reconnectDelay = (times: number): number => {
  const ceiling = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** Math.min(times - 1, 16));
  return Math.max(1, Math.round(ceiling / 2 + Math.random() * (ceiling / 2)));
};

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
    // A command waiting out an outage is failed after two reconnection
    // attempts; callers treat a rejected command as "fall back", so an outage
    // degrades gracefully rather than blocking requests.
    maxRetriesPerRequest: 2,
    // Fail a connection attempt fast so a Redis-less local run falls back to
    // in-process state in ~1s instead of hanging a request on a dead socket.
    connectTimeout: 1000,
    // Forever, with capped and jittered backoff (#969; see the header).
    retryStrategy: reconnectDelay,
  });

  // The connection state, for /metrics (#969). `close` fires on every lost
  // connection, `reconnecting` on every attempt to restore it; `ready` is
  // handled below, with the log reset.
  client.on('close', () => setRedisConnected(false));
  client.on('reconnecting', () => countRedisReconnectAttempt());

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
    if (errorLogged) logger.info('Redis connection restored');
    errorLogged = false;
    setRedisConnected(true);
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
  // Once per outage, like the shared client: reconnection now continues for
  // the whole outage (#969), so logging every failed attempt would flood.
  let subscriberErrorLogged = false;
  subscriber.on('error', (err) => {
    if (subscriberErrorLogged) return;
    logger.warn('Redis subscriber connection error', { message: err.message });
    subscriberErrorLogged = true;
  });
  subscriber.on('ready', () => {
    subscriberErrorLogged = false;
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
