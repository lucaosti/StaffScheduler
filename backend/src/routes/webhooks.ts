/**
 * Outbound webhook subscription routes (#315).
 *
 *   GET    /api/webhooks                       list the caller's organization's subscriptions
 *   POST   /api/webhooks                       create one — returns the raw HMAC secret once
 *   PUT    /api/webhooks/:id                   update url/eventTypes/isActive
 *   DELETE /api/webhooks/:id                   delete
 *   GET    /api/webhooks/:id/deliveries        delivery log (?limit=)
 *
 * Gated on `settings.manage`: a webhook subscription is organization-wide
 * configuration, the same tier as module toggles and system settings, not a
 * per-department or per-user concern.
 *
 * Scoped to the caller's OWN `organization_name` throughout — never accepted
 * from the request body, so a caller cannot create or read another
 * organization's subscriptions by guessing an id.
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { Router, Request, Response } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { validateParams, validateBody, validateQuery } from '../middleware/validation';
import { idParam, createWebhookSubscriptionBody, updateWebhookSubscriptionBody, webhookDeliveriesQuery } from '../schemas';
import { WebhookService } from '../services/WebhookService';
import { NotFoundError, ForbiddenError, ValidationError } from '../errors';

export const createWebhooksRouter = (pool: Pool): Router => {
  const router = Router();
  const service = new WebhookService(pool);

  router.use(authenticate, requirePermission('settings.manage'));

  const requireOrganization = (req: Request): string => {
    const organizationName = req.user?.organizationName;
    if (!organizationName) {
      throw new ValidationError('Your account has no organization to scope webhooks to');
    }
    return organizationName;
  };

  /** Refuses cross-organization access to a subscription id in the path. */
  const loadOwnSubscription = async (req: Request, id: number) => {
    const subscription = await service.getById(id);
    if (!subscription) throw new NotFoundError('Webhook subscription not found');
    if (subscription.organizationName !== requireOrganization(req)) {
      throw new ForbiddenError('Forbidden');
    }
    return subscription;
  };

  router.get('/', async (req: Request, res: Response) => {
    const list = await service.listForOrganization(requireOrganization(req));
    res.json({ success: true, data: list });
  });

  router.post('/', validateBody(createWebhookSubscriptionBody), async (req: Request, res: Response) => {
    const { subscription, secret } = await service.create(
      requireOrganization(req),
      res.locals.body,
      req.user!.id
    );
    res.status(201).json({ success: true, data: { ...subscription, secret } });
  });

  router.put(
    '/:id',
    validateParams(idParam),
    validateBody(updateWebhookSubscriptionBody),
    async (req: Request, res: Response) => {
      await loadOwnSubscription(req, res.locals.params.id);
      const updated = await service.update(res.locals.params.id, res.locals.body);
      res.json({ success: true, data: updated });
    }
  );

  router.delete('/:id', validateParams(idParam), async (req: Request, res: Response) => {
    await loadOwnSubscription(req, res.locals.params.id);
    await service.delete(res.locals.params.id);
    res.json({ success: true, data: { message: 'Webhook subscription deleted' } });
  });

  router.get(
    '/:id/deliveries',
    validateParams(idParam),
    validateQuery(webhookDeliveriesQuery),
    async (req: Request, res: Response) => {
      await loadOwnSubscription(req, res.locals.params.id);
      const deliveries = await service.listDeliveries(res.locals.params.id, res.locals.query.limit);
      res.json({ success: true, data: deliveries });
    }
  );

  return router;
};
