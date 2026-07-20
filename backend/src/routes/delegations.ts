/**
 * Delegation Routes
 *
 * POST   /api/delegations        — create a delegation (delegator = req.user)
 * GET    /api/delegations        — list delegations where req.user is delegator or delegatee
 * DELETE /api/delegations/:id    — revoke a delegation (only the delegator may do this)
 *
 * @author Luca Ostinelli
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'mysql2/promise';
import { DelegationService } from '../services/DelegationService';
import { ConflictError } from '../errors';
import { authenticate, requirePermission } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateParams, validateBody } from '../middleware/validation';
import { idParam, createDelegationBody } from '../schemas';

export const createDelegationsRouter = (pool: Pool): Router => {
  const router = Router();
  const delegationService = new DelegationService(pool);

  // Create a delegation
  router.post('/', authenticate, requirePermission('delegation.manage'), validateBody(createDelegationBody), asyncHandler(async (req: Request, res: Response) => {
    try {
      const actor = req.user!;
      const { delegateeId, permissionCodes, expiresAt, scopeOrgUnitId, justification } = res.locals.body;

      const delegation = await delegationService.createDelegation(
        actor.id,
        actor.permissions ?? [],
        { delegateeId, permissionCodes, expiresAt, scopeOrgUnitId: scopeOrgUnitId ?? null },
        justification ?? null
      );

      res.status(201).json({ success: true, data: delegation, message: 'Delegation created' });
    } catch (error) {
      // Delegation-rule violations keep their historical 422 DELEGATION_INVALID
      // contract; everything else renders through the central error middleware.
      if (error instanceof ConflictError) {
        return res.status(422).json({
          success: false,
          error: { code: 'DELEGATION_INVALID', message: error.message },
        });
      }
      throw error;
    }
  }));

  // List delegations for the current user
  router.get('/', authenticate, asyncHandler(async (req: Request, res: Response) => {
    const delegations = await delegationService.listForUser(req.user!.id);
    res.json({ success: true, data: delegations });
  }));

  // Revoke a delegation
  router.delete('/:id', authenticate, requirePermission('delegation.manage'), validateParams(idParam), asyncHandler(async (req: Request, res: Response) => {
    const { id } = res.locals.params;

    const justification = typeof req.body?.justification === 'string' ? req.body.justification : null;
    await delegationService.revokeDelegation(id, req.user!.id, justification);
    res.json({ success: true, message: 'Delegation revoked' });
  }));

  return router;
};
