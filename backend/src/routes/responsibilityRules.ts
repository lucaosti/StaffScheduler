/**
 * Responsibility rules routes.
 *
 * Manages the multidimensional responsibility matrix that maps
 * (subject group × permission code) → responsible org unit.
 *
 * GET    /api/responsibility-rules           list (responsibility.read)
 * POST   /api/responsibility-rules           create (responsibility.manage)
 * GET    /api/responsibility-rules/resolve   resolve responsible users (responsibility.read)
 * GET    /api/responsibility-rules/:id       get one (responsibility.read)
 * PUT    /api/responsibility-rules/:id       update (responsibility.manage)
 * DELETE /api/responsibility-rules/:id       delete (responsibility.manage)
 *
 * @author Luca Ostinelli
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'mysql2/promise';
import { z } from 'zod';
import { authenticate, requirePermission } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateBody, validateParams } from '../middleware/validation';
import { idParam } from '../schemas';
import { ResponsibilityRuleService } from '../services/ResponsibilityRuleService';
import { User } from '../types';

const SUBJECT_TYPES = ['org_unit', 'department', 'role', 'all'] as const;

const createRuleBody = z.object({
  subjectType: z.enum(SUBJECT_TYPES),
  subjectId: z.number().int().positive().nullable().optional(),
  permissionCode: z.string().min(1).max(80),
  responsibleOrgUnitId: z.number().int().positive(),
  delegatedToRoleId: z.number().int().positive().nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
});

const updateRuleBody = z.object({
  subjectType: z.enum(SUBJECT_TYPES).optional(),
  subjectId: z.number().int().positive().nullable().optional(),
  permissionCode: z.string().min(1).max(80).optional(),
  responsibleOrgUnitId: z.number().int().positive().optional(),
  delegatedToRoleId: z.number().int().positive().nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
  isActive: z.boolean().optional(),
});

const bulkBody = z.object({
  subjectType: z.enum(SUBJECT_TYPES),
  subjectIds: z.array(z.number().int().positive()).max(200).optional(),
  permissionCodes: z.array(z.string().min(1).max(80)).min(1).max(50),
  responsibleOrgUnitId: z.number().int().positive(),
  delegatedToRoleId: z.number().int().positive().nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
});

export const createResponsibilityRulesRouter = (pool: Pool): Router => {
  const router = Router();
  const svc = new ResponsibilityRuleService(pool);

  router.use(authenticate);

  // List rules
  router.get('/', requirePermission('responsibility.read'), asyncHandler(async (req: Request, res: Response) => {
    const { subjectType, permissionCode, responsibleOrgUnitId, isActive } = req.query;
    const rules = await svc.list({
      subjectType: subjectType as string | undefined,
      permissionCode: permissionCode as string | undefined,
      responsibleOrgUnitId: responsibleOrgUnitId ? Number(responsibleOrgUnitId) : undefined,
      isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
    });
    res.json({ success: true, data: rules });
  }));

  // Resolve responsible users for a given subject + permission
  router.get('/resolve', requirePermission('responsibility.read'), asyncHandler(async (req: Request, res: Response) => {
    const { orgUnitId, permissionCode } = req.query;

    if (!permissionCode) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'permissionCode is required' } });
    }

    const departmentIds = req.query.departmentIds
      ? String(req.query.departmentIds).split(',').map(Number).filter(Boolean)
      : [];
    const roleIds = req.query.roleIds
      ? String(req.query.roleIds).split(',').map(Number).filter(Boolean)
      : [];

    const userIds = await svc.resolveResponsibleUsers({
      permissionCode: permissionCode as string,
      orgUnitId: orgUnitId ? Number(orgUnitId) : null,
      departmentIds,
      roleIds,
    });

    res.json({ success: true, data: { userIds } });
  }));

  // GET /matrix — pivot view: rules grouped by (subject, permission)
  router.get('/matrix', requirePermission('responsibility.read'), asyncHandler(async (_req: Request, res: Response) => {
    const matrix = await svc.getMatrix();
    res.json({ success: true, data: { matrix } });
  }));

  // GET /my-responsibilities — rules for which the current user is a responsible party
  router.get('/my-responsibilities', authenticate, asyncHandler(async (req: Request, res: Response) => {
    const actor = req.user as User;
    const rules = await svc.getMyResponsibilities(actor.id);
    res.json({ success: true, data: rules });
  }));

  // POST /bulk — create N rules in one transaction
  router.post('/bulk', requirePermission('responsibility.manage'), validateBody(bulkBody), asyncHandler(async (req: Request, res: Response) => {
    const actor = req.user as User;
    const body = res.locals.body;
    const rules = await svc.bulkCreate(
      {
        subjectType: body.subjectType,
        subjectIds: body.subjectIds ?? [],
        permissionCodes: body.permissionCodes,
        responsibleOrgUnitId: body.responsibleOrgUnitId,
        delegatedToRoleId: body.delegatedToRoleId ?? null,
        description: body.description ?? null,
      },
      actor.id
    );
    res.status(201).json({ success: true, data: rules, message: `${rules.length} responsibility rules created` });
  }));

  // Get by ID
  router.get('/:id', requirePermission('responsibility.read'), validateParams(idParam), asyncHandler(async (_req: Request, res: Response) => {
    const rule = await svc.getById(res.locals.params.id);
    if (!rule) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Responsibility rule not found' } });
    }
    res.json({ success: true, data: rule });
  }));

  // Create
  router.post('/', requirePermission('responsibility.manage'), validateBody(createRuleBody), asyncHandler(async (req: Request, res: Response) => {
    const actor = req.user as User;
    const rule = await svc.create(res.locals.body, actor.id);
    res.status(201).json({ success: true, data: rule, message: 'Responsibility rule created' });
  }));

  // GET /:id/conflicts — detect overlapping rules for the same subject+permission
  router.get('/:id/conflicts', requirePermission('responsibility.read'), validateParams(idParam), asyncHandler(async (_req: Request, res: Response) => {
    const conflicts = await svc.getConflicts(res.locals.params.id);
    res.json({ success: true, data: { conflicts, hasConflicts: conflicts.length > 0 } });
  }));

  // Update
  router.put('/:id', requirePermission('responsibility.manage'), validateParams(idParam), validateBody(updateRuleBody), asyncHandler(async (req: Request, res: Response) => {
    const actor = req.user as User;
    const rule = await svc.update(res.locals.params.id, res.locals.body, actor.id);
    res.json({ success: true, data: rule, message: 'Responsibility rule updated' });
  }));

  // Delete
  router.delete('/:id', requirePermission('responsibility.manage'), validateParams(idParam), asyncHandler(async (req: Request, res: Response) => {
    const actor = req.user as User;
    await svc.delete(res.locals.params.id, actor.id);
    res.json({ success: true, message: 'Responsibility rule deleted' });
  }));

  return router;
};
