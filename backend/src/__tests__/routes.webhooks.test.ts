/**
 * Route handler tests for `routes/webhooks.ts`.
 *
 * @author Luca Ostinelli
 */

import request from 'supertest';

let currentUser: { id: number; organizationName: string | null; permissions: string[] } = {
  id: 1,
  organizationName: 'Acme',
  permissions: ['settings.manage'],
};

jest.mock('../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { ...currentUser, isActive: true };
    next();
  },
  requirePermission: (code: string) => (req: any, res: any, next: any) => {
    if (!req.user?.permissions?.includes(code)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    next();
  },
  userHasPermission: (user: any, code: string) => Boolean(user?.permissions?.includes(code)),
}));

jest.mock('../services/WebhookService');

import { WebhookService } from '../services/WebhookService';
import { createWebhooksRouter } from '../routes/webhooks';
import { mountRouter } from './helpers/mountRouter';

const fakePool = {} as never;
const app = () => mountRouter('/api/webhooks', createWebhooksRouter(fakePool));

const subscription = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  organizationName: 'Acme',
  url: 'https://example.com/hook',
  eventTypes: ['schedule.published'],
  isActive: true,
  createdAt: 'x',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  currentUser = { id: 1, organizationName: 'Acme', permissions: ['settings.manage'] };
});

describe('webhooks router', () => {
  it('requires settings.manage', async () => {
    currentUser = { id: 1, organizationName: 'Acme', permissions: [] };
    const res = await request(app()).get('/api/webhooks');
    expect(res.status).toBe(403);
  });

  describe('GET /', () => {
    it('lists the caller organization\'s subscriptions', async () => {
      (WebhookService.prototype.listForOrganization as jest.Mock) = jest.fn().mockResolvedValue([subscription()]);
      const res = await request(app()).get('/api/webhooks');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([subscription()]);
      expect(WebhookService.prototype.listForOrganization).toHaveBeenCalledWith('Acme');
    });

    it('400s when the caller has no organization', async () => {
      currentUser = { id: 1, organizationName: null, permissions: ['settings.manage'] };
      const res = await request(app()).get('/api/webhooks');
      expect(res.status).toBe(400);
    });
  });

  describe('POST /', () => {
    it('creates a subscription and returns the raw secret', async () => {
      (WebhookService.prototype.create as jest.Mock) = jest
        .fn()
        .mockResolvedValue({ subscription: subscription(), secret: 'raw-secret-value' });
      const res = await request(app())
        .post('/api/webhooks')
        .send({ url: 'https://example.com/hook', eventTypes: ['schedule.published'] });
      expect(res.status).toBe(201);
      expect(res.body.data).toEqual({ ...subscription(), secret: 'raw-secret-value' });
      expect(WebhookService.prototype.create).toHaveBeenCalledWith(
        'Acme',
        { url: 'https://example.com/hook', eventTypes: ['schedule.published'] },
        1
      );
    });

    it('400s on an invalid URL', async () => {
      const res = await request(app())
        .post('/api/webhooks')
        .send({ url: 'not-a-url', eventTypes: ['schedule.published'] });
      expect(res.status).toBe(400);
    });

    it('400s on an unknown event type', async () => {
      const res = await request(app())
        .post('/api/webhooks')
        .send({ url: 'https://example.com/hook', eventTypes: ['not.a.real.event'] });
      expect(res.status).toBe(400);
    });

    it('400s on an empty eventTypes array', async () => {
      const res = await request(app())
        .post('/api/webhooks')
        .send({ url: 'https://example.com/hook', eventTypes: [] });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /:id', () => {
    it('updates a subscription belonging to the caller\'s organization', async () => {
      (WebhookService.prototype.getById as jest.Mock) = jest.fn().mockResolvedValue(subscription());
      (WebhookService.prototype.update as jest.Mock) = jest
        .fn()
        .mockResolvedValue(subscription({ isActive: false }));
      const res = await request(app()).put('/api/webhooks/1').send({ isActive: false });
      expect(res.status).toBe(200);
      expect(res.body.data.isActive).toBe(false);
    });

    it('404s for an unknown subscription', async () => {
      (WebhookService.prototype.getById as jest.Mock) = jest.fn().mockResolvedValue(null);
      const res = await request(app()).put('/api/webhooks/999').send({ isActive: false });
      expect(res.status).toBe(404);
    });

    it('403s for a subscription belonging to a different organization', async () => {
      (WebhookService.prototype.getById as jest.Mock) = jest
        .fn()
        .mockResolvedValue(subscription({ organizationName: 'OtherCo' }));
      const res = await request(app()).put('/api/webhooks/1').send({ isActive: false });
      expect(res.status).toBe(403);
      expect(WebhookService.prototype.update).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /:id', () => {
    it('deletes a subscription belonging to the caller\'s organization', async () => {
      (WebhookService.prototype.getById as jest.Mock) = jest.fn().mockResolvedValue(subscription());
      (WebhookService.prototype.delete as jest.Mock) = jest.fn().mockResolvedValue(undefined);
      const res = await request(app()).delete('/api/webhooks/1');
      expect(res.status).toBe(200);
      expect(WebhookService.prototype.delete).toHaveBeenCalledWith(1);
    });

    it('403s for a subscription belonging to a different organization', async () => {
      (WebhookService.prototype.getById as jest.Mock) = jest
        .fn()
        .mockResolvedValue(subscription({ organizationName: 'OtherCo' }));
      const res = await request(app()).delete('/api/webhooks/1');
      expect(res.status).toBe(403);
    });
  });

  describe('GET /:id/deliveries', () => {
    it('returns the delivery log for a subscription belonging to the caller\'s organization', async () => {
      (WebhookService.prototype.getById as jest.Mock) = jest.fn().mockResolvedValue(subscription());
      (WebhookService.prototype.listDeliveries as jest.Mock) = jest
        .fn()
        .mockResolvedValue([{ id: 1, event_type: 'schedule.published', status: 'sent' }]);
      const res = await request(app()).get('/api/webhooks/1/deliveries?limit=10');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(WebhookService.prototype.listDeliveries).toHaveBeenCalledWith(1, 10);
    });

    it('404s for an unknown subscription', async () => {
      (WebhookService.prototype.getById as jest.Mock) = jest.fn().mockResolvedValue(null);
      const res = await request(app()).get('/api/webhooks/999/deliveries');
      expect(res.status).toBe(404);
    });
  });
});
