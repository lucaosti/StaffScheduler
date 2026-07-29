/**
 * Skills catalogue routes — `/api/skills`.
 *
 * PERMISSIONS. Reading is gated on `employee.read`: skill names already reach
 * anyone who can see a staff record, since they are part of it, and a picker
 * that cannot list them is a picker that cannot work. Writing is gated on
 * `employee.manage`, whose own description in the permission catalogue is
 * "Create, update and delete staff records **and their skills**" — so the
 * authority already exists and inventing a `skill.manage` code beside it would
 * split one responsibility across two grants.
 *
 * WHY THERE IS NO DEACTIVATE ENDPOINT. Retiring a skill is `PUT` with
 * `isActive: false`. A dedicated verb would suggest it is a different kind of
 * act from renaming one, and then `DELETE` and `/deactivate` would sit next to
 * each other meaning almost the same thing — which is exactly the confusion
 * the refusal in `remove()` exists to resolve.
 *
 * @author Luca Ostinelli
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'mysql2/promise';
import { authenticate, requirePermission } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { idParam, createSkillBody, updateSkillBody, skillListQuery } from '../schemas';
import { SkillService } from '../services/SkillService';

export const createSkillsRouter = (pool: Pool) => {
  const router = Router();
  const service = new SkillService(pool);

  router.get(
    '/',
    authenticate,
    requirePermission('employee.read'),
    validateQuery(skillListQuery),
    asyncHandler(async (_req: Request, res: Response) => {
      const activeOnly = res.locals.query.activeOnly as boolean | undefined;
      res.json({ success: true, data: await service.list({ activeOnly }) });
    })
  );

  router.get(
    '/:id',
    authenticate,
    requirePermission('employee.read'),
    validateParams(idParam),
    asyncHandler(async (_req: Request, res: Response) => {
      res.json({ success: true, data: await service.getById(res.locals.params.id) });
    })
  );

  router.post(
    '/',
    authenticate,
    requirePermission('employee.manage'),
    validateBody(createSkillBody),
    asyncHandler(async (_req: Request, res: Response) => {
      const created = await service.create(res.locals.body);
      res.status(201).json({ success: true, data: created, message: 'Skill created' });
    })
  );

  router.put(
    '/:id',
    authenticate,
    requirePermission('employee.manage'),
    validateParams(idParam),
    validateBody(updateSkillBody),
    asyncHandler(async (_req: Request, res: Response) => {
      const updated = await service.update(res.locals.params.id, res.locals.body);
      res.json({ success: true, data: updated, message: 'Skill updated' });
    })
  );

  router.delete(
    '/:id',
    authenticate,
    requirePermission('employee.manage'),
    validateParams(idParam),
    asyncHandler(async (_req: Request, res: Response) => {
      await service.remove(res.locals.params.id);
      res.json({ success: true, message: 'Skill deleted' });
    })
  );

  return router;
};
