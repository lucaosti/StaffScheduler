/**
 * SSO provider configuration — `/api/sso/providers`.
 *
 * Gated on `settings.manage`: an identity-provider registration is a
 * system-level security setting (it decides who may authenticate as whom),
 * the same class of action that permission already covers for the rest of
 * this application's configuration.
 *
 * The actual login/callback flow lives in `routes/authSso.ts`, which shares
 * the session-cookie issuance (`routes/authSession.ts`) with the
 * password-login flow in `routes/auth.ts` — this router is administration
 * only.
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { Router, Request, Response } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { validateBody, validateParams } from '../middleware/validation';
import { createSsoProviderBody, updateSsoProviderBody, idParam } from '../schemas';
import { SsoProviderService } from '../services/SsoProviderService';

export const createSsoRouter = (pool: Pool): Router => {
  const router = Router();
  const providers = new SsoProviderService(pool);

  router.use(authenticate, requirePermission('settings.manage'));

  router.get('/providers', async (_req: Request, res: Response) => {
    res.json({ success: true, data: await providers.list() });
  });

  router.get('/providers/:id', validateParams(idParam), async (_req: Request, res: Response) => {
    const provider = await providers.getById(res.locals.params.id);
    if (!provider) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'SSO provider not found' } });
    }
    res.json({ success: true, data: provider });
  });

  router.post('/providers', validateBody(createSsoProviderBody), async (_req: Request, res: Response) => {
    const created = await providers.create(res.locals.body);
    res.status(201).json({ success: true, data: created, message: 'SSO provider created' });
  });

  router.put('/providers/:id', validateParams(idParam), validateBody(updateSsoProviderBody), async (_req: Request, res: Response) => {
    const updated = await providers.update(res.locals.params.id, res.locals.body);
    res.json({ success: true, data: updated, message: 'SSO provider updated' });
  });

  router.delete('/providers/:id', validateParams(idParam), async (_req: Request, res: Response) => {
    await providers.remove(res.locals.params.id);
    res.json({ success: true, message: 'SSO provider deleted' });
  });

  return router;
};
