/**
 * Redis connection-manager tests.
 *
 * These pin the "on by default, degrades gracefully" contract the rest of
 * Phase 3 relies on: Redis is enabled unless REDIS_ENABLED=false, in which
 * case the module must never construct a client or open a socket (so a
 * deployment that cannot run Redis, and the test suite, stay clean). When
 * enabled it must lazily create exactly one shared client and report health
 * from a real PING. ioredis is mocked so no network is touched.
 */

const pingMock = jest.fn();
const quitMock = jest.fn();
const onMock = jest.fn();
// The subscriber is a duplicate() of the shared client — a separate connection
// is mandatory because a client in subscriber mode cannot issue other commands.
const subscriberOnMock = jest.fn();
const duplicateMock = jest.fn(() => ({ on: subscriberOnMock, quit: quitMock }));
const RedisCtor = jest.fn().mockImplementation(() => ({
  ping: pingMock,
  quit: quitMock,
  on: onMock,
  duplicate: duplicateMock,
}));

jest.mock('ioredis', () => ({ __esModule: true, default: RedisCtor }));

/** The handlers the module registered on the shared client, by event name (latest wins). */
const clientHandlers = (): Record<string, (arg?: unknown) => void> => {
  const handlers: Record<string, (arg?: unknown) => void> = {};
  for (const [event, fn] of onMock.mock.calls) handlers[event as string] = fn as never;
  return handlers;
};

const loadRedis = (opts: { enabled?: boolean } = {}) => {
  if (opts.enabled === false) process.env.REDIS_ENABLED = 'false';
  else delete process.env.REDIS_ENABLED;
  process.env.REDIS_URL = 'redis://localhost:6379';
  let mod!: typeof import('../config/redis');
  jest.isolateModules(() => {
    mod = require('../config/redis');
  });
  return mod;
};

describe('redis config (disabled)', () => {
  beforeEach(() => {
    RedisCtor.mockClear();
  });

  it('never constructs a client and reports not-configured when REDIS_ENABLED=false', () => {
    const redis = loadRedis({ enabled: false });
    expect(redis.isRedisConfigured()).toBe(false);
    expect(redis.getRedis()).toBeNull();
    expect(RedisCtor).not.toHaveBeenCalled();
  });

  it('reports unhealthy without touching the network', async () => {
    const redis = loadRedis({ enabled: false });
    await expect(redis.isRedisHealthy()).resolves.toBe(false);
    expect(pingMock).not.toHaveBeenCalled();
  });

  it('close is a no-op when never connected', async () => {
    const redis = loadRedis({ enabled: false });
    await expect(redis.closeRedis()).resolves.toBeUndefined();
    expect(quitMock).not.toHaveBeenCalled();
  });
});

describe('redis config (enabled by default)', () => {
  beforeEach(() => {
    RedisCtor.mockClear();
    pingMock.mockReset();
    quitMock.mockReset();
  });

  it('is enabled without any explicit configuration', () => {
    const redis = loadRedis();
    expect(redis.isRedisConfigured()).toBe(true);
  });

  it('lazily creates a single shared client', () => {
    const redis = loadRedis();
    expect(redis.isRedisConfigured()).toBe(true);
    const a = redis.getRedis();
    const b = redis.getRedis();
    expect(a).toBe(b);
    expect(RedisCtor).toHaveBeenCalledTimes(1);
    // lazyConnect keeps the socket closed until first command.
    expect(RedisCtor.mock.calls[0][1]).toMatchObject({ lazyConnect: true });
  });

  it('reports healthy on PONG and unhealthy on a rejected ping', async () => {
    const redis = loadRedis();
    pingMock.mockResolvedValueOnce('PONG');
    await expect(redis.isRedisHealthy()).resolves.toBe(true);
    pingMock.mockRejectedValueOnce(new Error('down'));
    await expect(redis.isRedisHealthy()).resolves.toBe(false);
  });

  it('closes and clears the client', async () => {
    const redis = loadRedis();
    redis.getRedis();
    quitMock.mockResolvedValueOnce('OK');
    await redis.closeRedis();
    expect(quitMock).toHaveBeenCalledTimes(1);
    // A subsequent getRedis creates a fresh client.
    RedisCtor.mockClear();
    redis.getRedis();
    expect(RedisCtor).toHaveBeenCalledTimes(1);
  });

  it('swallows a rejected quit and still clears the client', async () => {
    const redis = loadRedis();
    redis.getRedis();
    quitMock.mockRejectedValueOnce(new Error('already closed'));
    await expect(redis.closeRedis()).resolves.toBeUndefined();
    RedisCtor.mockClear();
    redis.getRedis();
    expect(RedisCtor).toHaveBeenCalledTimes(1);
  });

  it('logs a connection error only once, then resets on a successful reconnect', () => {
    const redis = loadRedis();
    redis.getRedis();
    const handlers = clientHandlers();

    handlers.error(new Error('boom'));
    handlers.error(new Error('boom again'));
    // ready resets the once-flag so a later, genuinely new outage logs again.
    handlers.ready();
    handlers.error(new Error('new outage'));
    // Two distinct outages logged, the mid-storm duplicate suppressed.
    expect(onMock).toHaveBeenCalled();
  });
});

