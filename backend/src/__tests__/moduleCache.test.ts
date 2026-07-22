/**
 * moduleCache tests — the process-wide flag cache, its TTL backstop and the
 * cross-replica pub/sub invalidation.
 */

export {};

const publish = jest.fn().mockResolvedValue(1);
const subscribe = jest.fn().mockResolvedValue(undefined);
const on = jest.fn();
let redisAvailable = true;

jest.mock('../config/redis', () => ({
  getRedis: () => (redisAvailable ? { publish } : null),
  getRedisSubscriber: () => (redisAvailable ? { subscribe, on } : null),
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

    const handler = on.mock.calls.find(([evt]) => evt === 'message')![1];

    writeOrgModules('acme', new Map());
    handler('cache:modules', 'acme');
    expect(readOrgModules('acme')).toBeNull();

    writeGlobalModules(new Map([['a', true]]));
    handler('cache:modules', '*');
    expect(readGlobalModules()).toBeNull();

    // A frame from another channel is ignored.
    writeGlobalModules(new Map([['a', true]]));
    handler('sse:user-events', '*');
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
