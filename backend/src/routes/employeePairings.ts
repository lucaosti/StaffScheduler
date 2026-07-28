/**
 * Pairing rule routes — `/api/employee-pairings`.
 *
 * WHY READING IS GATED ON `employee.manage` AND NOT `employee.read`. Every
 * other staff-record read in this system uses `employee.read`, which the
 * default Employee role holds — so copying that gate here would publish, to
 * everyone in the organization, the list of which colleagues must be kept
 * apart. An `apart` rule is an inference about two named people even with no
 * text attached: whatever the reason, the fact that someone decided these two
 * must not share a shift is itself the sensitive part. Writes take the same
 * permission, because a pairing is an employer-imposed constraint on staff
 * rather than a preference — `preferences.manage`, which the contract routes
 * use, guards what people want, not who they may stand next to.
 *
 * WHY `reason` IS NOT SEPARATELY GATED. The obvious next step is to return the
 * free text only to whoever wrote it. It was considered and rejected: a caller
 * who can already see that two named people must be kept apart can infer the
 * substance without the sentence, so hiding the text while showing the rule
 * protects nothing and would only make the record less useful to the next
 * manager. The control that does work is the one above — the rules are not
 * readable by ordinary staff at all. If a genuinely need-to-know tier is ever
 * required, it belongs in the permission catalogue as its own code, not as a
 * field the API omits on a guess.
 *
 * There is no self-service view for the same reason. An employee asking why
 * they are never scheduled with a colleague is asking a question a manager
 * should answer in person.
 *
 * @author Luca Ostinelli
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'mysql2/promise';
import { authenticate, requirePermission } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import {
  idParam,
  createEmployeePairingBody,
  updateEmployeePairingBody,
  employeePairingListQuery,
} from '../schemas';
import { EmployeePairingService } from '../services/EmployeePairingService';

export const createEmployeePairingsRouter = (pool: Pool) => {
  const router = Router();
  const service = new EmployeePairingService(pool);

  router.get(
    '/',
    authenticate,
    requirePermission('employee.manage'),
    validateQuery(employeePairingListQuery),
    asyncHandler(async (_req: Request, res: Response) => {
      const userId = res.locals.query.userId as number | undefined;
      res.json({ success: true, data: await service.list(userId) });
    })
  );

  router.get(
    '/:id',
    authenticate,
    requirePermission('employee.manage'),
    validateParams(idParam),
    asyncHandler(async (_req: Request, res: Response) => {
      res.json({ success: true, data: await service.getById(res.locals.params.id) });
    })
  );

  router.post(
    '/',
    authenticate,
    requirePermission('employee.manage'),
    validateBody(createEmployeePairingBody),
    asyncHandler(async (_req: Request, res: Response) => {
      const created = await service.create(res.locals.body);
      res.status(201).json({ success: true, data: created, message: 'Pairing rule created' });
    })
  );

  router.put(
    '/:id',
    authenticate,
    requirePermission('employee.manage'),
    validateParams(idParam),
    validateBody(updateEmployeePairingBody),
    asyncHandler(async (_req: Request, res: Response) => {
      const updated = await service.updateReason(res.locals.params.id, res.locals.body.reason);
      res.json({ success: true, data: updated, message: 'Pairing rule updated' });
    })
  );

  router.delete(
    '/:id',
    authenticate,
    requirePermission('employee.manage'),
    validateParams(idParam),
    asyncHandler(async (_req: Request, res: Response) => {
      await service.remove(res.locals.params.id);
      res.json({ success: true, message: 'Pairing rule deleted' });
    })
  );

  return router;
};
