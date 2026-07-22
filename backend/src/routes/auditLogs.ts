/**
 * Audit log routes (F10). Manager-only.
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { Router, Request, Response } from 'express';
import { authenticate, requirePermission, requireModuleForUser } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateParams, validateQuery } from '../middleware/validation';
import { idParam, auditLogListQuery, auditLogExportQuery } from '../schemas';
import { AuditLogService, AuditLogFilters } from '../services/AuditLogService';

export const createAuditLogsRouter = (pool: Pool): Router => {
  const router = Router();
  const service = new AuditLogService(pool);

  router.use(authenticate, requireModuleForUser('audit'), requirePermission('audit.read'));

  router.get('/', validateQuery(auditLogListQuery), asyncHandler(async (_req: Request, res: Response) => {
    // Both the legacy ?limit/offset pairing and the ?page/pageSize convention
    // are accepted; page/pageSize wins when both are supplied.
    const { page: rawPage, pageSize: rawSize, limit: rawLimit, offset: rawOffset, ...filters } = res.locals.query;
    const limit = rawSize ?? rawLimit;
    const offset = rawPage != null && rawSize != null ? (rawPage - 1) * rawSize : rawOffset;

    const result = await service.list({ ...filters, limit, offset });

    if (rawPage != null && rawSize != null) {
      const pageSize = rawSize;
      res.json({
        success: true,
        data: result.items,
        meta: {
          total: result.total,
          page: rawPage,
          pageSize,
          pages: Math.ceil(result.total / pageSize),
        },
      });
    } else {
      res.json({ success: true, data: result });
    }
  }));

  // /export must be registered before /:id to prevent Express from matching
  // the literal string "export" as a numeric ID parameter.
  router.get('/export', validateQuery(auditLogExportQuery), asyncHandler(async (_req: Request, res: Response) => {
    const { format = 'json', ...rest } = res.locals.query;
    const filters: Omit<AuditLogFilters, 'limit' | 'offset'> = rest;

    const entries = await service.exportAll(filters);

    if (format === 'csv') {
      const csv = AuditLogService.toCsv(entries);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="audit_log_export.csv"');
      return res.send(csv);
    }

    res.json({ success: true, data: entries, meta: { total: entries.length } });
  }));

  router.get('/:id', validateParams(idParam), asyncHandler(async (_req: Request, res: Response) => {
    const id = res.locals.params.id;
    const item = await service.getById(id);
    if (!item) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Audit log entry not found' } });
    }
    res.json({ success: true, data: item });
  }));

  return router;
};