/**
 * #969: returning null from retryStrategy tells ioredis to stop reconnecting
 * for good, so an outage longer than ~11 s left caches, SSE fan-out, the
 * shared limiter and the optimization queue degraded until a restart.
 */
describe('reconnection (#969)', () => {
  it('never gives up: every attempt gets a delay, capped, however long the outage', () => {
    const redis = loadRedis();
    redis.getRedis();
    const options = RedisCtor.mock.calls[RedisCtor.mock.calls.length - 1][1] as {
      retryStrategy: (n: number) => number | null;
    };
    for (const attempt of [1, 2, 5, 10, 11, 50, 1000, 100_000]) {
      const delay = options.retryStrategy(attempt);
      expect(delay).not.toBeNull();
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(redis.RECONNECT_MAX_DELAY_MS);
    }
  });

  it('backs off exponentially and jitters so replicas do not reconnect in lockstep', () => {
    const { reconnectDelay, RECONNECT_MAX_DELAY_MS } = loadRedis();
    const early = Math.max(...Array.from({ length: 50 }, () => reconnectDelay(1)));
    const late = Math.min(...Array.from({ length: 50 }, () => reconnectDelay(30)));
    expect(early).toBeLessThan(late);
    expect(late).toBeGreaterThanOrEqual(RECONNECT_MAX_DELAY_MS / 2);
    const samples = new Set(Array.from({ length: 50 }, () => reconnectDelay(30)));
    expect(samples.size).toBeGreaterThan(1);
  });

  it('exposes the connection state and the reconnect attempts as metrics', async () => {
    delete process.env.REDIS_ENABLED;
    process.env.REDIS_URL = 'redis://localhost:6379';
    // Both from one isolated registry, so the metric read is the one the module writes.
    let redis!: typeof import('../config/redis');
    let registry!: typeof import('../observability/metrics')['registry'];
    jest.isolateModules(() => {
      redis = require('../config/redis');
      registry = require('../observability/metrics').registry;
    });
    redis.getRedis();
    const value = async (name: string) =>
      (await registry.getSingleMetric(name)!.get()).values.reduce((sum, v) => sum + v.value, 0);

    const handlers = clientHandlers();
    handlers.close();
    expect(await value('redis_connected')).toBe(0);
    const before = await value('redis_reconnect_attempts_total');
    handlers.reconnecting();
    handlers.reconnecting();
    expect(await value('redis_reconnect_attempts_total')).toBe(before + 2);
    handlers.ready();
    expect(await value('redis_connected')).toBe(1);
  });
});

describe('getRedisSubscriber', () => {
  beforeEach(() => {
    RedisCtor.mockClear();
    duplicateMock.mockClear();
    subscriberOnMock.mockClear();
  });

  it('returns null when Redis is disabled', () => {
    const redis = loadRedis({ enabled: false });
    expect(redis.getRedisSubscriber()).toBeNull();
    expect(duplicateMock).not.toHaveBeenCalled();
  });

  it('duplicates the shared client once and caches the subscriber', () => {
    const redis = loadRedis();
    const first = redis.getRedisSubscriber();
    const second = redis.getRedisSubscriber();

    expect(first).not.toBeNull();
    expect(second).toBe(first); // cached, not duplicated again
    expect(duplicateMock).toHaveBeenCalledTimes(1);
  });

  it('attaches an error handler that does not throw', () => {
    const redis = loadRedis();
    redis.getRedisSubscriber();

    const errorHandler = subscriberOnMock.mock.calls.find(([evt]) => evt === 'error')?.[1] as
      | ((err: Error) => void)
      | undefined;
    expect(errorHandler).toBeDefined();
    expect(() => errorHandler!(new Error('subscriber down'))).not.toThrow();
  });

  it('logs a subscriber outage once, and again only after it recovered', () => {
    delete process.env.REDIS_ENABLED;
    process.env.REDIS_URL = 'redis://localhost:6379';
    // The logger from the same isolated registry the module logs through.
    let redis!: typeof import('../config/redis');
    let logger!: typeof import('../config/logger')['logger'];
    jest.isolateModules(() => {
      redis = require('../config/redis');
      logger = require('../config/logger').logger;
    });
    redis.getRedisSubscriber();
    const handler = (event: string) =>
      subscriberOnMock.mock.calls.filter(([evt]) => evt === event).pop()![1] as (arg?: unknown) => void;
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => logger);

    handler('error')(new Error('down'));
    handler('error')(new Error('still down'));
    handler('ready')();
    handler('error')(new Error('down again'));

    expect(warn.mock.calls.filter(([msg]) => String(msg).includes('subscriber'))).toHaveLength(2);
    warn.mockRestore();
  });
});
