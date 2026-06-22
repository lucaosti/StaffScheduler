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
import { validateBody, validateParams } from '../middleware/validation';
import { idParam } from '../schemas';
import { ResponsibilityRuleService } from '../services/ResponsibilityRuleService';
import { User } from '../types';
import { logger } from '../config/logger';

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

export const createResponsibilityRulesRouter = (pool: Pool): Router => {
  const router = Router();
  const svc = new ResponsibilityRuleService(pool);

  router.use(authenticate);

  // List rules
  router.get('/', requirePermission('responsibility.read'), async (req: Request, res: Response) => {
    try {
      const { subjectType, permissionCode, responsibleOrgUnitId, isActive } = req.query;
      const rules = await svc.list({
        subjectType: subjectType as string | undefined,
        permissionCode: permissionCode as string | undefined,
        responsibleOrgUnitId: responsibleOrgUnitId ? Number(responsibleOrgUnitId) : undefined,
        isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
      });
      res.json({ success: true, data: rules });
    } catch (error) {
      logger.error('List responsibility rules error:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to list responsibility rules' } });
    }
  });

  // Resolve responsible users for a given subject + permission
  router.get('/resolve', requirePermission('responsibility.read'), async (req: Request, res: Response) => {
    try {
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
    } catch (error) {
      logger.error('Resolve responsibility error:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to resolve responsible users' } });
    }
  });

  // Get by ID
  router.get('/:id', requirePermission('responsibility.read'), validateParams(idParam), async (_req: Request, res: Response) => {
    try {
      const rule = await svc.getById(res.locals.params.id);
      if (!rule) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Responsibility rule not found' } });
      }
      res.json({ success: true, data: rule });
    } catch (error) {
      logger.error('Get responsibility rule error:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to get responsibility rule' } });
    }
  });

  // Create
  router.post('/', requirePermission('responsibility.manage'), validateBody(createRuleBody), async (req: Request, res: Response) => {
    try {
      const actor = req.user as User;
      const rule = await svc.create(res.locals.body, actor.id);
      res.status(201).json({ success: true, data: rule, message: 'Responsibility rule created' });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to create responsibility rule';
      if (msg.toLowerCase().includes('not found')) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: msg } });
      }
      logger.error('Create responsibility rule error:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to create responsibility rule' } });
    }
  });

  // Update
  router.put('/:id', requirePermission('responsibility.manage'), validateParams(idParam), validateBody(updateRuleBody), async (req: Request, res: Response) => {
    try {
      const actor = req.user as User;
      const rule = await svc.update(res.locals.params.id, res.locals.body, actor.id);
      res.json({ success: true, data: rule, message: 'Responsibility rule updated' });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to update responsibility rule';
      if (msg.toLowerCase().includes('not found')) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: msg } });
      }
      logger.error('Update responsibility rule error:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to update responsibility rule' } });
    }
  });

  // Delete
  router.delete('/:id', requirePermission('responsibility.manage'), validateParams(idParam), async (req: Request, res: Response) => {
    try {
      const actor = req.user as User;
      await svc.delete(res.locals.params.id, actor.id);
      res.json({ success: true, message: 'Responsibility rule deleted' });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to delete responsibility rule';
      if (msg.toLowerCase().includes('not found')) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: msg } });
      }
      logger.error('Delete responsibility rule error:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to delete responsibility rule' } });
    }
  });

  return router;
};
