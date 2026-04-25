/**
 * Reports routes (F08). Manager only.
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { Router, Request, Response } from 'express';
import { authenticate, requireManager } from '../middleware/auth';
import { ReportsService } from '../services/ReportsService';

const respondError = (res: Response, status: number, code: string, message: string): void => {
  res.status(status).json({ success: false, error: { code, message } });
};

export const createReportsRouter = (pool: Pool): Router => {
  const router = Router();
  const service = new ReportsService(pool);

  router.use(authenticate, requireManager);

  router.get('/hours-worked', async (req: Request, res: Response) => {
    const start = req.query.start as string | undefined;
    const end = req.query.end as string | undefined;
    if (!start || !end) {
      return respondError(res, 400, 'VALIDATION_ERROR', 'start and end are required');
    }
    const departmentId = req.query.departmentId ? Number(req.query.departmentId) : undefined;
    const data = await service.hoursWorkedByUser(start, end, departmentId);
    res.json({ success: true, data });
  });

  router.get('/cost-by-department', async (req: Request, res: Response) => {
    const start = req.query.start as string | undefined;
    const end = req.query.end as string | undefined;
    if (!start || !end) {
      return respondError(res, 400, 'VALIDATION_ERROR', 'start and end are required');
    }
    const data = await service.costByDepartment(start, end);
    res.json({ success: true, data });
  });

  router.get('/fairness/:scheduleId', async (req: Request, res: Response) => {
    const data = await service.fairnessForSchedule(Number(req.params.scheduleId));
    res.json({ success: true, data });
  });

  return router;
};
