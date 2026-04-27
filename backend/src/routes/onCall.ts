/**
 * On-call routes (F21).
 *
 *   GET    /api/on-call/periods              list (filters)
 *   POST   /api/on-call/periods              create  (manager)
 *   GET    /api/on-call/periods/:id          read
 *   PUT    /api/on-call/periods/:id          update  (manager)
 *   DELETE /api/on-call/periods/:id          delete  (manager)
 *   GET    /api/on-call/periods/:id/assignments
 *   POST   /api/on-call/periods/:id/assign   manager assigns user
 *   DELETE /api/on-call/periods/:id/assign/:userId
 *   GET    /api/on-call/me                   own on-call schedule
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { Router, Request, Response } from 'express';
import { authenticate, requireManager } from '../middleware/auth';
import { OnCallService } from '../services/OnCallService';

const error = (res: Response, status: number, code: string, message: string): void => {
  res.status(status).json({ success: false, error: { code, message } });
};

export const createOnCallRouter = (pool: Pool): Router => {
  const router = Router();
  const service = new OnCallService(pool);

  router.use(authenticate);

  router.get('/me', async (req: Request, res: Response) => {
    const data = await service.listForUser(req.user!.id, {
      rangeStart: req.query.start as string | undefined,
      rangeEnd: req.query.end as string | undefined,
    });
    res.json({ success: true, data });
  });

  router.get('/periods', async (req: Request, res: Response) => {
    const data = await service.listPeriods({
      departmentId: req.query.departmentId ? Number(req.query.departmentId) : undefined,
      status: req.query.status as never,
      rangeStart: req.query.start as string | undefined,
      rangeEnd: req.query.end as string | undefined,
    });
    res.json({ success: true, data });
  });

  router.post('/periods', requireManager, async (req: Request, res: Response) => {
    try {
      const created = await service.createPeriod(req.body || {});
      res.status(201).json({ success: true, data: created });
    } catch (err) {
      error(res, 400, 'VALIDATION_ERROR', (err as Error).message);
    }
  });

  router.get('/periods/:id', async (req: Request, res: Response) => {
    const period = await service.getPeriodById(Number(req.params.id));
    if (!period) return error(res, 404, 'NOT_FOUND', 'On-call period not found');
    res.json({ success: true, data: period });
  });

  router.put('/periods/:id', requireManager, async (req: Request, res: Response) => {
    try {
      const updated = await service.updatePeriod(Number(req.params.id), req.body || {});
      res.json({ success: true, data: updated });
    } catch (err) {
      const msg = (err as Error).message;
      const status = msg.includes('not found') ? 404 : 400;
      error(res, status, status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR', msg);
    }
  });

  router.delete('/periods/:id', requireManager, async (req: Request, res: Response) => {
    try {
      await service.deletePeriod(Number(req.params.id));
      res.json({ success: true });
    } catch (err) {
      error(res, 404, 'NOT_FOUND', (err as Error).message);
    }
  });

  router.get('/periods/:id/assignments', async (req: Request, res: Response) => {
    const data = await service.listAssignments(Number(req.params.id));
    res.json({ success: true, data });
  });

  router.post('/periods/:id/assign', requireManager, async (req: Request, res: Response) => {
    try {
      const data = await service.assign(
        Number(req.params.id),
        Number(req.body?.userId),
        req.user!.id,
        req.body?.notes ?? null
      );
      res.json({ success: true, data });
    } catch (err) {
      const msg = (err as Error).message;
      const status = msg.includes('not found') ? 404 : msg.includes('max capacity') ? 409 : 400;
      const code = status === 404 ? 'NOT_FOUND' : status === 409 ? 'CONFLICT' : 'VALIDATION_ERROR';
      error(res, status, code, msg);
    }
  });

  router.delete('/periods/:id/assign/:userId', requireManager, async (req: Request, res: Response) => {
    const ok = await service.unassign(Number(req.params.id), Number(req.params.userId));
    if (!ok) return error(res, 404, 'NOT_FOUND', 'Assignment not found');
    res.json({ success: true });
  });

  return router;
};
