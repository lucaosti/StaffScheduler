/**
 * cacheStore tests — both backends and the fallback contract.
 *
 * The store must behave identically for a single instance whether Redis is
 * present or not, and a Redis command that throws must degrade to the
 * in-process path rather than surface. These tests drive both: with Redis
 * disabled they exercise the bounded-TTL memory store (fake timers make
 * expiry deterministic); with a mocked Redis they assert the exact commands
 * (SET ... EX, EXISTS, GET, DEL) and that a throwing client falls back.
 */

const redisMock = {
  set: jest.fn(),
  get: jest.fn(),
  exists: jest.fn(),
  del: jest.fn(),
};
let redisConfigured = false;

jest.mock('../config/redis', () => ({
  isRedisConfigured: () => redisConfigured,
  getRedis: () => (redisConfigured ? redisMock : null),
}));

import {
  blacklistJti,
  isJtiBlacklisted,
  getAuthContext,
  setAuthContext,
  invalidateAuthContext,
  MemoryTtlStore,
} from '../services/cacheStore';

describe('MemoryTtlStore — bounds and pruning', () => {
  it('evicts the oldest entry (FIFO) at capacity', () => {
    const store = new MemoryTtlStore<number>(2);
    store.set('a', 1, 10_000);
    store.set('b', 2, 10_000);
    store.set('c', 3, 10_000); // pushes 'a' out
    expect(store.get('a')).toBeUndefined();
    expect(store.get('b')).toBe(2);
    expect(store.get('c')).toBe(3);
  });

  it('treats an expired entry as absent and drops it', () => {
    jest.useFakeTimers();
    try {
      const store = new MemoryTtlStore<string>(10);
      store.set('k', 'v', 1000);
      jest.advanceTimersByTime(1001);
      expect(store.get('k')).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('prune() removes only expired entries', () => {
    jest.useFakeTimers();
    try {
      const store = new MemoryTtlStore<string>(10);
      store.set('short', 'x', 500);
      store.set('long', 'y', 5000);
      jest.advanceTimersByTime(1000);
      store.prune();
      expect(store.get('short')).toBeUndefined();
      expect(store.get('long')).toBe('y');
    } finally {
      jest.useRealTimers();
    }
  });

  it('delete() removes an entry', () => {
    const store = new MemoryTtlStore<number>(10);
    store.set('k', 1, 10_000);
    store.delete('k');
    expect(store.get('k')).toBeUndefined();
  });
});

describe('cacheStore — in-process fallback (Redis disabled)', () => {
  beforeEach(() => {
    redisConfigured = false;
  });

  it('blacklists a jti and reports it until its TTL elapses', async () => {
    jest.useFakeTimers();
    try {
      await blacklistJti('jti-1', 1000);
      await expect(isJtiBlacklisted('jti-1')).resolves.toBe(true);
      jest.advanceTimersByTime(1001);
      await expect(isJtiBlacklisted('jti-1')).resolves.toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('reports an unknown jti as not blacklisted', async () => {
    await expect(isJtiBlacklisted('never-set')).resolves.toBe(false);
  });

  it('round-trips an auth context and expires it on TTL', async () => {
    jest.useFakeTimers();
    try {
      await setAuthContext(42, '{"id":42}', 1000);
      await expect(getAuthContext(42)).resolves.toBe('{"id":42}');
      jest.advanceTimersByTime(1001);
      await expect(getAuthContext(42)).resolves.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('invalidateAuthContext drops the entry immediately', async () => {
    await setAuthContext(7, '{"id":7}', 10_000);
    await invalidateAuthContext(7);
    await expect(getAuthContext(7)).resolves.toBeNull();
  });
});

describe('cacheStore — Redis backend', () => {
  beforeEach(() => {
    redisConfigured = true;
    for (const fn of Object.values(redisMock)) fn.mockReset();
  });

  it('blacklists via SET with a native expiry and checks via EXISTS', async () => {
    redisMock.set.mockResolvedValue('OK');
    await blacklistJti('jti-x', 5000);
    expect(redisMock.set).toHaveBeenCalledWith('jti:blacklist:jti-x', '1', 'EX', 5);

    redisMock.exists.mockResolvedValue(1);
    await expect(isJtiBlacklisted('jti-x')).resolves.toBe(true);
    redisMock.exists.mockResolvedValue(0);
    await expect(isJtiBlacklisted('jti-x')).resolves.toBe(false);
  });

  it('stores and reads an auth context, and deletes on invalidate', async () => {
    redisMock.set.mockResolvedValue('OK');
    await setAuthContext(9, '{"id":9}', 30_000);
    expect(redisMock.set).toHaveBeenCalledWith('auth:ctx:9', '{"id":9}', 'EX', 30);

    redisMock.get.mockResolvedValue('{"id":9}');
    await expect(getAuthContext(9)).resolves.toBe('{"id":9}');

    redisMock.del.mockResolvedValue(1);
    await invalidateAuthContext(9);
    expect(redisMock.del).toHaveBeenCalledWith('auth:ctx:9');
  });

  it('falls back to the memory store when a Redis command throws', async () => {
    redisMock.set.mockRejectedValue(new Error('redis down'));
    redisMock.exists.mockRejectedValue(new Error('redis down'));
    // The blacklist write falls through to memory; the read falls through too
    // and still finds it, so a Redis outage degrades to single-instance
    // behaviour rather than losing the revocation.
    await blacklistJti('jti-fallback', 5000);
    await expect(isJtiBlacklisted('jti-fallback')).resolves.toBe(true);
  });

  it('falls back to memory on a failed auth-context read/write', async () => {
    redisMock.set.mockRejectedValue(new Error('down'));
    redisMock.get.mockRejectedValue(new Error('down'));
    await setAuthContext(11, '{"id":11}', 10_000);
    await expect(getAuthContext(11)).resolves.toBe('{"id":11}');
  });
});
