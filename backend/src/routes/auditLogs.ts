/**
 * Audit log routes (F10). Manager-only.
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { Router, Request, Response } from 'express';
import { authenticate, requireManager } from '../middleware/auth';
import { AuditLogService } from '../services/AuditLogService';

export const createAuditLogsRouter = (pool: Pool): Router => {
  const router = Router();
  const service = new AuditLogService(pool);

  router.use(authenticate, requireManager);

  router.get('/', async (req: Request, res: Response) => {
    const page = await service.list({
      userId: req.query.userId ? Number(req.query.userId) : undefined,
      action: req.query.action as string | undefined,
      entityType: req.query.entityType as string | undefined,
      entityId: req.query.entityId ? Number(req.query.entityId) : undefined,
      fromDate: req.query.fromDate as string | undefined,
      toDate: req.query.toDate as string | undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    });
    res.json({ success: true, data: page });
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
