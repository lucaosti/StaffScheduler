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
import { asyncHandler } from '../middleware/asyncHandler';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { createPolicyExceptionBody, createPolicyBody, updatePolicyBody, validateAssignmentBody, updateApprovalMatrixBody, optionalNotesBody, idParam, changeTypeParam, policyExceptionListQuery } from '../schemas';
import { PolicyService } from '../services/PolicyService';
import { PolicyExceptionService } from '../services/PolicyExceptionService';
import { ApprovalMatrixService } from '../services/ApprovalMatrixService';
import { PolicyValidator } from '../services/PolicyValidator';
import { AuditLogService } from '../services/AuditLogService';

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

  router.post('/validate/assignment', validateBody(validateAssignmentBody), asyncHandler(async (_req: Request, res: Response) => {
    const result = await validator.validateAssignment({
      userId: res.locals.body.userId,
      shiftId: res.locals.body.shiftId,
    });
    res.json({ success: true, data: result });
  }));

  // ------------- Approval matrix (must be declared before /:id) -------------

  router.get('/approval-matrix', asyncHandler(async (_req, res: Response) => {
    res.json({ success: true, data: await matrix.list() });
  }));

  router.put('/approval-matrix/:changeType', requirePermission('approval.manage'), validateParams(changeTypeParam), validateBody(updateApprovalMatrixBody), asyncHandler(async (_req: Request, res: Response) => {
    const updated = await matrix.update(res.locals.params.changeType, res.locals.body);
    res.json({ success: true, data: updated });
  }));

  // ------------- Exceptions (declared before /:id) -------------

  router.get('/exceptions', validateQuery(policyExceptionListQuery), asyncHandler(async (req: Request, res: Response) => {
    const { requestedByUserId, status, ...rest } = res.locals.query;
    // Approvers may list anyone's exception requests; everyone else is pinned
    // to their own, so a requestedByUserId filter from them is ignored.
    const isManager = userHasPermission(req.user, 'policy.approve');
    const filters = {
      ...rest,
      status: status as never,
      requestedByUserId: isManager ? requestedByUserId : req.user!.id,
    };
    res.json({ success: true, data: await exceptions.list(filters) });
  }));

  router.post('/exceptions', validateBody(createPolicyExceptionBody), asyncHandler(async (req: Request, res: Response) => {
    const created = await exceptions.create({
      policyId: res.locals.body.policyId,
      targetType: res.locals.body.targetType,
      targetId: res.locals.body.targetId,
      reason: res.locals.body.reason ?? null,
      requestedByUserId: req.user!.id,
    });
    res.status(201).json({ success: true, data: created });
  }));

  router.post('/exceptions/:id/approve', requirePermission('policy.approve'), validateParams(idParam), validateBody(optionalNotesBody), asyncHandler(async (req: Request, res: Response) => {
    const updated = await exceptions.approve(
      res.locals.params.id,
      req.user!.id,
      (res.locals.body.notes as string | null | undefined) ?? null
    );
    res.json({ success: true, data: updated });
  }));

  router.post('/exceptions/:id/reject', requirePermission('policy.approve'), validateParams(idParam), validateBody(optionalNotesBody), asyncHandler(async (req: Request, res: Response) => {
    const updated = await exceptions.reject(
      res.locals.params.id,
      req.user!.id,
      (res.locals.body.notes as string | null | undefined) ?? null
    );
    res.json({ success: true, data: updated });
  }));

  router.post('/exceptions/:id/cancel', validateParams(idParam), asyncHandler(async (req: Request, res: Response) => {
    const updated = await exceptions.cancel(res.locals.params.id, req.user!.id);
    res.json({ success: true, data: updated });
  }));

  // ------------- Policies CRUD -------------

  router.get('/', requirePermission('policy.read'), asyncHandler(async (_req, res: Response) => {
    res.json({ success: true, data: await policies.list() });
  }));

  router.get('/:id', requirePermission('policy.read'), validateParams(idParam), asyncHandler(async (_req: Request, res: Response) => {
    const p = await policies.getById(res.locals.params.id);
    if (!p) return respondError(res, 404, 'NOT_FOUND', 'Policy not found');
    res.json({ success: true, data: p });
  }));

  router.post('/', requirePermission('policy.manage'), validateBody(createPolicyBody), asyncHandler(async (req: Request, res: Response) => {
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
  }));

  router.put('/:id', requirePermission('policy.manage'), validateParams(idParam), validateBody(updatePolicyBody), asyncHandler(async (req: Request, res: Response) => {
    const existing = await policies.getById(res.locals.params.id);
    if (!existing) return respondError(res, 404, 'NOT_FOUND', 'Policy not found');
    // Only the owner or a full administrator may edit a policy directly.
    if (existing.imposedByUserId !== req.user!.id && !userHasPermission(req.user, 'settings.manage')) {
      return respondError(res, 403, 'FORBIDDEN', 'Only the policy owner or an administrator may edit this policy');
    }
    const updated = await policies.update(res.locals.params.id, res.locals.body);
    await audit.write({
      actorId: req.user!.id, action: 'policy.update',
      entityType: 'policy', entityId: updated.id,
      before: { key: existing.policyKey, value: existing.policyValue },
      after: { key: updated.policyKey, value: updated.policyValue },
    });
    res.json({ success: true, data: updated });
  }));

  router.delete('/:id', requirePermission('policy.manage'), validateParams(idParam), asyncHandler(async (req: Request, res: Response) => {
    const existing = await policies.getById(res.locals.params.id);
    if (!existing) return respondError(res, 404, 'NOT_FOUND', 'Policy not found');
    if (existing.imposedByUserId !== req.user!.id && !userHasPermission(req.user, 'settings.manage')) {
      return respondError(res, 403, 'FORBIDDEN', 'Only the policy owner or an administrator may delete this policy');
    }
    await policies.remove(res.locals.params.id);
    await audit.write({
      actorId: req.user!.id, action: 'policy.delete',
      entityType: 'policy', entityId: res.locals.params.id,
      before: { key: existing.policyKey, value: existing.policyValue },
    });
    res.json({ success: true });
  }));

  return router;
};
