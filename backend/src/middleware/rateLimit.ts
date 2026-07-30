/**
 * The request budget, shared across replicas and charged per tenant.
 *
 * WHAT WAS WRONG WITH THE OLD ONE. `express-rate-limit` with its defaults keys
 * on the client IP and counts in a process-local Map. Both halves fail this
 * deployment:
 *
 *  - THE STORE IS PER-PROCESS. This backend is documented and scripted as
 *    horizontally scalable (`--scale backend=2` behind nginx). With N replicas
 *    the configured budget is enforced N times over, so a limit that says
 *    200/min silently permits 400/min at two replicas. Nothing in a
 *    single-instance test run reveals it, and the number in the configuration is
 *    simply untrue in production. The counters now live in the shared cache
 *    store, which is Redis when Redis is configured.
 *
 *  - THE IP IS THE WRONG UNIT. Behind a corporate NAT or a proxy, an entire
 *    organization arrives as one address and shares one bucket, so the busiest
 *    site throttles its own quiet colleagues. In the other direction, a client
 *    spread over several addresses gets a bucket each and the limit does not
 *    bind at all. Neither is what a per-tenant budget is for.
 *
 * THE KEY, IN ORDER OF PREFERENCE: the caller's ORGANIZATION (the root of their
 * org-unit tree), then their USER id, then the IP. Each step is a fallback for
 * the previous being unavailable, not a policy choice:
 *
 *  - `org:<id>` once the tenant is known. This is the unit the issue asks for:
 *    one tenant's traffic cannot consume another's budget, whichever address or
 *    account it arrives from.
 *  - `user:<id>` when the token is valid but the tenant is not resolvable — a
 *    user with no org-unit membership, or a database blip. Still far better than
 *    the IP, and it never borrows another tenant's allowance.
 *  - `ip:<addr>` for unauthenticated traffic, which is the login endpoint and
 *    the health checks. Those must be limited by something, and the address is
 *    all there is before a token exists.
 *
 * WHY THE TOKEN IS VERIFIED HERE, BEFORE `authenticate`. The limiter has to
 * protect the login endpoint, so it cannot run after authentication. It
 * therefore verifies the JWT signature itself — an HMAC check, no database — and
 * uses the result ONLY to choose a counter. This is deliberately NOT an
 * authorization decision and must never become one: an expired or forged token
 * simply falls through to the IP bucket, which is the conservative direction. No
 * request is ever admitted because of what this middleware read.
 *
 * WHY THE TENANT LOOKUP IS CACHED FOR MINUTES. Resolving user → root org unit is
 * a recursive walk up the tree; doing it per request would put a query in front
 * of every call in the system, which is exactly the cost a rate limiter must not
 * add. It is cached for five minutes, and a stale entry is harmless in a way a
 * stale permission would not be: the worst case is that a user who changed
 * organization is charged to their previous one for a few minutes. A budget is
 * not a permission, and this distinction is why the same shortcut would be
 * unacceptable in `authenticate`.
 *
 * WHY AN ORGANIZATION GETS A LARGER LIMIT THAN AN INDIVIDUAL. An org bucket
 * aggregates every employee behind it, so charging it the per-caller budget
 * would throttle a large tenant at the size of a small one. `RATE_LIMIT_ORG_MAX`
 * is the tenant-wide ceiling; `RATE_LIMIT_MAX_REQUESTS` remains the per-caller
 * one and still applies to user and IP keys.
 *
 * @author Luca Ostinelli
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Pool, RowDataPacket } from 'mysql2/promise';
import { config } from '../config';
import { incrementCounter } from '../services/cacheStore';
import { logger } from '../config/logger';

/** How long a resolved user → organization mapping is trusted. */
const TENANT_CACHE_TTL_MS = 5 * 60 * 1000;

export type RateLimitKeyKind = 'org' | 'user' | 'ip';

export interface RateLimitKey {
  key: string;
  kind: RateLimitKeyKind;
}

/**
 * user id → organization id, or null for "looked up, has none".
 *
 * Process-local on purpose: unlike the counters, this is a pure derivation of
 * data every instance can read for itself, so replicating it through Redis
 * would buy consistency nobody needs and add a round trip to the hot path.
 */
const tenantCache = new Map<number, { orgId: number | null; expiresAt: number }>();

/** Exported for tests; a stale mapping would otherwise outlive the case. */
export const _clearTenantCache = (): void => tenantCache.clear();

/**
 * The root of the caller's org-unit tree — the organization they belong to.
 *
 * Walks `parent_id` upward from the primary membership. A recursive CTE keeps it
 * to one round trip; the depth guard is the CTE's own, and a cycle in the tree
 * (which the schema permits, since `parent_id` is a plain self-reference) would
 * otherwise be an infinite walk in application code.
 */
