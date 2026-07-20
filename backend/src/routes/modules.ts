/**
 * Module Routes
 *
 * GET  /api/modules           — list all modules (admin)
 * PUT  /api/modules/:code     — enable / disable a module (admin)
 *
 * @author Luca Ostinelli
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'mysql2/promise';
import { z } from 'zod';
import { authenticate, requirePermission, getModuleService } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateBody, validateParams } from '../middleware/validation';
import { moduleEnabledBody, codeParam } from '../schemas';

const codeOrgParams = z.object({
  code: z.string().min(1).max(60),
  org: z.string().min(1).max(120),
});

// Same length bound as codeOrgParams.org: org names are identifiers coming
// from the URL, so they are validated declaratively like every other param
// (hand-rolled length checks drifted from the schema once already).
const orgParam = z.object({
  org: z.string().min(1).max(120),
});

const orgOverrideBody = z.object({
  isEnabled: z.boolean(),
  justification: z.string().max(1000).nullable().optional(),
});

export const createModulesRouter = (_pool: Pool): Router => {
  const router = Router();
  const moduleService = getModuleService();

  router.get('/', authenticate, requirePermission('settings.manage'), asyncHandler(async (_req: Request, res: Response) => {
    const modules = await moduleService.list();
    res.json({ success: true, data: modules });
  }));

  router.put('/:code', authenticate, requirePermission('settings.manage'), validateParams(codeParam), validateBody(moduleEnabledBody), asyncHandler(async (req: Request, res: Response) => {
    const { code } = res.locals.params;
    const { isEnabled, justification } = res.locals.body;
    const updated = await moduleService.setEnabled(code, isEnabled, req.user!.id, justification ?? null);
    res.json({ success: true, data: updated, message: `Module '${code}' ${isEnabled ? 'enabled' : 'disabled'}` });
  }));

  // GET /org/:org — list all modules with org-specific overrides applied
  router.get('/org/:org', authenticate, requirePermission('settings.manage'), validateParams(orgParam), asyncHandler(async (_req: Request, res: Response) => {
    const { org } = res.locals.params;
    const modules = await moduleService.listWithOrgOverrides(org);
    res.json({ success: true, data: modules });
  }));

  // PUT /:code/org/:org — create or update a per-org module override
  router.put('/:code/org/:org', authenticate, requirePermission('settings.manage'), validateParams(codeOrgParams), validateBody(orgOverrideBody), asyncHandler(async (req: Request, res: Response) => {
    const { code, org } = res.locals.params;
    const { isEnabled, justification } = res.locals.body;
    const updated = await moduleService.setOrgOverride(code, org, isEnabled, req.user!.id, justification ?? null);
    res.json({
      success: true,
      data: updated,
      message: `Module '${code}' ${isEnabled ? 'enabled' : 'disabled'} for org '${org}'`,
    });
  }));

  // DELETE /:code/org/:org — remove a per-org override (revert to global default)
  router.delete('/:code/org/:org', authenticate, requirePermission('settings.manage'), validateParams(codeOrgParams), asyncHandler(async (_req: Request, res: Response) => {
    const { code, org } = res.locals.params;
    await moduleService.removeOrgOverride(code, org);
    res.json({ success: true, message: `Override for module '${code}' removed for org '${org}'` });
  }));

  return router;
};
