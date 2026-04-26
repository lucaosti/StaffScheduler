/**
 * Bulk import routes (F16). Manager only.
 *
 *   POST /api/import/employees  body: { csv: string, defaultPassword?: string }
 *   POST /api/import/shifts     body: { csv: string }
 *
 * Body is plain JSON with the CSV text inside (multipart upload would add
 * dependency surface for marginal benefit at this scope).
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { Router, Request, Response } from 'express';
import { authenticate, requireManager } from '../middleware/auth';
import { BulkImportService } from '../services/BulkImportService';

const respondError = (res: Response, status: number, code: string, message: string): void => {
  res.status(status).json({ success: false, error: { code, message } });
};

export const createBulkImportRouter = (pool: Pool): Router => {
  const router = Router();
  const service = new BulkImportService(pool);

  router.use(authenticate, requireManager);

  router.post('/employees', async (req: Request, res: Response) => {
    const csv = req.body?.csv as string | undefined;
    const password = (req.body?.defaultPassword as string | undefined) || 'ChangeMe1!';
    if (!csv) {
      return respondError(res, 400, 'VALIDATION_ERROR', 'csv body is required');
    }
    try {
      const result = await service.importEmployees(csv, password);
      const status = result.errors.length > 0 ? 400 : 200;
      res.status(status).json({ success: result.errors.length === 0, data: result });
    } catch (err) {
      respondError(res, 500, 'IMPORT_FAILED', (err as Error).message);
    }
  });

  router.post('/shifts', async (req: Request, res: Response) => {
    const csv = req.body?.csv as string | undefined;
    if (!csv) {
      return respondError(res, 400, 'VALIDATION_ERROR', 'csv body is required');
    }
    try {
      const result = await service.importShifts(csv);
      const status = result.errors.length > 0 ? 400 : 200;
      res.status(status).json({ success: result.errors.length === 0, data: result });
    } catch (err) {
      respondError(res, 500, 'IMPORT_FAILED', (err as Error).message);
    }
  });

  return router;
};
