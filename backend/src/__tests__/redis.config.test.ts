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

  it('caps reconnection backoff and gives up after 10 attempts', () => {
    const redis = loadRedis();
    redis.getRedis();
    const options = RedisCtor.mock.calls[0][1] as { retryStrategy: (n: number) => number | null };
    expect(options.retryStrategy(1)).toBe(200);
    expect(options.retryStrategy(10)).toBe(2000); // capped at the ceiling
    expect(options.retryStrategy(11)).toBeNull(); // give up past 10 attempts
  });

  it('logs a connection error only once, then resets on a successful reconnect', () => {
    const redis = loadRedis();
    redis.getRedis();
    const handlers: Record<string, (arg?: unknown) => void> = {};
    for (const [event, fn] of onMock.mock.calls) handlers[event as string] = fn as never;

    handlers.error(new Error('boom'));
    handlers.error(new Error('boom again'));
    // ready resets the once-flag so a later, genuinely new outage logs again.
    handlers.ready();
    handlers.error(new Error('new outage'));
    // Two distinct outages logged, the mid-storm duplicate suppressed.
    expect(onMock).toHaveBeenCalled();
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
});
