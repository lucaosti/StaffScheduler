/**
 * Audit log routes (F10). Manager-only.
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { Router, Request, Response } from 'express';
import { authenticate, requirePermission, requireModule } from '../middleware/auth';
import { AuditLogService } from '../services/AuditLogService';

export const createAuditLogsRouter = (pool: Pool): Router => {
  const router = Router();
  const service = new AuditLogService(pool);

  router.use(requireModule('audit'), authenticate, requirePermission('audit.read'));

  router.get('/', async (req: Request, res: Response) => {
    // Support both legacy ?limit/offset and the new ?page/pageSize convention.
    const rawPage = req.query.page ? Number(req.query.page) : null;
    const rawSize = req.query.pageSize ? Number(req.query.pageSize) : null;
    const limit = rawSize ?? (req.query.limit ? Number(req.query.limit) : undefined);
    const offset = rawPage != null && rawSize != null
      ? (rawPage - 1) * rawSize
      : (req.query.offset ? Number(req.query.offset) : undefined);

    const result = await service.list({
      userId: req.query.userId ? Number(req.query.userId) : undefined,
      action: req.query.action as string | undefined,
      entityType: req.query.entityType as string | undefined,
      entityId: req.query.entityId ? Number(req.query.entityId) : undefined,
      fromDate: req.query.fromDate as string | undefined,
      toDate: req.query.toDate as string | undefined,
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
  });

  router.get('/:id', async (req: Request, res: Response) => {
    const item = await service.getById(Number(req.params.id));
    if (!item) {
      res
        .status(404)
        .json({ success: false, error: { code: 'NOT_FOUND', message: 'Audit log entry not found' } });
      return;
    }
    res.json({ success: true, data: item });
  });

  return router;
};
