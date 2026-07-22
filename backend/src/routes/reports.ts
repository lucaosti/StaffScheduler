/**
 * Reports routes (F08). Manager only.
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { Router, Request, Response } from 'express';
import { authenticate, requirePermission, requireModuleForUser } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateParams, validateQuery } from '../middleware/validation';
import { scheduleIdParam, reportRangeQuery } from '../schemas';
import { ReportsService } from '../services/ReportsService';

const respondError = (res: Response, status: number, code: string, message: string): void => {
  res.status(status).json({ success: false, error: { code, message } });
};


export const createReportsRouter = (pool: Pool): Router => {
  const router = Router();
  const service = new ReportsService(pool);

  router.use(authenticate, requireModuleForUser('reporting'), requirePermission('report.read'));

  // The spec published startDate/endDate while the code read start/end, so a
  // client following the documentation got a 400. Both names are accepted; the
  // documented pair wins.
  router.get('/hours-worked', validateQuery(reportRangeQuery), asyncHandler(async (_req: Request, res: Response) => {
    const { startDate, endDate, start: startAlias, end: endAlias, departmentId } = res.locals.query;
    const start = startDate ?? startAlias;
    const end = endDate ?? endAlias;
    if (!start || !end) {
      return respondError(res, 400, 'VALIDATION_ERROR', 'startDate and endDate are required');
    }
    const data = await service.hoursWorkedByUser(start, end, departmentId);
    res.json({ success: true, data });
  }));

  router.get('/cost-by-department', validateQuery(reportRangeQuery), asyncHandler(async (_req: Request, res: Response) => {
    const { startDate, endDate, start: startAlias, end: endAlias } = res.locals.query;
    const start = startDate ?? startAlias;
    const end = endDate ?? endAlias;
    if (!start || !end) {
      return respondError(res, 400, 'VALIDATION_ERROR', 'startDate and endDate are required');
    }
    const data = await service.costByDepartment(start, end);
    res.json({ success: true, data });
  }));

  router.get('/fairness/:scheduleId', validateParams(scheduleIdParam), asyncHandler(async (_req: Request, res: Response) => {
    const data = await service.fairnessForSchedule(res.locals.params.scheduleId);
    res.json({ success: true, data });
  }));

  return router;
};
