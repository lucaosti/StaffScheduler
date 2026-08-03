/**
 * moduleCache tests — the process-wide flag cache, its TTL backstop and the
 * cross-replica pub/sub invalidation.
 */

export {};

import { EventEmitter } from 'events';

const publish = jest.fn().mockResolvedValue(1);
const subscribe = jest.fn().mockResolvedValue(undefined);
let redisAvailable = true;

/**
 * A real EventEmitter, not a jest.fn() `on`: the property under test in the
 * "does not accumulate listeners" case below is exactly what `.on`/`.off`
 * actually do to a shared listener list, which a mock that only records calls
 * cannot observe (see outboxWorker.test.ts's own "real timers" describe block
 * for the same reasoning, applied there to a real setInterval handle).
 */
class FakeSubscriber extends EventEmitter {
  subscribe = subscribe;
}
const subscriberFake = new FakeSubscriber();

jest.mock('../config/redis', () => ({
  getRedis: () => (redisAvailable ? { publish } : null),
  getRedisSubscriber: () => (redisAvailable ? subscriberFake : null),
}));

import {
  readGlobalModules,
  writeGlobalModules,
  readOrgModules,
  writeOrgModules,
  clearModuleCaches,
  invalidateModuleCache,
  initModuleCacheInvalidation,
  resetModuleCacheForTests,
  MODULE_CACHE_TTL_MS,
} from '../services/moduleCache';

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
  redisAvailable = true;
  resetModuleCacheForTests();
  // resetModuleCacheForTests() removes the ONE listener it knows about (the
  // regression this file pins), but a test that reaches into the emitter
  // directly (or a prior failed assertion) should not leak a listener into
  // the next test either — this is between-test hygiene, not part of what's
  // under test.
  subscriberFake.removeAllListeners();
});

describe('read/write', () => {
  it('returns what was written, per scope', () => {
    writeGlobalModules(new Map([['a', true]]));
    writeOrgModules('acme', new Map([['a', false]]));
    expect(readGlobalModules()?.get('a')).toBe(true);
    expect(readOrgModules('acme')?.get('a')).toBe(false);
    expect(readOrgModules('other')).toBeNull();
  });

  it('returns null before anything is cached', () => {
    expect(readGlobalModules()).toBeNull();
  });
});

describe('TTL backstop', () => {
  it('treats an entry older than the TTL as absent', () => {
    jest.useFakeTimers();
    writeGlobalModules(new Map([['a', true]]));
    writeOrgModules('acme', new Map([['a', true]]));
    expect(readGlobalModules()).not.toBeNull();

    jest.advanceTimersByTime(MODULE_CACHE_TTL_MS + 1);
    expect(readGlobalModules()).toBeNull();
    expect(readOrgModules('acme')).toBeNull();
  });
});

describe('clearModuleCaches', () => {
  it('clears only the named org when given one', () => {
    writeGlobalModules(new Map([['a', true]]));
    writeOrgModules('acme', new Map());
    writeOrgModules('other', new Map());

    clearModuleCaches('acme');

    expect(readOrgModules('acme')).toBeNull();
    expect(readOrgModules('other')).not.toBeNull();
    expect(readGlobalModules()).not.toBeNull();
  });

  it('clears every scope when given none', () => {
    writeGlobalModules(new Map([['a', true]]));
    writeOrgModules('acme', new Map());

    clearModuleCaches();

    expect(readGlobalModules()).toBeNull();
    expect(readOrgModules('acme')).toBeNull();
  });
});

describe('invalidateModuleCache', () => {
  it('clears locally and publishes the scope to other replicas', async () => {
    writeGlobalModules(new Map([['a', true]]));
    await invalidateModuleCache();
    expect(readGlobalModules()).toBeNull();
    expect(publish).toHaveBeenCalledWith('cache:modules', '*');

    writeOrgModules('acme', new Map());
    await invalidateModuleCache('acme');
    expect(readOrgModules('acme')).toBeNull();
    expect(publish).toHaveBeenLastCalledWith('cache:modules', 'acme');
  });

  it('still clears locally when Redis is unavailable', async () => {
    redisAvailable = false;
    writeGlobalModules(new Map([['a', true]]));
    await invalidateModuleCache();
    expect(readGlobalModules()).toBeNull();
    expect(publish).not.toHaveBeenCalled();
  });

  it('does not throw when publishing fails (TTL covers it)', async () => {
    publish.mockRejectedValueOnce(new Error('redis down'));
    writeGlobalModules(new Map([['a', true]]));
    await expect(invalidateModuleCache()).resolves.toBeUndefined();
    expect(readGlobalModules()).toBeNull();
  });
});

describe('initModuleCacheInvalidation', () => {
  it('subscribes once and clears on an incoming message', async () => {
    await initModuleCacheInvalidation();
    await initModuleCacheInvalidation(); // idempotent
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledWith('cache:modules');

    writeOrgModules('acme', new Map());
    subscriberFake.emit('message', 'cache:modules', 'acme');
    expect(readOrgModules('acme')).toBeNull();

    writeGlobalModules(new Map([['a', true]]));
    subscriberFake.emit('message', 'cache:modules', '*');
    expect(readGlobalModules()).toBeNull();

    // A frame from another channel is ignored.
    writeGlobalModules(new Map([['a', true]]));
    subscriberFake.emit('message', 'sse:user-events', '*');
    expect(readGlobalModules()).not.toBeNull();
  });

  it('is a no-op without Redis', async () => {
    redisAvailable = false;
    await initModuleCacheInvalidation();
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('does not throw when subscribing fails', async () => {
    subscribe.mockRejectedValueOnce(new Error('no redis'));
    await expect(initModuleCacheInvalidation()).resolves.toBeUndefined();
  });
});

/**
 * #564: resetModuleCacheForTests() used to clear the `subscribed` guard
 * without detaching the listener a prior initModuleCacheInvalidation() call
 * had attached to the shared subscriber singleton (getRedisSubscriber()
 * returns the SAME instance across calls, exactly as subscriberFake does
 * here). A reset-then-reinit cycle therefore stacked a second 'message'
 * listener instead of replacing the first, so a single real invalidation
 * fired clearModuleCaches once per accumulated listener.
 */
describe('resetModuleCacheForTests and the subscriber listener', () => {
  it('does not accumulate a second listener across a reset + reinit cycle', async () => {
    await initModuleCacheInvalidation();
    expect(subscriberFake.listenerCount('message')).toBe(1);

    resetModuleCacheForTests();
    expect(subscriberFake.listenerCount('message')).toBe(0);

    await initModuleCacheInvalidation();
    expect(subscriberFake.listenerCount('message')).toBe(1);
  });

  it('stays at exactly one listener across several reset/reinit cycles', async () => {
    for (let i = 0; i < 3; i++) {
      resetModuleCacheForTests();
      await initModuleCacheInvalidation();
    }
    expect(subscriberFake.listenerCount('message')).toBe(1);
  });

  it('lets a restart re-subscribe after a reset, without throwing, when there was nothing to detach', () => {
    // No prior initModuleCacheInvalidation() call in this test — messageListener
    // is already null, so the detach branch must be a safe no-op.
    expect(() => resetModuleCacheForTests()).not.toThrow();
  });
});
