/**
 * Third-party integrations — `/api/integrations`.
 *
 * Payroll export is the first capability behind this module flag (seeded
 * since the initial schema, unwired until now). `requireModuleForUser`
 * reads the caller's own organization (for a per-org override), so it runs
 * AFTER `authenticate`, same ordering as `attendance.ts`'s use of it — a
 * deployment with the module off returns 404 rather than 403 for anyone
 * already authenticated, matching the plain `requireModule`'s "invisible,
 * not merely refused" contract for every caller who gets that far.
 *
 * Triggering an export only ever creates a `payroll_export_jobs` row;
 * `PayrollExportWorker` is what actually calls the provider, asynchronously,
 * with retry — the route never blocks on an outbound HTTP call.
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { Router, Request, Response } from 'express';
import { authenticate, requirePermission, requireModuleForUser } from '../middleware/auth';
import { validateBody, validateParams } from '../middleware/validation';
import { createPayrollExportBody, idParam } from '../schemas';
import { PayrollExportService } from '../services/PayrollExportService';
import { NotFoundError } from '../errors';

export const createIntegrationsRouter = (pool: Pool): Router => {
  const router = Router();
  const exports_ = new PayrollExportService(pool);

  router.use(authenticate, requireModuleForUser('integrations'), requirePermission('payroll.manage'));

  router.get('/payroll/export', async (_req: Request, res: Response) => {
    res.json({ success: true, data: await exports_.list() });
  });

  router.get('/payroll/export/:id', validateParams(idParam), async (_req: Request, res: Response) => {
    const job = await exports_.getById(res.locals.params.id);
    if (!job) throw new NotFoundError('Payroll export job not found');
    res.json({ success: true, data: job });
  });

  router.post('/payroll/export', validateBody(createPayrollExportBody), async (req: Request, res: Response) => {
    const { startDate, endDate, provider } = res.locals.body;
    const job = await exports_.createJob(provider ?? 'gusto', startDate, endDate, req.user!.id);
    res.status(202).json({ success: true, data: job, message: 'Payroll export queued' });
  });

  return router;
};
