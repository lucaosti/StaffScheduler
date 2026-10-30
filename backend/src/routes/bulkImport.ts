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
 * WHY EACH IMPORT HAS ITS OWN PERMISSION. Both used to sit behind
 * `employee.manage`, so anyone who could manage staff could also create
 * shifts — in any schedule, since the CSV's schedule and department ids were
 * inserted unchecked. A shift import is shift creation and needs what
 * `POST /shifts` needs: `shift.manage`, and every row's schedule and
 * department inside the importer's scope (404 otherwise, checked for the whole
 * file before anything is written, like the rest of this all-or-nothing import).
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

  router.use(authenticate);

  router.post('/employees', requirePermission('employee.manage'), validateBody(bulkImportEmployeesBody), async (req: Request, res: Response) => {
    const { csv, defaultPassword } = res.locals.body as { csv: string; defaultPassword: string };
    const result = await service.importEmployees(csv, defaultPassword, req.user!);
    const status = result.errors.length > 0 ? 400 : 200;
    res.status(status).json({ success: result.errors.length === 0, data: result });
  });

  router.post('/shifts', requirePermission('shift.manage'), validateBody(bulkImportShiftsBody), async (req: Request, res: Response) => {
    const { csv } = res.locals.body as { csv: string };
    const result = await service.importShifts(csv, req.user!);
    const status = result.errors.length > 0 ? 400 : 200;
    res.status(status).json({ success: result.errors.length === 0, data: result });
  });

  return router;
};
