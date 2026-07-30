/**
 * Which bucket a request is charged to.
 *
 * The property under test is that one tenant cannot spend another's budget —
 * and the cases that prove it are the FALLBACKS, because that is where a naive
 * implementation leaks. A forged token must not buy an organization's larger
 * allowance; a user with no org unit must not land in a shared bucket; an
 * unauthenticated caller must still be counted as something.
 *
 * The key derivation is also the one place in the system where a JWT is read
 * outside `authenticate`, so "an invalid token is worth nothing here" is
 * asserted rather than assumed.
 *
 * @author Luca Ostinelli
 */

import jwt from 'jsonwebtoken';
import { Request } from 'express';
import { config } from '../config';
import { _clearTenantCache, limitForKind, resolveRateLimitKey } from '../middleware/rateLimit';

export {};

const query = jest.fn();
const pool = { query } as never;

/** The ancestry CTE returns the root org unit, or nothing. */
const orgRows = (id: number | null) => [id === null ? [] : [{ id }], []];

const req = (over: Partial<Request> = {}): Request =>
  ({ ip: '203.0.113.7', headers: {}, cookies: {}, ...over }) as Request;

const signed = (payload: object, secret = config.jwt.secret) =>
  jwt.sign(payload, secret, { expiresIn: '15m' });

beforeEach(() => {
  jest.clearAllMocks();
  _clearTenantCache();
  query.mockResolvedValue(orgRows(42));
});

describe('the key a request is charged to', () => {
  it('is the caller organization when the token resolves to one', async () => {
    const resolved = await resolveRateLimitKey(pool, req({ cookies: { token: signed({ userId: 5 }) } }));
    expect(resolved).toEqual({ key: 'org:42', kind: 'org' });
  });

  it('reads a Bearer token as well as the cookie', async () => {
    const resolved = await resolveRateLimitKey(
      pool,
      req({ headers: { authorization: `Bearer ${signed({ userId: 5 })}` } })
    );
    expect(resolved.kind).toBe('org');
  });

  it('falls back to the user when they belong to no org unit', async () => {
    query.mockResolvedValue(orgRows(null));
    const resolved = await resolveRateLimitKey(pool, req({ cookies: { token: signed({ userId: 5 }) } }));
    // Still per-caller, and it never borrows another tenant's allowance.
    expect(resolved).toEqual({ key: 'user:5', kind: 'user' });
  });

  it('falls back to the user when the lookup fails, rather than throwing', async () => {
    query.mockRejectedValue(new Error('db down'));
    const resolved = await resolveRateLimitKey(pool, req({ cookies: { token: signed({ userId: 5 }) } }));
    expect(resolved).toEqual({ key: 'user:5', kind: 'user' });
  });

  it('falls back to the IP with no token at all', async () => {
    const resolved = await resolveRateLimitKey(pool, req());
    expect(resolved).toEqual({ key: 'ip:203.0.113.7', kind: 'ip' });
    expect(query).not.toHaveBeenCalled();
  });
});

describe('a token this middleware will not trust', () => {
  it('gets the IP bucket when the signature is wrong', async () => {
    const forged = signed({ userId: 5 }, 'not-the-secret');
    const resolved = await resolveRateLimitKey(pool, req({ cookies: { token: forged } }));
    // The conservative direction: a forged token must never buy the larger
    // organization allowance, which is the only thing this read could be
    // exploited for.
    expect(resolved.kind).toBe('ip');
    expect(query).not.toHaveBeenCalled();
  });

  it('gets the IP bucket when the token has expired', async () => {
    const expired = jwt.sign({ userId: 5 }, config.jwt.secret, { expiresIn: -10 });
    const resolved = await resolveRateLimitKey(pool, req({ cookies: { token: expired } }));
    expect(resolved.kind).toBe('ip');
  });

  it('gets the IP bucket when the token is not a JWT at all', async () => {
    const resolved = await resolveRateLimitKey(pool, req({ cookies: { token: 'garbage' } }));
    expect(resolved.kind).toBe('ip');
  });

  it('gets the IP bucket when a valid token carries no userId', async () => {
    const resolved = await resolveRateLimitKey(pool, req({ cookies: { token: signed({ sub: 'x' }) } }));
    expect(resolved.kind).toBe('ip');
  });
});

describe('the tenant lookup cache', () => {
  it('resolves an organization once per user, not once per request', async () => {
    const token = signed({ userId: 5 });
    await resolveRateLimitKey(pool, req({ cookies: { token } }));
    await resolveRateLimitKey(pool, req({ cookies: { token } }));
    await resolveRateLimitKey(pool, req({ cookies: { token } }));

    // A query in front of every call in the system is exactly the cost a rate
    // limiter must not add.
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('caches a failed lookup too, so a database problem is not a query storm', async () => {
    query.mockRejectedValue(new Error('db down'));
    const token = signed({ userId: 5 });
    await resolveRateLimitKey(pool, req({ cookies: { token } }));
    await resolveRateLimitKey(pool, req({ cookies: { token } }));

    expect(query).toHaveBeenCalledTimes(1);
  });

  it('keeps separate users separate', async () => {
    query.mockResolvedValueOnce(orgRows(42)).mockResolvedValueOnce(orgRows(99));
    const a = await resolveRateLimitKey(pool, req({ cookies: { token: signed({ userId: 5 }) } }));
    const b = await resolveRateLimitKey(pool, req({ cookies: { token: signed({ userId: 6 }) } }));

    expect(a.key).toBe('org:42');
    expect(b.key).toBe('org:99');
  });
});

describe('the budget each kind of key gets', () => {
  it('gives an organization the tenant-wide ceiling', () => {
    // An org bucket aggregates every employee behind it, so charging it the
    // per-caller budget would throttle a large tenant at the size of a small one.
    expect(limitForKind('org')).toBe(config.security.rateLimitOrgMax);
    expect(limitForKind('org')).toBeGreaterThan(limitForKind('user'));
  });

  it('gives a user and an IP the per-caller budget', () => {
    expect(limitForKind('user')).toBe(config.security.rateLimitMax);
    expect(limitForKind('ip')).toBe(config.security.rateLimitMax);
  });
});
