/**
 * Employment contract routes — `/api/employment-contracts`.
 *
 * WHY THESE EXIST RATHER THAN THE SERVICE BEING WIRED ONLY INTO THE OPTIMIZER.
 * The contract entity was introduced so working-time limits could be shared
 * and effective-dated. A service with CRUD methods and no HTTP surface is an
 * unwired capability — the same shape as the skill catalogue that sat in the
 * tree with no router, no spec entry and no UI, alive only because its own
 * tests referenced it. Either contracts are manageable, or they should not be
 * modelled yet.
 *
 * PERMISSIONS. Reading is gated on `employee.read`: a scheduling manager needs
 * to see why someone can or cannot take a shift. Writing is gated on
 * `preferences.manage` — the same permission that guards setting another
 * person's limits directly, deliberately, because moving someone onto a
 * different contract IS setting their limits, and splitting the two would let
 * the weaker permission accomplish what the stronger one guards.
 *
 * @author Luca Ostinelli
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'mysql2/promise';
import { authenticate, requirePermission } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateBody, validateParams } from '../middleware/validation';
import {
  idParam,
  userIdParam,
  createEmploymentContractBody,
  updateEmploymentContractBody,
  assignEmploymentContractBody,
} from '../schemas';
import { EmploymentContractService } from '../services/EmploymentContractService';

export const createEmploymentContractsRouter = (pool: Pool) => {
  const router = Router();
  const service = new EmploymentContractService(pool);

  router.get('/', authenticate, requirePermission('employee.read'), asyncHandler(async (_req: Request, res: Response) => {
    res.json({ success: true, data: await service.list() });
  }));

  // Registered before `/:id` so the literal segment is not matched as an id —
  // see shifts.ts, where the same ordering is load-bearing.
  router.get('/users/:userId', authenticate, requirePermission('employee.read'), validateParams(userIdParam), asyncHandler(async (_req: Request, res: Response) => {
    res.json({ success: true, data: await service.assignmentsForUser(res.locals.params.userId) });
  }));

  router.post('/users/:userId', authenticate, requirePermission('preferences.manage'), validateParams(userIdParam), validateBody(assignEmploymentContractBody), asyncHandler(async (_req: Request, res: Response) => {
    const assigned = await service.assign({
      userId: res.locals.params.userId,
      ...res.locals.body,
    });
    res.status(201).json({ success: true, data: assigned, message: 'Contract assigned' });
  }));

  router.get('/:id', authenticate, requirePermission('employee.read'), validateParams(idParam), asyncHandler(async (_req: Request, res: Response) => {
    res.json({ success: true, data: await service.getById(res.locals.params.id) });
  }));

  router.post('/', authenticate, requirePermission('preferences.manage'), validateBody(createEmploymentContractBody), asyncHandler(async (_req: Request, res: Response) => {
    const created = await service.create(res.locals.body);
    res.status(201).json({ success: true, data: created, message: 'Employment contract created' });
  }));

  router.put('/:id', authenticate, requirePermission('preferences.manage'), validateParams(idParam), validateBody(updateEmploymentContractBody), asyncHandler(async (_req: Request, res: Response) => {
    const updated = await service.update(res.locals.params.id, res.locals.body);
    res.json({ success: true, data: updated, message: 'Employment contract updated' });
  }));

  return router;
};
