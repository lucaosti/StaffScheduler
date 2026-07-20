/**
 * Bulk import routes (F16). Manager only.
 *
 *   POST /api/import/employees  body: { csv: string, defaultPassword: string }
 *   POST /api/import/shifts     body: { csv: string }
 *
 * Body is plain JSON with the CSV text inside (multipart upload would add
 * dependency surface for marginal benefit at this scope).
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { Router, Request, Response } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateBody } from '../middleware/validation';
import { bulkImportEmployeesBody, bulkImportShiftsBody } from '../schemas';
import { BulkImportService } from '../services/BulkImportService';

const respondError = (res: Response, status: number, code: string, message: string): void => {
  res.status(status).json({ success: false, error: { code, message } });
};

export const createBulkImportRouter = (pool: Pool): Router => {
  const router = Router();
  const service = new BulkImportService(pool);

  router.use(authenticate, requirePermission('employee.manage'));

  router.post('/employees', validateBody(bulkImportEmployeesBody), asyncHandler(async (_req: Request, res: Response) => {
    const { csv, defaultPassword } = res.locals.body as { csv: string; defaultPassword: string };
    try {
      const result = await service.importEmployees(csv, defaultPassword);
      const status = result.errors.length > 0 ? 400 : 200;
      res.status(status).json({ success: result.errors.length === 0, data: result });
    } catch (err) {
      respondError(res, 500, 'IMPORT_FAILED', (err as Error).message);
    }
  }));

  router.post('/shifts', validateBody(bulkImportShiftsBody), asyncHandler(async (_req: Request, res: Response) => {
    const { csv } = res.locals.body as { csv: string };
    try {
      const result = await service.importShifts(csv);
      const status = result.errors.length > 0 ? 400 : 200;
      res.status(status).json({ success: result.errors.length === 0, data: result });
    } catch (err) {
      respondError(res, 500, 'IMPORT_FAILED', (err as Error).message);
    }
  }));

  return router;
};
