/**
 * Policies, exception requests, and approval matrix.
 *
 * - GET    /api/policies                     list
 * - GET    /api/policies/:id                 read
 * - POST   /api/policies                     create (admin/manager)
 * - PUT    /api/policies/:id                 update (owner/admin)
 * - DELETE /api/policies/:id                 delete (owner/admin)
 *
 * - GET    /api/policies/exceptions          list (filterable)
 * - POST   /api/policies/exceptions          create
 * - POST   /api/policies/exceptions/:id/approve   (approver)
 * - POST   /api/policies/exceptions/:id/reject    (approver)
 * - POST   /api/policies/exceptions/:id/cancel    (requester)
 *
 * - GET    /api/policies/approval-matrix     list
 * - PUT    /api/policies/approval-matrix/:changeType   update (admin)
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { Router, Request, Response } from 'express';
import { authenticate, requirePermission, userHasPermission } from '../middleware/auth';
import { validateBody } from '../middleware/validation';
import { createPolicyExceptionBody, createPolicyBody, updatePolicyBody } from '../schemas';
import { PolicyService } from '../services/PolicyService';
import { PolicyExceptionService } from '../services/PolicyExceptionService';
import { ApprovalMatrixService } from '../services/ApprovalMatrixService';
import { PolicyValidator } from '../services/PolicyValidator';
import { AuditLogService } from '../services/AuditLogService';
import { logger } from '../config/logger';

const respondError = (res: Response, status: number, code: string, message: string): void => {
  res.status(status).json({ success: false, error: { code, message } });
};

export const createPoliciesRouter = (pool: Pool): Router => {
  const router = Router();
  const policies = new PolicyService(pool);
  const exceptions = new PolicyExceptionService(pool);
  const matrix = new ApprovalMatrixService(pool);
  const validator = new PolicyValidator(pool);
  const audit = new AuditLogService(pool);

  router.use(authenticate);

  // ------------- Validation -------------

  router.post('/validate/assignment', async (req: Request, res: Response) => {
    try {
      const result = await validator.validateAssignment({
        userId: Number(req.body?.userId),
        shiftId: Number(req.body?.shiftId),
      });
      res.json({ success: true, data: result });
    } catch (err) {
      const msg = (err as Error).message;
      const status = msg.includes('not found') ? 404 : 400;
      respondError(res, status, status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR', msg);
    }
  });

  // ------------- Approval matrix (must be declared before /:id) -------------

  router.get('/approval-matrix', async (_req, res: Response) => {
    try {
      res.json({ success: true, data: await matrix.list() });
    } catch (err) {
      logger.error('approval matrix list failed', err);
      respondError(res, 500, 'INTERNAL_ERROR', 'Failed to list approval matrix');
    }
  });

  router.put('/approval-matrix/:changeType', requirePermission('approval.manage'), async (req: Request, res: Response) => {
    try {
      const updated = await matrix.update(req.params.changeType, req.body ?? {});
      res.json({ success: true, data: updated });
    } catch (err) {
      const msg = (err as Error).message;
      const status = msg.includes('not found') ? 404 : 400;
      respondError(res, status, status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR', msg);
    }
  });

  // ------------- Exceptions (declared before /:id) -------------

  router.get('/exceptions', async (req: Request, res: Response) => {
    try {
      const isManager = userHasPermission(req.user, 'policy.approve');
      const filters = {
        policyId: req.query.policyId ? Number(req.query.policyId) : undefined,
        targetType: (req.query.targetType as string) ?? undefined,
        targetId: req.query.targetId ? Number(req.query.targetId) : undefined,
        status: (req.query.status as never) ?? undefined,
        requestedByUserId: isManager
          ? req.query.requestedByUserId
            ? Number(req.query.requestedByUserId)
            : undefined
          : req.user!.id,
      };
      res.json({ success: true, data: await exceptions.list(filters) });
    } catch (err) {
      logger.error('policy exception list failed', err);
      respondError(res, 500, 'INTERNAL_ERROR', 'Failed to list policy exceptions');
    }
  });

  router.post('/exceptions', validateBody(createPolicyExceptionBody), async (req: Request, res: Response) => {
    try {
      const created = await exceptions.create({
        policyId: res.locals.body.policyId,
        targetType: res.locals.body.targetType,
        targetId: res.locals.body.targetId,
        reason: res.locals.body.reason ?? null,
        requestedByUserId: req.user!.id,
      });
      res.status(201).json({ success: true, data: created });
    } catch (err) {
      respondError(res, 400, 'VALIDATION_ERROR', (err as Error).message);
    }
  });

  router.post('/exceptions/:id/approve', requirePermission('policy.approve'), async (req: Request, res: Response) => {
    try {
      const updated = await exceptions.approve(
        Number(req.params.id),
        req.user!.id,
        req.body?.notes ?? null
      );
      res.json({ success: true, data: updated });
    } catch (err) {
      const msg = (err as Error).message;
      const status = msg.includes('not found') ? 404 : msg === 'Forbidden' ? 403 : 409;
      respondError(res, status, status === 404 ? 'NOT_FOUND' : status === 403 ? 'FORBIDDEN' : 'CONFLICT', msg);
    }
  });

  router.post('/exceptions/:id/reject', requirePermission('policy.approve'), async (req: Request, res: Response) => {
    try {
      const updated = await exceptions.reject(
        Number(req.params.id),
        req.user!.id,
        req.body?.notes ?? null
      );
      res.json({ success: true, data: updated });
    } catch (err) {
      const msg = (err as Error).message;
      const status = msg.includes('not found') ? 404 : msg === 'Forbidden' ? 403 : 409;
      respondError(res, status, status === 404 ? 'NOT_FOUND' : status === 403 ? 'FORBIDDEN' : 'CONFLICT', msg);
    }
  });

  router.post('/exceptions/:id/cancel', async (req: Request, res: Response) => {
    try {
      const updated = await exceptions.cancel(Number(req.params.id), req.user!.id);
      res.json({ success: true, data: updated });
    } catch (err) {
      const msg = (err as Error).message;
      const status = msg.includes('not found') ? 404 : msg === 'Forbidden' ? 403 : 409;
      const code = status === 404 ? 'NOT_FOUND' : status === 403 ? 'FORBIDDEN' : 'CONFLICT';
      respondError(res, status, code, msg);
    }
  });

  // ------------- Policies CRUD -------------

  router.get('/', async (_req, res: Response) => {
    try {
      res.json({ success: true, data: await policies.list() });
    } catch (err) {
      logger.error('policies list failed', err);
      respondError(res, 500, 'INTERNAL_ERROR', 'Failed to list policies');
    }
  });

  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const p = await policies.getById(Number(req.params.id));
      if (!p) return respondError(res, 404, 'NOT_FOUND', 'Policy not found');
      res.json({ success: true, data: p });
    } catch (err) {
      logger.error('policy get failed', err);
      respondError(res, 500, 'INTERNAL_ERROR', 'Failed to read policy');
    }
  });

  router.post('/', requirePermission('policy.manage'), validateBody(createPolicyBody), async (req: Request, res: Response) => {
    try {
      const created = await policies.create({
        scopeType: res.locals.body.scopeType,
        scopeId: res.locals.body.scopeId ?? null,
        policyKey: res.locals.body.policyKey,
        policyValue: res.locals.body.policyValue,
        description: res.locals.body.description ?? null,
        imposedByUserId: req.user!.id,
      });
      await audit.write({
        actorId: req.user!.id, action: 'policy.create',
        entityType: 'policy', entityId: created.id,
        after: { key: created.policyKey, value: created.policyValue },
      });
      res.status(201).json({ success: true, data: created });
    } catch (err) {
      respondError(res, 400, 'VALIDATION_ERROR', (err as Error).message);
    }
  });

  router.put('/:id', requirePermission('policy.manage'), validateBody(updatePolicyBody), async (req: Request, res: Response) => {
    try {
      const existing = await policies.getById(Number(req.params.id));
      if (!existing) return respondError(res, 404, 'NOT_FOUND', 'Policy not found');
      // Only the owner or a full administrator may edit a policy directly.
      if (existing.imposedByUserId !== req.user!.id && !userHasPermission(req.user, 'settings.manage')) {
        return respondError(res, 403, 'FORBIDDEN', 'Only the policy owner or an administrator may edit this policy');
      }
      const updated = await policies.update(Number(req.params.id), res.locals.body);
      await audit.write({
        actorId: req.user!.id, action: 'policy.update',
        entityType: 'policy', entityId: updated.id,
        before: { key: existing.policyKey, value: existing.policyValue },
        after: { key: updated.policyKey, value: updated.policyValue },
      });
      res.json({ success: true, data: updated });
    } catch (err) {
      const msg = (err as Error).message;
      const status = msg.includes('not found') ? 404 : 400;
      respondError(res, status, status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR', msg);
    }
  });

  router.delete('/:id', requirePermission('policy.manage'), async (req: Request, res: Response) => {
    try {
      const existing = await policies.getById(Number(req.params.id));
      if (!existing) return respondError(res, 404, 'NOT_FOUND', 'Policy not found');
      if (existing.imposedByUserId !== req.user!.id && !userHasPermission(req.user, 'settings.manage')) {
        return respondError(res, 403, 'FORBIDDEN', 'Only the policy owner or an administrator may delete this policy');
      }
      await policies.remove(Number(req.params.id));
      await audit.write({
        actorId: req.user!.id, action: 'policy.delete',
        entityType: 'policy', entityId: Number(req.params.id),
        before: { key: existing.policyKey, value: existing.policyValue },
      });
      res.json({ success: true });
    } catch (err) {
      respondError(res, 400, 'VALIDATION_ERROR', (err as Error).message);
    }
  });

  return router;
};
