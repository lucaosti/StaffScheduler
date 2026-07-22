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
import { authenticate, requireModuleForUser } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateParams, validateQuery } from '../middleware/validation';
import { idParam, notificationListQuery } from '../schemas';
import { NotificationService } from '../services/NotificationService';

export const createNotificationsRouter = (pool: Pool): Router => {
  const router = Router();
  const service = new NotificationService(pool);

  router.use(authenticate);
  router.use(requireModuleForUser('notifications'));

  router.get('/', validateQuery(notificationListQuery), asyncHandler(async (req: Request, res: Response) => {
    const { unreadOnly, limit } = res.locals.query;
    const list = await service.listForUser(req.user!.id, {
      unreadOnly: unreadOnly === '1',
      limit,
    });
    res.json({ success: true, data: list });
  }));

  router.get('/unread-count', asyncHandler(async (req: Request, res: Response) => {
    const count = await service.unreadCount(req.user!.id);
    res.json({ success: true, data: { count } });
  }));

  router.patch('/:id/read', validateParams(idParam), asyncHandler(async (req: Request, res: Response) => {
    const ok = await service.markRead(res.locals.params.id, req.user!.id);
    if (!ok) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Notification not found or already read' },
      });
      return;
    }
    res.json({ success: true });
  }));

  router.patch('/read-all', asyncHandler(async (req: Request, res: Response) => {
    const updated = await service.markAllRead(req.user!.id);
    res.json({ success: true, data: { updated } });
  }));

  return router;
};
