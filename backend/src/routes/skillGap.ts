/**
 * Skill gap analysis route (F12). Manager only.
 *
 *   GET /api/skill-gap?departmentId=&start=&end=
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { Router, Request, Response } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { SkillGapService } from '../services/SkillGapService';
import { validateQuery } from '../middleware/validation';
import { skillGapQuery } from '../schemas';

export const createSkillGapRouter = (pool: Pool): Router => {
  const router = Router();
  const service = new SkillGapService(pool);

  router.use(authenticate, requirePermission('report.read'));

  // Presence and ISO-date shape are enforced by the schema; the handler used
  // to re-implement both checks inline.
  router.get('/', validateQuery(skillGapQuery), asyncHandler(async (_req: Request, res: Response) => {
    const { departmentId, start, end } = res.locals.query;
    const report = await service.analyze(departmentId, start, end);
    res.json({ success: true, data: report });
  }));

  return router;
};
