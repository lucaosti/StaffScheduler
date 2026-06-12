/**
 * Reports routes (F08). Manager only.
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { Router, Request, Response } from 'express';
import { authenticate, requirePermission, requireModule } from '../middleware/auth';
import { validateParams } from '../middleware/validation';
import { scheduleIdParam } from '../schemas';
import { ReportsService } from '../services/ReportsService';
import { logger } from '../config/logger';

const respondError = (res: Response, status: number, code: string, message: string): void => {
  res.status(status).json({ success: false, error: { code, message } });
};

export const createReportsRouter = (pool: Pool): Router => {
  const router = Router();
  const service = new ReportsService(pool);

  router.use(requireModule('reporting'), authenticate, requirePermission('report.read'));

  router.get('/hours-worked', async (req: Request, res: Response) => {
    try {
      const start = req.query.start as string | undefined;
      const end = req.query.end as string | undefined;
      if (!start || !end) {
        return respondError(res, 400, 'VALIDATION_ERROR', 'start and end are required');
      }
      const departmentId = req.query.departmentId ? Number(req.query.departmentId) : undefined;
      const data = await service.hoursWorkedByUser(start, end, departmentId);
      res.json({ success: true, data });
    } catch (err) {
      logger.error('reports error:', err);
      respondError(res, 500, 'INTERNAL_ERROR', 'Failed to generate report');
    }
  });

  router.get('/cost-by-department', async (req: Request, res: Response) => {
    try {
      const start = req.query.start as string | undefined;
      const end = req.query.end as string | undefined;
      if (!start || !end) {
        return respondError(res, 400, 'VALIDATION_ERROR', 'start and end are required');
      }
      const data = await service.costByDepartment(start, end);
      res.json({ success: true, data });
    } catch (err) {
      logger.error('reports error:', err);
      respondError(res, 500, 'INTERNAL_ERROR', 'Failed to generate report');
    }
  });

  router.get('/fairness/:scheduleId', validateParams(scheduleIdParam), async (_req: Request, res: Response) => {
    try {
      const data = await service.fairnessForSchedule(res.locals.params.scheduleId);
      res.json({ success: true, data });
    } catch (err) {
      logger.error('reports error:', err);
      respondError(res, 500, 'INTERNAL_ERROR', 'Failed to generate report');
    }
  });

  return router;
};
