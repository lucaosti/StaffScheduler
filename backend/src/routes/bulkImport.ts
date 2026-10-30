/**
 * Bulk import routes (F16). Manager only.
 *
 *   POST /api/import/employees  body: { csv: string, defaultPassword: string }
 *   POST /api/import/shifts     body: { csv: string }
 *
 * Body is plain JSON with the CSV text inside (multipart upload would add
 * dependency surface for marginal benefit at this scope).
 *
 * No try/catch: per-row problems are part of the result (400 with `errors`),
 * a typed refusal (e.g. a role grant the actor may not make → 403) renders
 * with its own status, and anything else is an internal fault for the
 * central errorHandler (generic 500 + request id). The previous catch-all
 * answered `500 IMPORT_FAILED` with the thrown message, which put raw driver
 * text in front of the user (#895).
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { Router, Request, Response } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { validateBody } from '../middleware/validation';
import { bulkImportEmployeesBody, bulkImportShiftsBody } from '../schemas';
import { BulkImportService } from '../services/BulkImportService';

export const createBulkImportRouter = (pool: Pool): Router => {
  const router = Router();
  const service = new BulkImportService(pool);

  router.use(authenticate, requirePermission('employee.manage'));

  router.post('/employees', validateBody(bulkImportEmployeesBody), async (req: Request, res: Response) => {
    const { csv, defaultPassword } = res.locals.body as { csv: string; defaultPassword: string };
    const result = await service.importEmployees(csv, defaultPassword, req.user!);
    const status = result.errors.length > 0 ? 400 : 200;
    res.status(status).json({ success: result.errors.length === 0, data: result });
  });

  router.post('/shifts', validateBody(bulkImportShiftsBody), async (_req: Request, res: Response) => {
    const { csv } = res.locals.body as { csv: string };
    const result = await service.importShifts(csv);
    const status = result.errors.length > 0 ? 400 : 200;
    res.status(status).json({ success: result.errors.length === 0, data: result });
  });

  return router;
};
