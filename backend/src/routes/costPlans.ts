/**
 * Cost plan routes — `/api/cost-plans`.
 *
 * A cost plan is the fixed labor-cost target an administrator sets for one
 * department over one period; `/dashboard/stats`' `monthlyCostPlan` is the
 * sum of whichever plans overlap the current month, gated on `report.read`
 * exactly like the `monthlyCost` figure it sits next to. This router is the
 * other half: the CRUD surface for setting the target in the first place.
 *
 * WHY `report.manage` AND NOT `report.read` FOR WRITES. Viewing the
 * comparison and deciding what the organization is being measured against
 * are different acts — the same read/write separation `payroll.manage`
 * already draws against its own read-side gates. `report.read` stays the
 * read-only gate for both the comparison on `/dashboard/stats` and listing
 * plans here; `report.manage` is required to create, update or delete one.
 *
 * @author Luca Ostinelli
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'mysql2/promise';
import { authenticate, requirePermission } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import {
  costPlanBody,
  costPlanUpdateBody,
  costPlanIdParam,
  costPlanListQuery,
} from '../schemas';
import { CostPlanService } from '../services/CostPlanService';

export const createCostPlansRouter = (pool: Pool): Router => {
  const router = Router();
  const service = new CostPlanService(pool);

  router.use(authenticate);

  router.get('/', requirePermission('report.read'), validateQuery(costPlanListQuery), async (_req: Request, res: Response) => {
    const plans = await service.list(res.locals.query.departmentId);
    res.json({ success: true, data: plans });
  });

  router.get('/:id', requirePermission('report.read'), validateParams(costPlanIdParam), async (_req: Request, res: Response) => {
    const plan = await service.getById(res.locals.params.id);
    res.json({ success: true, data: plan });
  });

  router.post('/', requirePermission('report.manage'), validateBody(costPlanBody), async (req: Request, res: Response) => {
    const body = res.locals.body;
    const plan = await service.create({
      departmentId: body.departmentId,
      startDate: body.startDate,
      endDate: body.endDate,
      targetAmount: body.targetAmount,
      setByUserId: req.user!.id,
    });
    res.status(201).json({ success: true, data: plan, message: 'Cost plan created' });
  });

  router.put(
    '/:id',
    requirePermission('report.manage'),
    validateParams(costPlanIdParam),
    validateBody(costPlanUpdateBody),
    async (_req: Request, res: Response) => {
      const plan = await service.update(res.locals.params.id, res.locals.body.targetAmount);
      res.json({ success: true, data: plan, message: 'Cost plan updated' });
    }
  );

  router.delete('/:id', requirePermission('report.manage'), validateParams(costPlanIdParam), async (_req: Request, res: Response) => {
    await service.remove(res.locals.params.id);
    res.json({ success: true, message: 'Cost plan deleted' });
  });

  return router;
};
