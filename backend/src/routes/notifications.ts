/**
 * Notifications routes (F03).
 *
 *   GET   /api/notifications                  list own (?unreadOnly=1)
 *   GET   /api/notifications/unread-count     small payload for badges
 *   PATCH /api/notifications/:id/read         mark one as read
 *   PATCH /api/notifications/read-all         mark every own notification as read
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { NotificationService } from '../services/NotificationService';

export const createNotificationsRouter = (pool: Pool): Router => {
  const router = Router();
  const service = new NotificationService(pool);

  router.use(authenticate);

  router.get('/', async (req: Request, res: Response) => {
    const list = await service.listForUser(req.user!.id, {
      unreadOnly: req.query.unreadOnly === '1',
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json({ success: true, data: list });
  });

  router.get('/unread-count', async (req: Request, res: Response) => {
    const count = await service.unreadCount(req.user!.id);
    res.json({ success: true, data: { count } });
  });

  router.patch('/:id/read', async (req: Request, res: Response) => {
    const ok = await service.markRead(Number(req.params.id), req.user!.id);
    if (!ok) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Notification not found or already read' },
      });
      return;
    }
    res.json({ success: true });
  });

  router.patch('/read-all', async (req: Request, res: Response) => {
    const updated = await service.markAllRead(req.user!.id);
    res.json({ success: true, data: { updated } });
  });

  return router;
};
