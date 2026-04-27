/**
 * User directory routes (F22).
 *
 *   GET   /api/directory/me                 own profile + custom fields
 *   GET   /api/directory/users/:id          another user's profile (manager)
 *   PUT   /api/directory/users/:id/fields   bulk upsert custom fields (manager)
 *   DELETE /api/directory/users/:id/fields/:key  remove a custom field
 *   GET   /api/directory/users/:id/vcard    vCard for a single user
 *   GET   /api/directory/vcard.vcf?ids=…    vCard archive for a list of users
 *   POST  /api/directory/import-vcard       admin-only multipart vCard import
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import bcrypt from 'bcrypt';
import { Router, Request, Response } from 'express';
import { authenticate, requireAdmin, requireManager } from '../middleware/auth';
import { UserDirectoryService } from '../services/UserDirectoryService';
import { config } from '../config';

const error = (res: Response, status: number, code: string, message: string): void => {
  res.status(status).json({ success: false, error: { code, message } });
};

export const createDirectoryRouter = (pool: Pool): Router => {
  const router = Router();
  const service = new UserDirectoryService(pool);

  router.use(authenticate);

  router.get('/me', async (req: Request, res: Response) => {
    const profile = await service.getProfile(req.user!.id);
    if (!profile) return error(res, 404, 'NOT_FOUND', 'Profile not found');
    res.json({ success: true, data: profile });
  });

  router.get('/users/:id', requireManager, async (req: Request, res: Response) => {
    const profile = await service.getProfile(Number(req.params.id));
    if (!profile) return error(res, 404, 'NOT_FOUND', 'Profile not found');
    res.json({ success: true, data: profile });
  });

  router.put('/users/:id/fields', requireManager, async (req: Request, res: Response) => {
    try {
      const fields = Array.isArray(req.body?.fields) ? req.body.fields : [];
      await service.setFields(Number(req.params.id), fields);
      const profile = await service.getProfile(Number(req.params.id));
      res.json({ success: true, data: profile });
    } catch (err) {
      error(res, 400, 'VALIDATION_ERROR', (err as Error).message);
    }
  });

  router.delete(
    '/users/:id/fields/:key',
    requireManager,
    async (req: Request, res: Response) => {
      const ok = await service.removeField(Number(req.params.id), req.params.key);
      if (!ok) return error(res, 404, 'NOT_FOUND', 'Field not found');
      res.json({ success: true });
    }
  );

  router.get('/users/:id/vcard', async (req: Request, res: Response) => {
    const profile = await service.getProfile(Number(req.params.id));
    if (!profile) return error(res, 404, 'NOT_FOUND', 'Profile not found');
    const vcf = await service.exportVcf([profile.id]);
    res
      .status(200)
      .type('text/vcard; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="${profile.email}.vcf"`)
      .send(vcf);
  });

  router.get('/vcard.vcf', requireManager, async (req: Request, res: Response) => {
    const idsParam = (req.query.ids as string | undefined) ?? '';
    const ids = idsParam
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (ids.length === 0) return error(res, 400, 'VALIDATION_ERROR', 'ids query param is required');
    const vcf = await service.exportVcf(ids);
    res
      .status(200)
      .type('text/vcard; charset=utf-8')
      .set('Content-Disposition', 'attachment; filename="directory.vcf"')
      .send(vcf);
  });

  router.post('/import-vcard', requireAdmin, async (req: Request, res: Response) => {
    try {
      const text = typeof req.body === 'string' ? req.body : (req.body?.vcf as string | undefined);
      if (!text) return error(res, 400, 'VALIDATION_ERROR', 'vcf body required');
      const defaultPassword = (req.body?.defaultPassword as string | undefined) ?? 'changeme';
      const passwordHash = await bcrypt.hash(defaultPassword, config.security.bcryptRounds);
      const out = await service.importVcf(text, {
        defaultPasswordHash: passwordHash,
        createdBy: req.user!.id,
      });
      res.json({ success: true, data: out });
    } catch (err) {
      error(res, 400, 'VALIDATION_ERROR', (err as Error).message);
    }
  });

  return router;
};
