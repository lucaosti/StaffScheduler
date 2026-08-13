/**
 * Dashboard Routes
 *
 * Two endpoints, both backed by `DashboardService`: the summary counters and
 * the attention shortlist. This file used to own 380 lines of SQL — the only
 * router in the codebase that did — alongside three further endpoints that
 * nothing called (#719).
 *
 * Authorization model:
 * - Aggregate counters are visible to every authenticated user.
 * - Monthly labor cost is only computed for holders of `report.read`; other
 *   users receive `monthlyCost: null`. `monthlyCostPlan` — the sum of every
 *   admin-set cost plan target whose period overlaps the current month —
 *   carries the exact same gate and the exact same null-when-absent behavior,
 *   since it is the other half of the same comparison. Setting a target is a
 *   separate, stronger permission (`report.manage`, see `routes/costPlans.ts`);
 *   this route only reads the sum.
 * - Attention items follow the same rule: `report.read` lifts the org-unit
 *   bound, and without it a caller sees only the units they belong to — the
 *   membership-bound scope `resolveVisibleOrgUnits` computes elsewhere.
 *
 * @author Luca Ostinelli
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'mysql2/promise';
import { authenticate, userHasPermission } from '../middleware/auth';
import { RbacService } from '../services/RbacService';
import { DashboardService } from '../services/DashboardService';

export const createDashboardRouter = (pool: Pool) => {
  const router = Router();
  const dashboard = new DashboardService(pool);

  /**
   * @route GET /api/dashboard/stats
   * @returns Dashboard statistics and KPIs
   */
  router.get('/stats', authenticate, async (req: Request, res: Response) => {
    const stats = await dashboard.getStats(userHasPermission(req.user, 'report.read'));
    res.json({ success: true, data: stats });
  });

  /**
   * @route GET /api/dashboard/attention-items
   * @returns Understaffed shifts and aging pending approvals for this caller
   */
  router.get('/attention-items', authenticate, async (req: Request, res: Response) => {
    // Null means "no org-unit bound": `report.read` lifts the scope the way it
    // already does for the cost figures above.
    const visibleOrgUnitIds = userHasPermission(req.user, 'report.read')
      ? null
      : await new RbacService(pool).getUserOrgUnitSubtreeIds(req.user!.id);

    const data = await dashboard.getAttentionItems(req.user!.id, visibleOrgUnitIds);
    res.json({ success: true, data });
  });

  return router;
};
