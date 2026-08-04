/**
 * Timeline routes — `/api/timeline`.
 *
 * WHY THE SCOPE IS RESOLVED HERE AND NEVER SENT BY THE CLIENT. The timeline
 * shows named people and when they are at work. A client-supplied org unit
 * would make the boundary a request parameter, which is not a boundary; the
 * caller's own units are derived from their memberships and their role scope,
 * and the query is restricted before it runs rather than filtered after.
 *
 * WHY TWO PERMISSIONS. `allowedOrgUnitIds` is NULL for anyone whose roles
 * carry no org-unit scope, and NULL means unrestricted — so a single code
 * granted to the Employee role would publish the whole organization's
 * movements to everyone in it. `timeline.read` therefore means "your own units
 * and their subtrees" and is computed from membership; `timeline.read_all`
 * means no restriction and is what a planner holds.
 *
 * An employee attached to no org unit sees an empty timeline rather than
 * everything — the safe direction, and the one that makes a misconfigured
 * membership visible instead of catastrophic.
 *
 * @author Luca Ostinelli
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'mysql2/promise';
import { authenticate, requirePermission } from '../middleware/auth';
import { validateQuery } from '../middleware/validation';
import { timelineQuery } from '../schemas';
import { TimelineService, TIMELINE_SOURCE_KEYS } from '../services/TimelineService';
import { RbacService } from '../services/RbacService';
import { resolveVisibleOrgUnits } from '../services/orgScope';

export const createTimelineRouter = (pool: Pool) => {
  const router = Router();
  const timeline = new TimelineService(pool);
  const rbac = new RbacService(pool);

  router.get(
    '/',
    authenticate,
    requirePermission('timeline.read'),
    validateQuery(timelineQuery),
    async (req: Request, res: Response) => {
      const user = req.user!;
      const { from, to, sources } = res.locals.query as {
        from: string;
        to: string;
        sources?: string;
      };

      // Shared with the aggregate calendar feed, which asks the same question —
      // who may see when a named colleague is at work. See services/orgScope
      // for why the role scope binds even for a caller holding `read_all`.
      const orgUnitIds = await resolveVisibleOrgUnits(rbac, {
        userId: user.id,
        permissions: user.permissions ?? [],
        allowedOrgUnitIds: user.allowedOrgUnitIds ?? null,
        allPermission: 'timeline.read_all',
      });

      const data = await timeline.build({
        from,
        to,
        orgUnitIds,
        sources: sources ? sources.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
      });
      res.json({ success: true, data });
    }
  );

  // The sources a client may ask for, so a legend or a filter list is read
  // from the server rather than duplicated in the frontend and left behind
  // when a source is added.
  router.get(
    '/sources',
    authenticate,
    requirePermission('timeline.read'),
    async (_req: Request, res: Response) => {
      res.json({ success: true, data: TIMELINE_SOURCE_KEYS });
    }
  );

  return router;
};
