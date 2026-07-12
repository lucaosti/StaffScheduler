/**
 * Manager actor ("responsabile thread").
 *
 * Polls the pending approvals assigned to one head user and, for each item,
 * deterministically either:
 *   - decides it directly (tries approve first — which runs the real
 *     compliance/business checks — and falls back to reject if approve
 *     throws), or
 *   - for structure-assigned decisions still sitting with the default head
 *     assignee, delegates it to a random member of that structure instead of
 *     deciding it (exercising the delegation chain built earlier).
 *
 * Delegated items are picked up later by the delegate's own actor turn
 * (see `runDelegateCheck` in index.ts) — that's what makes "i responsabili"
 * plural: a delegated employee becomes a deciding thread too.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket } from 'mysql2/promise';
import { PendingApprovalService } from '../../src/services/PendingApprovalService';
import { ApprovalEngineService } from '../../src/services/ApprovalEngineService';
import { dispatchPendingApprovalDecision } from '../../src/services/PendingApprovalDispatch';
import { Rng } from './prng';
import { MegaLog } from './megaLog';

export interface Decision {
  pendingApprovalId: number;
  kind: 'time_off' | 'loan' | 'shift_swap' | 'change_request';
  entityId: number;
  decision: 'approved' | 'rejected' | 'delegated';
  decidedBy: number;
  delegatedTo?: number;
}

async function membersOf(pool: Pool, orgUnitId: number): Promise<number[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT user_id FROM user_org_units WHERE org_unit_id = ?`,
    [orgUnitId]
  );
  return rows.map((r) => r.user_id as number);
}

/**
 * Drains every pending approval currently assigned to `headUserId`. Safe to
 * call more than once (e.g. once before delegate turns, once after) — it
 * simply does nothing once the queue is empty.
 */
export async function runManagerActor(
  pool: Pool,
  log: MegaLog,
  runSeed: number,
  headUserId: number,
  delegateProbability = 0.35
): Promise<Decision[]> {
  const svc = new PendingApprovalService(pool);
  const engine = new ApprovalEngineService(pool);
  const rng = new Rng(runSeed).child(`manager:${headUserId}`);
  const decisions: Decision[] = [];

  const items = await svc.listForUser(headUserId, 'pending');
  for (const item of items) {
    const kind = item.targetEntityType === 'time_off_request'
      ? 'time_off'
      : item.targetEntityType === 'employee_loan'
        ? 'loan'
        : item.targetEntityType === 'shift_swap_request'
          ? 'shift_swap'
          : 'change_request';

    const isUnclaimedStructureItem =
      item.assignedToOrgUnitId !== null && item.assignedToUserId === headUserId && !item.openToStructure;

    if (isUnclaimedStructureItem && rng.chance(delegateProbability)) {
      const members = (await membersOf(pool, item.assignedToOrgUnitId!)).filter((u) => u !== headUserId);
      if (members.length > 0) {
        const delegateTo = rng.pick(members);
        try {
          await engine.delegateToPerson(item.id, headUserId, delegateTo);
          log.actor(
            'MANAGER',
            headUserId,
            `delegated pending approval #${item.id} (${kind} #${item.targetEntityId}) to employee #${delegateTo}`
          );
          log.count('decisions.delegated');
          decisions.push({
            pendingApprovalId: item.id,
            kind,
            entityId: item.targetEntityId!,
            decision: 'delegated',
            decidedBy: headUserId,
            delegatedTo: delegateTo,
          });
          continue;
        } catch (err) {
          log.actor('MANAGER', headUserId, `delegate attempt for #${item.id} failed: ${(err as Error).message}`);
        }
      }
    }

    decisions.push(await decideOne(pool, log, headUserId, item.id, kind, item.targetEntityId!));
  }
  return decisions;
}

/**
 * Decides every pending approval currently assigned directly to `userId` —
 * used both by the head (for items it chose to keep) and by any employee who
 * was delegated a decision, so a delegate becomes a deciding thread too.
 */
export async function runDelegateCheck(pool: Pool, log: MegaLog, userId: number): Promise<Decision[]> {
  const svc = new PendingApprovalService(pool);
  const items = await svc.listForUser(userId, 'pending');
  const decisions: Decision[] = [];
  for (const item of items) {
    const kind = item.targetEntityType === 'time_off_request'
      ? 'time_off'
      : item.targetEntityType === 'employee_loan'
        ? 'loan'
        : item.targetEntityType === 'shift_swap_request'
          ? 'shift_swap'
          : 'change_request';
    decisions.push(await decideOne(pool, log, userId, item.id, kind, item.targetEntityId!));
  }
  return decisions;
}

async function decideOne(
  pool: Pool,
  log: MegaLog,
  deciderUserId: number,
  pendingApprovalId: number,
  kind: Decision['kind'],
  entityId: number
): Promise<Decision> {
  try {
    await dispatchPendingApprovalDecision(pool, pendingApprovalId, deciderUserId, 'approved', '[SIM] auto-approved');
    log.actor('MANAGER', deciderUserId, `APPROVED pending approval #${pendingApprovalId} (${kind} #${entityId})`);
    log.count(`decisions.${kind}.approved`);
    return { pendingApprovalId, kind, entityId, decision: 'approved', decidedBy: deciderUserId };
  } catch (err) {
    // Approval genuinely failing business rules (e.g. the real compliance
    // check inside ShiftSwapService.approve) is a deterministic, expected
    // outcome — reject instead, using the same real code path.
    log.actor(
      'MANAGER',
      deciderUserId,
      `approve for #${pendingApprovalId} (${kind} #${entityId}) rejected by business rules: ${(err as Error).message} — rejecting instead`
    );
    try {
      await dispatchPendingApprovalDecision(
        pool,
        pendingApprovalId,
        deciderUserId,
        'rejected',
        `[SIM] auto-rejected: ${(err as Error).message}`
      );
      log.count(`decisions.${kind}.rejected`);
      return { pendingApprovalId, kind, entityId, decision: 'rejected', decidedBy: deciderUserId };
    } catch (rejectErr) {
      // Both approve and the reject fallback failed — this is itself a
      // finding, not a harness crash: it means the entity's approve() threw
      // *after* the pending_approval decision had already committed (a
      // decide-before-validate ordering bug — see the fix applied to
      // ShiftSwapService/TimeOffService for the known instances of this).
      // Log it plainly and move on so one bad request doesn't take down the
      // whole run.
      log.actor(
        'MANAGER',
        deciderUserId,
        `reject fallback for #${pendingApprovalId} (${kind} #${entityId}) ALSO failed: ${(rejectErr as Error).message} — leaving unresolved`
      );
      log.count(`decisions.${kind}.stuck`);
      return { pendingApprovalId, kind, entityId, decision: 'rejected', decidedBy: deciderUserId };
    }
  }
}
