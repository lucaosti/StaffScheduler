/**
 * Organization translation overrides — `/api/i18n/overrides`.
 *
 * WHY `GET /overrides` NEEDS ONLY `authenticate`, NOT `settings.manage`.
 * This is what every signed-in user's own frontend calls to render itself
 * correctly — not an admin surface. It is scoped to the caller's OWN
 * organization (read from `req.user`, never accepted as a parameter), so
 * there is nothing here for a plain read to leak.
 *
 * WHY THE ADMIN CRUD BELOW IT NEEDS `settings.manage`. Managing translation
 * overrides is a system-level configuration act, the same class SSO provider
 * CRUD already sits in (`routes/sso.ts`) — mirrors that precedent rather than
 * inventing a parallel permission for a second system-configuration surface.
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { Router, Request, Response } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import {
  createTranslationOverrideBody,
  updateTranslationOverrideBody,
  translationOverrideQuery,
  idParam,
} from '../schemas';
import { TranslationOverrideService } from '../services/TranslationOverrideService';

export const createI18nOverridesRouter = (pool: Pool): Router => {
  const router = Router();
  const overrides = new TranslationOverrideService(pool);

  router.use(authenticate);

  /**
   * The override map the caller's own frontend applies over the base catalog
   * for the requested locale: the caller's organization's own row, falling
   * back to the platform-wide (`organization_name IS NULL`) row when the
   * organization has none.
   */
  router.get('/overrides', validateQuery(translationOverrideQuery), async (req: Request, res: Response) => {
    const organizationName = req.user?.organizationName ?? null;
    const data = await overrides.resolveForOrganization(organizationName, res.locals.query.locale);
    res.json({ success: true, data });
  });

  router.get('/overrides/admin', requirePermission('settings.manage'), async (_req: Request, res: Response) => {
    res.json({ success: true, data: await overrides.list() });
  });

  router.get(
    '/overrides/admin/:id',
    requirePermission('settings.manage'),
    validateParams(idParam),
    async (_req: Request, res: Response) => {
      const found = await overrides.getById(res.locals.params.id);
      if (!found) {
        return res
          .status(404)
          .json({ success: false, error: { code: 'NOT_FOUND', message: 'Translation override not found' } });
      }
      res.json({ success: true, data: found });
    }
  );

  router.post(
    '/overrides/admin',
    requirePermission('settings.manage'),
    validateBody(createTranslationOverrideBody),
    async (_req: Request, res: Response) => {
      const created = await overrides.create(res.locals.body);
      res.status(201).json({ success: true, data: created, message: 'Translation override saved' });
    }
  );

  router.put(
    '/overrides/admin/:id',
    requirePermission('settings.manage'),
    validateParams(idParam),
    validateBody(updateTranslationOverrideBody),
    async (_req: Request, res: Response) => {
      const updated = await overrides.update(res.locals.params.id, res.locals.body.overrides);
      res.json({ success: true, data: updated, message: 'Translation override updated' });
    }
  );

  router.delete(
    '/overrides/admin/:id',
    requirePermission('settings.manage'),
    validateParams(idParam),
    async (_req: Request, res: Response) => {
      await overrides.remove(res.locals.params.id);
      res.json({ success: true, message: 'Translation override deleted' });
    }
  );

  return router;
};