const resolveOrganization = async (pool: Pool, userId: number): Promise<number | null> => {
  const cached = tenantCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.orgId;

  let orgId: number | null = null;
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `WITH RECURSIVE ancestry (id, parent_id, depth) AS (
         SELECT ou.id, ou.parent_id, 0
           FROM user_org_units uou
           JOIN org_units ou ON ou.id = uou.org_unit_id
          WHERE uou.user_id = ? AND uou.is_primary = 1
          UNION ALL
         SELECT ou.id, ou.parent_id, a.depth + 1
           FROM ancestry a
           JOIN org_units ou ON ou.id = a.parent_id
          WHERE a.depth < 32
       )
       SELECT id FROM ancestry ORDER BY depth DESC LIMIT 1`,
      [userId]
    );
    orgId = rows.length > 0 ? (rows[0].id as number) : null;
  } catch (error) {
    // A failed lookup must not fail the request: the caller falls back to their
    // user bucket, which is still per-caller. Cached as null so a database
    // problem does not turn into a query storm.
    logger.warn('Rate limiter could not resolve the caller organization', { userId, error });
  }

  tenantCache.set(userId, { orgId, expiresAt: Date.now() + TENANT_CACHE_TTL_MS });
  return orgId;
};

/** The user id in a VALID token, or null. Never an authorization decision. */
const userIdFromToken = (req: Request): number | null => {
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;
  const token = bearer ?? (req.cookies?.token as string | undefined) ?? null;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwt.secret) as { userId?: number };
    return typeof payload.userId === 'number' ? payload.userId : null;
  } catch {
    // Expired, forged or malformed: fall through to the IP bucket. The
    // conservative direction — a bad token never buys a bigger allowance.
    return null;
  }
};

export const resolveRateLimitKey = async (pool: Pool, req: Request): Promise<RateLimitKey> => {
  const userId = userIdFromToken(req);
  if (userId !== null) {
    const orgId = await resolveOrganization(pool, userId);
    if (orgId !== null) return { key: `org:${orgId}`, kind: 'org' };
    return { key: `user:${userId}`, kind: 'user' };
  }
  return { key: `ip:${req.ip ?? 'unknown'}`, kind: 'ip' };
};

/** The budget a key of this kind is charged against. */
export const limitForKind = (kind: RateLimitKeyKind): number =>
  kind === 'org' ? config.security.rateLimitOrgMax : config.security.rateLimitMax;

export interface FixedWindowOptions {
  windowMs: number;
  /** The budget, given the resolved key — a function so it can vary by key kind. */
  limit: (key: RateLimitKey) => number;
  /** How a request is charged. Async because the tenant may need resolving. */
  key: (req: Request) => Promise<RateLimitKey>;
  /** The error code in the 429 envelope. */
  code: string;
  message: string;
}

/**
 * A fixed-window limiter over the shared counter store.
 *
 * Written directly rather than as an `express-rate-limit` store because the two
 * things that had to change — the key and the limit — are both per-request
 * decisions the library expresses through separate callbacks, each of which
 * would resolve the tenant again. One resolution per request, in one place.
 *
 * The response carries the same standard `RateLimit-*` headers the previous
 * configuration emitted (`standardHeaders: true`), so clients see no change in
 * the contract.
 *
 * EVERY FAILURE MODE ADMITS THE REQUEST. If the key cannot be resolved or the
 * counter cannot be read, the request goes through uncounted and a warning is
 * logged. A limiter that returned 500 when its own store was unavailable would
 * take the whole API down to enforce a budget, which is a worse outcome than the
 * burst it was preventing. The counter store already degrades to in-process
 * counting when Redis is absent, so reaching this path at all means something
 * further gone than a Redis blip.
 */
export const createFixedWindowLimiter = (options: FixedWindowOptions) => {
  const { windowMs, limit, key, code, message } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    let resolved: RateLimitKey;
    let count: number;
    let resetTime: Date;
    try {
      resolved = await key(req);
      ({ count, resetTime } = await incrementCounter(resolved.key, windowMs));
    } catch (error) {
      logger.warn('Rate limiter could not count a request; admitting it', { error });
      next();
      return;
    }

    const max = limit(resolved);
    const secondsToReset = Math.max(0, Math.ceil((resetTime.getTime() - Date.now()) / 1000));
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - count)));
    res.setHeader('RateLimit-Reset', String(secondsToReset));

    if (count > max) {
      res.setHeader('Retry-After', String(Math.max(1, secondsToReset)));
      res.status(429).json({ success: false, error: { code, message } });
      return;
    }

    next();
  };
};

/** The global request budget: per organization where known, else per caller. */
export const createRateLimiter = (pool: Pool) =>
  createFixedWindowLimiter({
    windowMs: config.security.rateLimitWindow,
    limit: (resolved) => limitForKind(resolved.kind),
    key: (req) => resolveRateLimitKey(pool, req),
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many requests, please try again later.',
  });

/**
 * Brute-force protection for the login endpoint.
 *
 * Keyed by IP and NOT by the tenant machinery above, deliberately: a login
 * attempt has no authenticated caller, and keying on the submitted email would
 * let an attacker lock a known account out by exhausting its budget on purpose.
 * The address is the only thing an attacker cannot choose freely.
 *
 * It shares the counter store with everything else, which is the point of moving
 * it: a per-process store meant that at two replicas ten attempts became twenty,
 * and this is the one limit where that difference is a security property rather
 * than a fairness one.
 *
 * Lenient under `NODE_ENV === 'test'` so the integration suites can call
 * `/login` repeatedly without tripping it.
 */
export const createLoginLimiter = () =>
  createFixedWindowLimiter({
    windowMs: 15 * 60 * 1000,
    limit: () => (config.server.env === 'test' ? 1000 : 10),
    key: async (req) => ({ key: `login:${req.ip ?? 'unknown'}`, kind: 'ip' }),
    code: 'TOO_MANY_REQUESTS',
    message: 'Too many login attempts, please try again later.',
  });
