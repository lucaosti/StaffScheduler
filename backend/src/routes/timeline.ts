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
import { authenticate, requirePermission, userHasPermission } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateQuery } from '../middleware/validation';
import { timelineQuery } from '../schemas';
import { TimelineService, TIMELINE_SOURCE_KEYS } from '../services/TimelineService';
import { RbacService } from '../services/RbacService';

export const createTimelineRouter = (pool: Pool) => {
  const router = Router();
  const timeline = new TimelineService(pool);
  const rbac = new RbacService(pool);

  router.get(
    '/',
    authenticate,
    requirePermission('timeline.read'),
    validateQuery(timelineQuery),
    asyncHandler(async (req: Request, res: Response) => {
      const user = req.user!;
      const { from, to, sources } = res.locals.query as {
        from: string;
        to: string;
        sources?: string;
      };

      let orgUnitIds: number[] | null;
      if (userHasPermission(user, 'timeline.read_all')) {
        orgUnitIds = null;
      } else {
        // The subtree of each unit the person belongs to: someone in a ward
        // sees the ward, including anything organised beneath it. Intersected
        // with their role scope when they have one, so a scoped role can only
        // narrow this and never widen it.
        const own = await rbac.getUserOrgUnitSubtreeIds(user.id);
        const scoped = user.allowedOrgUnitIds;
        orgUnitIds = scoped === null || scoped === undefined
          ? own
          : own.filter((id) => scoped.includes(id));
      }

      const data = await timeline.build({
        from,
        to,
        orgUnitIds,
        sources: sources ? sources.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
      });
      res.json({ success: true, data });
    })
  );

  // The sources a client may ask for, so a legend or a filter list is read
  // from the server rather than duplicated in the frontend and left behind
  // when a source is added.
  router.get(
    '/sources',
    authenticate,
    requirePermission('timeline.read'),
    asyncHandler(async (_req: Request, res: Response) => {
      res.json({ success: true, data: TIMELINE_SOURCE_KEYS });
    })
  );

  return router;
};
