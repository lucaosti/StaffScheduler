/**
 * Route-level declarations of the org-unit scope and ownership rules.
 *
 * A route states WHICH row it touches and under WHICH permission —
 * `scope.reach('schedule.manage', 'schedule', 'params.id')` — and
 * `AccessPolicy` decides. The rule itself never appears in a handler, so it
 * cannot be pasted into one route and forgotten in the next (#867).
 *
 * WHY MIDDLEWARE AND NOT A CALL IN THE HANDLER. A declaration in the route's
 * middleware chain sits next to `requirePermission`, where a reviewer reads the
 * route's authorization in one line, and it is visible to the authorization
 * matrix suite (`__tests__/integration/authorization.integration.test.ts`),
 * which reads `accessRule` off the chain to prove every scoped route is probed
 * with another unit's ids. It must come AFTER the `validate*` middleware it
 * reads from: the ids it checks are the parsed ones in `res.locals`.
 *
 * Paths are `<params|body|query>.<key>`, with `[]` for every element of an
 * array (`body.assignments[].shiftId`). An absent value is not checked — an
 * optional body id that is not sent references nothing. Anything else that is
 * not an id fails CLOSED with a 500: a guard placed before the `validate*`
 * middleware it reads from (so `res.locals.body` does not exist yet), or a path
 * naming a field that is not a number, would otherwise check nothing and let
 * every request through. An internal fault is the right answer — it is a
 * mistake in the route, and the matrix suite runs every route into it.
 * All ids at one path are resolved in a single query.
 *
 * @author Luca Ostinelli
 */

import { NextFunction, Request, RequestHandler, Response } from 'express';
import { Pool } from 'mysql2/promise';
import { AccessPolicy, ScopedKind } from '../services/access/AccessPolicy';

export interface AccessRule {
  type: 'reach' | 'ownerOr';
  permissions: string[];
  kind: ScopedKind;
  at: string;
}

/**
 * Every id at `at` in the parsed request (`res.locals`). Throws (an internal
 * fault) when the source has not been parsed yet or a value there is not an id.
 */
export const idsAt = (locals: Record<string, unknown>, at: string): number[] => {
  const [source, ...segments] = at.split('.');
  if (locals[source] === undefined || locals[source] === null) {
    throw new Error(`accessScope: res.locals.${source} is not set — the guard for '${at}' runs before its validate* middleware`);
  }
  let values: unknown[] = [locals[source]];
  for (const segment of segments) {
    const each = segment.endsWith('[]');
    const key = each ? segment.slice(0, -2) : segment;
    values = values.flatMap((v) => {
      const next = v !== null && typeof v === 'object' ? (v as Record<string, unknown>)[key] : undefined;
      if (!each) return [next];
      if (next === undefined || next === null) return [];
      if (!Array.isArray(next)) throw new Error(`accessScope: '${at}' expects an array`);
      return next;
    });
  }
  const present = values.filter((v) => v !== undefined && v !== null);
  const bad = present.find((v) => typeof v !== 'number' || !Number.isInteger(v));
  if (bad !== undefined) throw new Error(`accessScope: '${at}' holds a value that is not an id`);
  return present as number[];
};

const guard = (rule: AccessRule, check: (req: Request, ids: number[]) => Promise<void>): RequestHandler => {
  const middleware = async (req: Request, res: Response, next: NextFunction) => {
    const ids = idsAt(res.locals, rule.at);
    if (ids.length > 0) await check(req, ids);
    next();
  };
  return Object.assign(middleware, { accessRule: rule });
};

/** The scope guards for one router, bound to its pool. */
export const accessScope = (pool: Pool) => {
  const policy = new AccessPolicy(pool);
  return {
    policy,
    /** The row at `at` must lie in the caller's scope for one of `permissions` (404 otherwise). */
    reach: (permissions: string | string[], kind: ScopedKind, at: string): RequestHandler => {
      const codes = Array.isArray(permissions) ? permissions : [permissions];
      return guard({ type: 'reach', permissions: codes, kind, at }, (req, ids) => policy.assertReach(req.user!, codes, kind, ids));
    },
    /**
     * The row's owner passes; anyone else needs one of `permissions` (403) and
     * the row inside that scope (404).
     */
    ownerOr: (permissions: string | string[], kind: ScopedKind, at: string): RequestHandler => {
      const codes = Array.isArray(permissions) ? permissions : [permissions];
      return guard({ type: 'ownerOr', permissions: codes, kind, at }, async (req, ids) => {
        for (const id of ids) await policy.assertOwnerOrReach(req.user!, codes, kind, id);
      });
    },
  };
};
