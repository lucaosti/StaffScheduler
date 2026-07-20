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

export const createSkillGapRouter = (pool: Pool): Router => {
  const router = Router();
  const service = new SkillGapService(pool);

  router.use(authenticate, requirePermission('report.read'));

  const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  router.get('/', asyncHandler(async (req: Request, res: Response) => {
    const departmentId = Number(req.query.departmentId);
    const start = req.query.start as string | undefined;
    const end = req.query.end as string | undefined;
    if (!departmentId || !start || !end) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'departmentId, start, end are required' },
      });
      return;
    }
    if (!ISO_DATE_RE.test(start) || !ISO_DATE_RE.test(end)) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'start and end must be ISO dates (YYYY-MM-DD)' },
      });
      return;
    }
    const report = await service.analyze(departmentId, start, end);
    res.json({ success: true, data: report });
  }));

  return router;
};
