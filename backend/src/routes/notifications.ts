/**
 * Notifications routes (F03).
 *
 *   GET    /api/notifications                     list own (?unreadOnly=1)
 *   GET    /api/notifications/unread-count        small payload for badges
 *   PATCH  /api/notifications/:id/read            mark one as read
 *   PATCH  /api/notifications/read-all            mark every own notification as read
 *   GET    /api/notifications/push/public-key     the VAPID public key clients subscribe against (#310)
 *   POST   /api/notifications/push/subscribe      register/reactivate a device's Web Push subscription
 *   DELETE /api/notifications/push/subscribe      deactivate a device's Web Push subscription
 *   POST   /api/notifications/push/device-token   register/reactivate a mobile client's native push device token
 *   DELETE /api/notifications/push/device-token   deactivate a mobile client's native push device token
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { Router, Request, Response } from 'express';
import { authenticate, requireModuleForUser } from '../middleware/auth';
import { validateParams, validateQuery, validateBody } from '../middleware/validation';
import {
  idParam,
  notificationListQuery,
  pushSubscribeBody,
  pushUnsubscribeBody,
  registerDeviceTokenBody,
  deactivateDeviceTokenBody,
} from '../schemas';
import { NotificationService } from '../services/NotificationService';
import { PushService, isPushConfigured } from '../services/PushService';
import { NativePushService } from '../services/NativePushService';
import { config } from '../config';

export const createNotificationsRouter = (pool: Pool): Router => {
  const router = Router();
  const service = new NotificationService(pool);
  const pushService = new PushService(pool);
  const nativePushService = new NativePushService(pool);

  router.use(authenticate);
  router.use(requireModuleForUser('notifications'));

  router.get('/', validateQuery(notificationListQuery), async (req: Request, res: Response) => {
    const { unreadOnly, limit } = res.locals.query;
    const list = await service.listForUser(req.user!.id, {
      unreadOnly: unreadOnly === '1',
      limit,
    });
    res.json({ success: true, data: list });
  });

  router.get('/unread-count', async (req: Request, res: Response) => {
    const count = await service.unreadCount(req.user!.id);
    res.json({ success: true, data: { count } });
  });

  router.patch('/:id/read', validateParams(idParam), async (req: Request, res: Response) => {
    const ok = await service.markRead(res.locals.params.id, req.user!.id);
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

  // Not gated on isPushConfigured: an unconfigured deployment answers with
  // `enabled: false` rather than 404, so the SPA can distinguish "the server
  // has no VAPID keys" from "this endpoint doesn't exist" and hide the
  // toggle accordingly instead of surfacing a broken feature.
  router.get('/push/public-key', (_req: Request, res: Response) => {
    res.json({
      success: true,
      data: { enabled: isPushConfigured(), publicKey: config.webPush.vapidPublicKey ?? null },
    });
  });

  router.post('/push/subscribe', validateBody(pushSubscribeBody), async (req: Request, res: Response) => {
    const subscription = await pushService.subscribe(req.user!.id, res.locals.body);
    res.status(201).json({ success: true, data: subscription });
  });

  router.delete('/push/subscribe', validateBody(pushUnsubscribeBody), async (req: Request, res: Response) => {
    await pushService.unsubscribe(req.user!.id, res.locals.body.endpoint);
    res.json({ success: true, data: { message: 'Push subscription deactivated' } });
  });

  // Native (Capacitor) mobile push — a separate transport from Web Push
  // above, registered by the mobile client once it has a device token from
  // `@capacitor/push-notifications`. See NativePushService.ts.
  router.post(
    '/push/device-token',
    validateBody(registerDeviceTokenBody),
    async (req: Request, res: Response) => {
      const { platform, token } = res.locals.body;
      const deviceToken = await nativePushService.registerToken(req.user!.id, platform, token);
      res.status(201).json({ success: true, data: deviceToken });
    }
  );

  router.delete(
    '/push/device-token',
    validateBody(deactivateDeviceTokenBody),
    async (req: Request, res: Response) => {
      await nativePushService.deactivateToken(req.user!.id, res.locals.body.token);
      res.json({ success: true, data: { message: 'Device push token deactivated' } });
    }
  );

  return router;
};
