/**
 * Audit log routes (F10). Manager-only.
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { Router, Request, Response } from 'express';
import { authenticate, requirePermission, requireModuleForUser } from '../middleware/auth';
import { validateParams } from '../middleware/validation';
import { idParam } from '../schemas';
import { AuditLogService, AuditLogFilters } from '../services/AuditLogService';
import { logger } from '../config/logger';

export const createAuditLogsRouter = (pool: Pool): Router => {
  const router = Router();
  const service = new AuditLogService(pool);

  router.use(authenticate, requireModuleForUser('audit'), requirePermission('audit.read'));

  router.get('/', async (req: Request, res: Response) => {
    try {
      // Support both legacy ?limit/offset and the new ?page/pageSize convention.
      const rawPage = req.query.page ? Number(req.query.page) : null;
      const rawSize = req.query.pageSize ? Number(req.query.pageSize) : null;
      const limit = rawSize ?? (req.query.limit ? Number(req.query.limit) : undefined);
      const offset = rawPage != null && rawSize != null
        ? (rawPage - 1) * rawSize
        : (req.query.offset ? Number(req.query.offset) : undefined);

      const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
      const rawFromDate = req.query.fromDate as string | undefined;
      const rawToDate = req.query.toDate as string | undefined;
      if (rawFromDate && !ISO_DATE_RE.test(rawFromDate)) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'fromDate must be an ISO date (YYYY-MM-DD)' } });
      }
      if (rawToDate && !ISO_DATE_RE.test(rawToDate)) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'toDate must be an ISO date (YYYY-MM-DD)' } });
      }

      const result = await service.list({
        userId: req.query.userId ? Number(req.query.userId) : undefined,
        onBehalfOfUserId: req.query.onBehalfOfUserId ? Number(req.query.onBehalfOfUserId) : undefined,
        action: req.query.action as string | undefined,
        entityType: req.query.entityType as string | undefined,
        entityId: req.query.entityId ? Number(req.query.entityId) : undefined,
        fromDate: rawFromDate,
        toDate: rawToDate,
        requestId: req.query.requestId as string | undefined,
        limit,
        offset,
      });

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
    } catch (error) {
      logger.error('List audit logs error:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to list audit logs' } });
    }
  });

  // /export must be registered before /:id to prevent Express from matching
  // the literal string "export" as a numeric ID parameter.
  router.get('/export', async (req: Request, res: Response) => {
    try {
      const format = (req.query.format as string | undefined)?.toLowerCase() ?? 'json';
      if (format !== 'csv' && format !== 'json') {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'format must be csv or json' } });
      }

      const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
      const rawFromDate = req.query.fromDate as string | undefined;
      const rawToDate = req.query.toDate as string | undefined;
      if (rawFromDate && !ISO_DATE_RE.test(rawFromDate)) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'fromDate must be YYYY-MM-DD' } });
      }
      if (rawToDate && !ISO_DATE_RE.test(rawToDate)) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'toDate must be YYYY-MM-DD' } });
      }

      const filters: Omit<AuditLogFilters, 'limit' | 'offset'> = {
        userId: req.query.userId ? Number(req.query.userId) : undefined,
        onBehalfOfUserId: req.query.onBehalfOfUserId ? Number(req.query.onBehalfOfUserId) : undefined,
        action: req.query.action as string | undefined,
        entityType: req.query.entityType as string | undefined,
        entityId: req.query.entityId ? Number(req.query.entityId) : undefined,
        fromDate: rawFromDate,
        toDate: rawToDate,
        requestId: req.query.requestId as string | undefined,
      };

      const entries = await service.exportAll(filters);

      if (format === 'csv') {
        const csv = AuditLogService.toCsv(entries);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="audit_log_export.csv"');
        return res.send(csv);
      }

      res.json({ success: true, data: entries, meta: { total: entries.length } });
    } catch (error) {
      logger.error('Audit log export error:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to export audit logs' } });
    }
  });

  router.get('/:id', validateParams(idParam), async (_req: Request, res: Response) => {
    try {
      const id = res.locals.params.id;
      const item = await service.getById(id);
      if (!item) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Audit log entry not found' } });
      }
      res.json({ success: true, data: item });
    } catch (error) {
      logger.error('Get audit log error:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve audit log entry' } });
    }
  });

  return router;
};
