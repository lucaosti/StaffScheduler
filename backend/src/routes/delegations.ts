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
import { authenticate, userHasPermission } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateParams, validateBody } from '../middleware/validation';
import { idParam, createDelegationBody, auditJustificationBody } from '../schemas';

export const createDelegationsRouter = (pool: Pool): Router => {
  const router = Router();
  const delegationService = new DelegationService(pool);

  /**
   * Creates a delegation of the caller's own permissions.
   *
   * TWO CODES, NOT A HIERARCHY. `delegation.manage` is for a deployment where
   * delegation is an administered act; `delegation.self` is for one where each
   * person may pass on their own authority. Either admits the caller here,
   * because neither changes what may be delegated: the route has never accepted
   * a delegator other than the caller, and the service refuses any code the
   * delegator does not hold. `delegation.manage` was therefore never a limit on
   * WHAT could be delegated, only on WHO was allowed to delegate at all — which
   * is exactly the question the new code answers with the right meaning.
   */
  router.post('/', authenticate, validateBody(createDelegationBody), asyncHandler(async (req: Request, res: Response) => {
    try {
      const actor = req.user!;
      if (!userHasPermission(actor, 'delegation.manage') && !userHasPermission(actor, 'delegation.self')) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Not allowed to create delegations' },
        });
      }
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

  /**
   * Revokes a delegation. Authenticated only — the SERVICE is the authority.
   *
   * `revokeDelegation` already refuses anyone who is not the delegator, which is
   * the correct rule and a stricter one than any permission could express. The
   * `delegation.manage` gate that used to sit here added nothing to it and took
   * something away: someone who created a delegation and later lost that
   * permission could no longer revoke it, so a delegation they granted outlived
   * their ability to withdraw it. Being able to take back authority you handed
   * out must not depend on a permission you might lose.
   */
  router.delete('/:id', authenticate, validateParams(idParam), validateBody(auditJustificationBody), asyncHandler(async (req: Request, res: Response) => {
    const { id } = res.locals.params;

    const justification = res.locals.body.justification ?? null;
    await delegationService.revokeDelegation(id, req.user!.id, justification);
    res.json({ success: true, message: 'Delegation revoked' });
  }));

  return router;
};
