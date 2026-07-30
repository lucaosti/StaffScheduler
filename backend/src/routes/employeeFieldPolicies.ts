/**
 * Administering the per-organization employee field rules.
 *
 * WHY IT IS GATED ON `settings.manage` AND NOT `employee.manage`. Editing an
 * employee and deciding what an employee record must contain are different acts:
 * the first is day-to-day work a scheduling manager does, the second changes the
 * rules everyone else then works under — and it can make a field visible.
 * `employee.manage` is held by every manager; this must not be.
 *
 * WHY READING IS OPEN TO ANY AUTHENTICATED CALLER. A form has to know which
 * fields are required and what the rules are before someone fills it in, or the
 * only way to discover a rule is to break it. The policies say nothing about any
 * person — they describe the shape of a record — so there is nothing here to
 * withhold. Writing is the restricted half.
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { Router, Request, Response } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateBody, validateQuery } from '../middleware/validation';
import {
  employeeFieldPolicyBody,
  employeeFieldPolicyQuery,
  employeeFieldPolicyDeleteQuery,
} from '../schemas';
import { NotFoundError } from '../errors';
import {
  EmployeeFieldPolicyService,
  GOVERNABLE_CORE_FIELDS,
} from '../services/EmployeeFieldPolicyService';

export const createEmployeeFieldPolicyRouter = (pool: Pool): Router => {
  const router = Router();
  const service = new EmployeeFieldPolicyService(pool);

  router.use(authenticate);

  /**
   * The policies in force, most specific first.
   *
   * Defaults to the caller's own organization rather than requiring the
   * parameter: asking a client to name its own organization invites it to name
   * a different one, and the answer it needs is almost always its own.
   */
  router.get('/', validateQuery(employeeFieldPolicyQuery), asyncHandler(async (req: Request, res: Response) => {
    const organizationName = res.locals.query.organizationName ?? req.user?.organizationName ?? null;
    const policies = await service.listForOrganization(organizationName);
    res.json({
      success: true,
      data: {
        policies,
        // The allowlist travels with the answer so an admin UI can offer the
        // governable fields rather than hard-coding a copy that goes stale the
        // moment the constant changes.
        governableCoreFields: GOVERNABLE_CORE_FIELDS,
      },
    });
  }));

  router.put('/', requirePermission('settings.manage'), validateBody(employeeFieldPolicyBody), asyncHandler(async (_req: Request, res: Response) => {
    const body = res.locals.body;
    await service.upsert({
      organizationName: body.organizationName ?? null,
      fieldKey: body.fieldKey,
      isRequired: body.isRequired ?? false,
      visiblePermission: body.visiblePermission ?? null,
      editPermission: body.editPermission ?? null,
      minLength: body.minLength ?? null,
      maxLength: body.maxLength ?? null,
      minValue: body.minValue ?? null,
      maxValue: body.maxValue ?? null,
      pattern: body.pattern ?? null,
      allowedValues: body.allowedValues ?? null,
      helpText: body.helpText ?? null,
    });
    res.json({ success: true, message: 'Field policy saved' });
  }));

  router.delete('/', requirePermission('settings.manage'), validateQuery(employeeFieldPolicyDeleteQuery), asyncHandler(async (_req: Request, res: Response) => {
    const removed = await service.remove(
      res.locals.query.organizationName ?? null,
      res.locals.query.fieldKey
    );
    if (!removed) throw new NotFoundError('Field policy not found');
    res.json({ success: true, message: 'Field policy removed' });
  }));

  return router;
};
