/**
 * Shift swap requests (F01).
 *
 * Two-leg swap: employee A asks to exchange their assignment with employee B's.
 *
 * Two gates (#522), not one: the target (B) must accept before a manager
 * decides. A swap changes B's commitment with the same force as a re-solve,
 * and until #522 B had less say than a re-solve gives them — a re-solve at
 * least notifies. `pending_target` is the state before B has responded;
 * `pending` now means "B accepted, awaiting manager." The manager step is
 * unchanged: routed through the `approval_workflows`/`pending_approvals`
 * engine (`ShiftSwap.Request`, demo-seeded as `unit_structure` — assigned to
 * the requester's unit as a whole; the unit head can keep it, delegate it to
 * a team member, or open it to the team, see ApprovalEngineService), and its
 * `pending_approvals` row is created only once B accepts — there is nothing
 * for a manager to decide before that. Once the manager approves, this
 * atomically rewrites the `user_id` on both `shift_assignments` rows so
 * neither employee ends up unassigned mid-swap.
 *
 * @author Luca Ostinelli
 */

import { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors';
import { logger } from '../config/logger';
import { evaluateAssignmentCompliance } from './ComplianceEngine';
import { ApprovalEngineService } from './ApprovalEngineService';
import { NotificationService } from './NotificationService';
import { AuditLogService } from './AuditLogService';
import { DateUtils } from '../utils';
import { inClause } from '../utils/sql';

type SwapStatus = 'pending_target' | 'pending' | 'approved' | 'declined' | 'cancelled';
type DeclinedBy = 'target' | 'manager';

interface ShiftSwapRequest {
  id: number;
  requesterUserId: number;
  requesterAssignmentId: number;
  targetUserId: number;
  targetAssignmentId: number;
  status: SwapStatus;
  declinedBy: DeclinedBy | null;
  notes: string | null;
  reviewerId: number | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CreateSwapInput {
  requesterUserId: number;
  requesterAssignmentId: number;
  targetAssignmentId: number;
  notes?: string;
}

type OfferStatus = 'open' | 'claimed' | 'cancelled';

interface ShiftSwapOffer {
  id: number;
  assignmentId: number;
  userId: number;
  notes: string | null;
  status: OfferStatus;
  claimedBySwapRequestId: number | null;
  createdAt: string;
  updatedAt: string;
}

/** An open offer enriched with the shift details the board displays. */
export interface ShiftSwapOfferListing extends ShiftSwapOffer {
  userName: string;
  shiftId: number;
  date: string;
  startTime: string;
  endTime: string;
  departmentName: string;
}

const mapOfferRow = (row: RowDataPacket): ShiftSwapOffer => ({
  id: row.id as number,
  assignmentId: row.assignment_id as number,
  userId: row.user_id as number,
  notes: (row.notes as string | null) ?? null,
  status: row.status as OfferStatus,
  claimedBySwapRequestId: (row.claimed_by_swap_request_id as number | null) ?? null,
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
});

const mapRow = (row: RowDataPacket): ShiftSwapRequest => ({
  id: row.id as number,
  requesterUserId: row.requester_user_id as number,
  requesterAssignmentId: row.requester_assignment_id as number,
  targetUserId: row.target_user_id as number,
  targetAssignmentId: row.target_assignment_id as number,
  status: row.status as SwapStatus,
  declinedBy: (row.declined_by as DeclinedBy | null) ?? null,
  notes: (row.notes as string) ?? null,
  reviewerId: (row.reviewer_id as number | null) ?? null,
  reviewedAt: (row.reviewed_at as string | null) ?? null,
  reviewNotes: (row.review_notes as string | null) ?? null,
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
});

export class ShiftSwapService {
  private notifications: NotificationService;
  private audit: AuditLogService;
  private engine: ApprovalEngineService;

  constructor(private pool: Pool, notifications?: NotificationService) {
    this.notifications = notifications ?? new NotificationService(pool);
    this.audit = new AuditLogService(pool);
    this.engine = new ApprovalEngineService(pool);
  }

  /**
   * Creates a swap request in `pending_target`, awaiting the target's
   * response (#522) — not yet routed to a manager. Validates that the
   * requester owns `requesterAssignmentId`, that `targetAssignmentId`
   * belongs to a different user, and resolves the target user from the row.
   */
  async create(input: CreateSwapInput): Promise<ShiftSwapRequest> {
    // Resolve the approval gate BEFORE inserting the request: a swap whose
    // configured workflow cannot attach an approver (e.g. the requester has
    // no primary org unit for a unit-scoped step) would otherwise ask the
    // target to accept a request nobody could ever approve afterward. Fail
    // loudly instead — the actual pending_approvals row isn't created until
    // the target accepts (respondAsTarget), since there is nothing for a
    // manager to decide before that; this is a dry-run check only.
    const workflow = await this.engine.getWorkflowByChangeType('ShiftSwap.Request');
    if (workflow && workflow.steps.length > 0) {
      const orgUnitId = await this.engine.resolvePrimaryOrgUnitForUser(input.requesterUserId);
      const workflowCtx = { actorUserId: input.requesterUserId, orgUnitId: orgUnitId ?? undefined };
      if (!(await this.engine.canCreatePendingApprovalForStep(workflow.steps[0], workflowCtx))) {
        throw new ConflictError(
          'No approver could be resolved for this shift swap request — the requester has no primary organizational unit whose manager can decide it. Ask an administrator to fix the assignment.'
        );
      }
    }

    const conn = await this.pool.getConnection();
    let created: ShiftSwapRequest;
    try {
      await conn.beginTransaction();

      const [reqRows] = await conn.execute<RowDataPacket[]>(
        `SELECT id, user_id FROM shift_assignments WHERE id = ? LIMIT 1`,
        [input.requesterAssignmentId]
      );
      if (reqRows.length === 0) throw new NotFoundError('Requester assignment not found');
      if (reqRows[0].user_id !== input.requesterUserId) {
        throw new ConflictError('Requester does not own the requester assignment');
      }

      const [tgtRows] = await conn.execute<RowDataPacket[]>(
        `SELECT id, user_id FROM shift_assignments WHERE id = ? LIMIT 1`,
        [input.targetAssignmentId]
      );
      if (tgtRows.length === 0) throw new NotFoundError('Target assignment not found');
      const targetUserId = tgtRows[0].user_id as number;
      if (targetUserId === input.requesterUserId) {
        throw new ConflictError('Target assignment must belong to a different user');
      }

      const [insert] = await conn.execute<ResultSetHeader>(
        `INSERT INTO shift_swap_requests
            (requester_user_id, requester_assignment_id, target_user_id, target_assignment_id, notes, status)
         VALUES (?, ?, ?, ?, ?, 'pending_target')`,
        [
          input.requesterUserId,
          input.requesterAssignmentId,
          targetUserId,
          input.targetAssignmentId,
          input.notes ?? null,
        ]
      );
      await conn.commit();

      const row = await this.getById(insert.insertId);
      if (!row) throw new Error('Failed to retrieve created swap request');
      created = row;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    logger.info(`Shift swap created: id=${created.id} requester=${input.requesterUserId} target=${created.targetUserId}`);
    await this.audit.write({
      actorId: input.requesterUserId,
      action: 'shift_swap.create',
      entityType: 'shift_swap_request',
      entityId: created.id,
      description: `Shift swap requested: assignment ${input.requesterAssignmentId} ↔ ${input.targetAssignmentId}`,
      after: { id: created.id, status: 'pending_target', targetUserId: created.targetUserId },
    });

    // The whole point of #522: the target has to hear about this from the
    // system, not discover it by finding themselves working a different day.
    this.notifications.notifyAsync({
      userId: created.targetUserId,
      type: 'shiftswap.requested',
      title: 'Shift swap requested',
      body: `Someone wants to swap shifts with you (request #${created.id}). Review it to accept or decline.`,
    });

    return created;
  }

  /**
   * The target's response to a pending swap (#522) — the gate that used not
   * to exist. Accepting routes the request to the manager step (creating the
   * `pending_approvals` row the workflow needs, exactly as `create()` used
   * to do unconditionally); declining ends the request immediately, with no
   * manager involved, since there is nothing left to approve.
   */
  async respondAsTarget(
    id: number,
    targetUserId: number,
    accepted: boolean,
    notes: string | null = null
  ): Promise<ShiftSwapRequest> {
    const existing = await this.getById(id);
    if (!existing) throw new NotFoundError('Shift swap request not found');
    if (existing.targetUserId !== targetUserId) throw new ForbiddenError('Forbidden');
    if (existing.status !== 'pending_target') {
      throw new ConflictError(`Cannot respond to swap in status '${existing.status}'`);
    }

    if (!accepted) {
      const [result] = await this.pool.execute<ResultSetHeader>(
        `UPDATE shift_swap_requests
            SET status = 'declined', declined_by = 'target', review_notes = ?
          WHERE id = ? AND status = 'pending_target'`,
        [notes, id]
      );
      if (result.affectedRows === 0) {
        const current = await this.getById(id);
        throw new ConflictError(`Cannot respond to swap in status '${current?.status ?? 'unknown'}'`);
      }
      const declined = await this.getById(id);
      if (!declined) throw new Error('Failed to retrieve declined swap');
      await this.audit.write({
        actorId: targetUserId,
        action: 'shift_swap.decline_by_target',
        entityType: 'shift_swap_request',
        entityId: id,
        description: 'Shift swap declined by target',
        justification: notes ?? null,
        after: { status: 'declined', declinedBy: 'target' },
      });
      this.notifications.notifyAsync({
        userId: declined.requesterUserId,
        type: 'shiftswap.declined',
        title: 'Shift swap declined',
        body: `Your shift swap request #${declined.id} was declined.`,
      });
      return declined;
    }

    // Accepted: resolve the manager step now, not at creation — the
    // requester's org-unit membership (or the workflow itself) may have
    // changed in the time between request and response, so this is
    // re-checked rather than trusted from create()'s earlier dry run.
    const workflow = await this.engine.getWorkflowByChangeType('ShiftSwap.Request');
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE shift_swap_requests SET status = 'pending' WHERE id = ? AND status = 'pending_target'`,
      [id]
    );
    if (result.affectedRows === 0) {
      const current = await this.getById(id);
      throw new ConflictError(`Cannot respond to swap in status '${current?.status ?? 'unknown'}'`);
    }

    if (workflow && workflow.steps.length > 0) {
      const orgUnitId = await this.engine.resolvePrimaryOrgUnitForUser(existing.requesterUserId);
      const workflowCtx = { actorUserId: existing.requesterUserId, orgUnitId: orgUnitId ?? undefined };
      const pa = await this.engine.createPendingApprovalForStep(
        workflow.id,
        workflow.steps[0],
        { shiftSwapRequestId: id },
        workflowCtx
      );
      if (!pa) {
        // Resolution changed underneath us since create()'s dry run (e.g. a
        // concurrent org-unit membership removal). Revert to 'pending_target'
        // rather than leaving the swap silently stuck in 'pending' with no
        // pending_approvals row and nobody able to act on it — the target
        // can retry their acceptance once the underlying membership issue is
        // fixed, the same way create()'s own dry-run failure is retryable.
        await this.pool.execute(
          `UPDATE shift_swap_requests SET status = 'pending_target' WHERE id = ?`,
          [id]
        );
        throw new ConflictError(
          'No approver could be resolved for this shift swap request — approver resolution changed since it was created. Ask an administrator to fix the assignment, then try accepting again.'
        );
      }
    }

    const accepted_ = await this.getById(id);
    if (!accepted_) throw new Error('Failed to retrieve accepted swap');
    await this.audit.write({
      actorId: targetUserId,
      action: 'shift_swap.accept_by_target',
      entityType: 'shift_swap_request',
      entityId: id,
      description: 'Shift swap accepted by target, routed to manager',
      justification: notes ?? null,
      after: { status: 'pending' },
    });
    this.notifications.notifyAsync({
      userId: accepted_.requesterUserId,
      type: 'shiftswap.accepted_by_target',
      title: 'Shift swap accepted',
      body: `Your shift swap request #${accepted_.id} was accepted and is now awaiting manager approval.`,
    });
    return accepted_;
  }

  private async findPendingApprovalId(shiftSwapRequestId: number): Promise<number | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id FROM pending_approvals WHERE shift_swap_request_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`,
      [shiftSwapRequestId]
    );
    return rows.length === 0 ? null : ((rows[0] as any).id as number);
  }

  async getById(id: number): Promise<ShiftSwapRequest | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM shift_swap_requests WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows.length === 0 ? null : mapRow(rows[0]);
  }

  async list(
    filters: { userId?: number; status?: SwapStatus } = {}
  ): Promise<ShiftSwapRequest[]> {
    const conditions: string[] = [];
    const params: Array<string | number> = [];
    if (filters.userId !== undefined) {
      conditions.push('(requester_user_id = ? OR target_user_id = ?)');
      params.push(filters.userId, filters.userId);
    }
    if (filters.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    }
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM shift_swap_requests${where} ORDER BY created_at DESC LIMIT 500`,
      params
    );
    return rows.map(mapRow);
  }

  /**
   * Verifies both parties would still be compliant after the swap. Runs
   * against `this.pool` (no lock held) as an upfront dry run, and again
   * against a transaction connection with the row locked immediately before
   * commit — same query either way.
   */
  private async checkSwapCompliance(swap: ShiftSwapRequest, conn: PoolConnection | Pool = this.pool): Promise<void> {
    const [pairRows] = await conn.execute<RowDataPacket[]>(
      `SELECT sa.id AS assignment_id, sa.user_id, sa.shift_id, s.date, s.start_time, s.end_time
         FROM shift_assignments sa
         JOIN shifts s ON sa.shift_id = s.id
        WHERE sa.id IN (?, ?)`,
      [swap.requesterAssignmentId, swap.targetAssignmentId]
    );
    if (pairRows.length !== 2) throw new ConflictError('One or both assignments are gone');

    const reqRow = pairRows.find((r) => r.assignment_id === swap.requesterAssignmentId);
    const tgtRow = pairRows.find((r) => r.assignment_id === swap.targetAssignmentId);
    if (!reqRow || !tgtRow) throw new ConflictError('Assignment row mismatch');

    // Re-verify current ownership. A different swap approved between this
    // request's creation and its decision can reassign one of these two
    // rows to someone else entirely; blindly trusting the ids would silently
    // overwrite that third party's shift without ever checking their
    // compliance. Ownership must still match what the request was created
    // against.
    if (reqRow.user_id !== swap.requesterUserId) {
      throw new ConflictError(
        `Requester's assignment (#${reqRow.assignment_id}) has been reassigned to another user since this request was created`
      );
    }
    if (tgtRow.user_id !== swap.targetUserId) {
      throw new ConflictError(
        `Target's assignment (#${tgtRow.assignment_id}) has been reassigned to another user since this request was created`
      );
    }

    // shift_assignments has a UNIQUE (shift_id, user_id) constraint. If
    // either party already holds a *different* assignment on the shift
    // they'd be swapped onto, completing the swap would collide with it —
    // check this before compliance so it's caught in the same upfront dry
    // run, not left to fail the UPDATE after the decision already committed.
    const [dupRows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, user_id, shift_id FROM shift_assignments
        WHERE (shift_id = ? AND user_id = ? AND id != ?)
           OR (shift_id = ? AND user_id = ? AND id != ?)`,
      [tgtRow.shift_id, swap.requesterUserId, reqRow.assignment_id, reqRow.shift_id, swap.targetUserId, tgtRow.assignment_id]
    );
    if (dupRows.length > 0) {
      const dup = dupRows[0];
      const who = dup.user_id === swap.requesterUserId ? 'Requester' : 'Target';
      throw new ConflictError(`${who} is already assigned to the other party's shift (assignment #${dup.id})`);
    }

    // Compliance: requester would be working the target shift, target the requester's.
    const swappedRequester = await evaluateAssignmentCompliance(
      this.pool,
      swap.requesterUserId,
      {
        date: typeof tgtRow.date === 'string' ? tgtRow.date : DateUtils.fromMySQLDate(tgtRow.date as Date),
        startTime: tgtRow.start_time as string,
        endTime: tgtRow.end_time as string,
      },
      { excludeAssignmentId: swap.requesterAssignmentId }
    );
    if (!swappedRequester.ok) {
      throw new ConflictError(
        `Requester would violate compliance: ${swappedRequester.violations[0].code}`
      );
    }
    const swappedTarget = await evaluateAssignmentCompliance(
      this.pool,
      swap.targetUserId,
      {
        date: typeof reqRow.date === 'string' ? reqRow.date : DateUtils.fromMySQLDate(reqRow.date as Date),
        startTime: reqRow.start_time as string,
        endTime: reqRow.end_time as string,
      },
      { excludeAssignmentId: swap.targetAssignmentId }
    );
    if (!swappedTarget.ok) {
      throw new ConflictError(
        `Target would violate compliance: ${swappedTarget.violations[0].code}`
      );
    }
  }

  /**
   * Approves a swap. Atomically rewrites the `user_id` on both assignments,
   * runs compliance checks against the swapped state, and rolls back if
   * either user would violate working-time rules under the new shift.
   */
  async approve(
    id: number,
    reviewerId: number,
    notes: string | null = null,
    organizationName: string | null = null
  ): Promise<ShiftSwapRequest> {
    const existingForAuth = await this.getById(id);
    if (!existingForAuth) throw new NotFoundError('Shift swap request not found');
    if (existingForAuth.status !== 'pending') {
      throw new ConflictError(`Cannot approve swap in status '${existingForAuth.status}'`);
    }
    const pendingApprovalId = await this.findPendingApprovalId(id);
    if (pendingApprovalId === null) throw new ConflictError('No pending approval found for this shift swap');

    // A non-final step (an earlier approver in a multi-step workflow) has no
    // swap side effects to apply yet — just record the decision and let the
    // next step take over.
    if (!(await this.engine.wouldBeFinalStep(pendingApprovalId))) {
      await this.engine.decidePendingApproval(
        pendingApprovalId,
        reviewerId,
        'approved',
        notes,
        async () => {
          const orgUnitId = await this.engine.resolvePrimaryOrgUnitForUser(existingForAuth.requesterUserId);
          return { actorUserId: reviewerId, orgUnitId: orgUnitId ?? undefined };
        },
        organizationName
      );
      const refreshed = await this.getById(id);
      if (!refreshed) throw new Error('Failed to retrieve shift swap request');
      return refreshed;
    }

    // Final step: validate and apply the swap itself *before* deciding the
    // pending_approvals row. decidePendingApproval commits immediately via
    // its own connection — deciding first and validating after would leave
    // the decision permanently "approved" if the swap then failed
    // compliance (or an ownership/concurrency check), a stuck, unretryable
    // request (see managerActor.ts's handling of exactly this failure mode).
    // Doing the real work first means the only way to end up decided-but-
    // unapplied is the trivial status UPDATE below failing outright.
    const conn = await this.pool.getConnection();
    let swap: ShiftSwapRequest;
    try {
      await conn.beginTransaction();
      const [rows] = await conn.execute<RowDataPacket[]>(
        `SELECT * FROM shift_swap_requests WHERE id = ? FOR UPDATE`,
        [id]
      );
      if (rows.length === 0) throw new NotFoundError('Shift swap request not found');
      swap = mapRow(rows[0]);
      if (swap.status !== 'pending') {
        throw new ConflictError(`Cannot approve swap in status '${swap.status}'`);
      }

      // Lock every assignment currently held by either party before
      // checking compliance. checkSwapCompliance only validates the two
      // swapped shifts against each user's *total* weekly hours — a second,
      // concurrently-approved swap touching a *different* assignment of the
      // same user isn't visible to a plain (non-locking) read, so two swaps
      // that each look compliant in isolation could jointly push a user over
      // a weekly-hours limit. Locking the user's full assignment set forces
      // any overlapping concurrent approval to wait for this one to commit
      // (or roll back) before it can re-evaluate compliance itself.
      await conn.execute<RowDataPacket[]>(
        `SELECT id FROM shift_assignments WHERE user_id IN (?, ?) FOR UPDATE`,
        [swap.requesterUserId, swap.targetUserId]
      );

      await this.checkSwapCompliance(swap, conn);

      // Swap the user_id on both assignments.
      await conn.execute(
        `UPDATE shift_assignments SET user_id = ? WHERE id = ?`,
        [swap.targetUserId, swap.requesterAssignmentId]
      );
      await conn.execute(
        `UPDATE shift_assignments SET user_id = ? WHERE id = ?`,
        [swap.requesterUserId, swap.targetAssignmentId]
      );

      await this.engine.decidePendingApproval(
        pendingApprovalId,
        reviewerId,
        'approved',
        notes,
        async () => {
          const orgUnitId = await this.engine.resolvePrimaryOrgUnitForUser(swap.requesterUserId);
          return { actorUserId: reviewerId, orgUnitId: orgUnitId ?? undefined };
        },
        organizationName
      );

      await conn.execute(
        `UPDATE shift_swap_requests
            SET status = 'approved', reviewer_id = ?, reviewed_at = CURRENT_TIMESTAMP, review_notes = ?
          WHERE id = ?`,
        [reviewerId, notes, id]
      );

      await conn.commit();
      logger.info(`Shift swap approved: id=${id} reviewer=${reviewerId}`);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    const refreshed = await this.getById(id);
    if (!refreshed) throw new Error('Failed to retrieve approved swap');
    await this.audit.write({
      actorId: reviewerId,
      action: 'shift_swap.approve',
      entityType: 'shift_swap_request',
      entityId: id,
      description: `Shift swap approved`,
      justification: notes ?? null,
      after: { status: 'approved', reviewerId },
    });

    this.notifications.notifyAsync({
      userId: refreshed.requesterUserId,
      type: 'shiftswap.approved',
      title: 'Shift swap approved',
      body: `Your shift swap request #${refreshed.id} has been approved.`,
    });
    this.notifications.notifyAsync({
      userId: refreshed.targetUserId,
      type: 'shiftswap.approved',
      title: 'Shift swap approved',
      body: `A shift swap request involving your assignment (#${refreshed.id}) has been approved.`,
    });

    return refreshed;
  }

  async decline(
    id: number,
    reviewerId: number,
    notes: string | null = null,
    organizationName: string | null = null
  ): Promise<ShiftSwapRequest> {
    const existing = await this.getById(id);
    if (!existing) throw new NotFoundError('Shift swap request not found');
    if (existing.status !== 'pending') {
      throw new ConflictError(`Cannot decline swap in status '${existing.status}'`);
    }
    const pendingApprovalId = await this.findPendingApprovalId(id);
    if (pendingApprovalId === null) throw new ConflictError('No pending approval found for this shift swap');
    await this.engine.decidePendingApproval(
      pendingApprovalId,
      reviewerId,
      'rejected',
      notes,
      async () => {
        const orgUnitId = await this.engine.resolvePrimaryOrgUnitForUser(existing.requesterUserId);
        return { actorUserId: reviewerId, orgUnitId: orgUnitId ?? undefined };
      },
      organizationName
    );

    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE shift_swap_requests
          SET status = 'declined', declined_by = 'manager', reviewer_id = ?, reviewed_at = CURRENT_TIMESTAMP, review_notes = ?
        WHERE id = ? AND status = 'pending'`,
      [reviewerId, notes, id]
    );
    if (result.affectedRows === 0) {
      const existing = await this.getById(id);
      if (!existing) throw new NotFoundError('Shift swap request not found');
      throw new ConflictError(`Cannot decline swap in status '${existing.status}'`);
    }
    const refreshed = await this.getById(id);
    if (!refreshed) throw new Error('Failed to retrieve declined swap');
    await this.audit.write({
      actorId: reviewerId,
      action: 'shift_swap.decline',
      entityType: 'shift_swap_request',
      entityId: id,
      description: `Shift swap declined`,
      justification: notes ?? null,
      after: { status: 'declined', reviewerId },
    });

    this.notifications.notifyAsync({
      userId: refreshed.requesterUserId,
      type: 'shiftswap.declined',
      title: 'Shift swap declined',
      body: `Your shift swap request #${refreshed.id} has been declined.`,
    });

    return refreshed;
  }

  async cancel(id: number, requesterUserId: number): Promise<ShiftSwapRequest> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE shift_swap_requests
          SET status = 'cancelled'
        WHERE id = ? AND requester_user_id = ? AND status IN ('pending_target', 'pending')`,
      [id, requesterUserId]
    );
    if (result.affectedRows === 0) {
      const existing = await this.getById(id);
      if (!existing) throw new NotFoundError('Shift swap request not found');
      if (existing.requesterUserId !== requesterUserId) throw new ForbiddenError('Forbidden');
      throw new ConflictError(`Cannot cancel swap in status '${existing.status}'`);
    }
    const refreshed = await this.getById(id);
    if (!refreshed) throw new Error('Failed to retrieve cancelled swap');
    await this.audit.write({
      actorId: requesterUserId,
      action: 'shift_swap.cancel',
      entityType: 'shift_swap_request',
      entityId: id,
      description: `Shift swap request cancelled`,
      after: { status: 'cancelled' },
    });
    return refreshed;
  }

  // --------------------------------------------------------------------------
  // Open shift board — an employee posts one of their own assignments as
  // available, without naming a specific counterpart; any eligible peer can
  // claim it by offering one of their own back. Claiming produces a real
  // `shift_swap_requests` row through the exact same compliance/approval
  // machinery above; this section is a discovery layer on top of it, not a
  // second approval path.
  // --------------------------------------------------------------------------

  /**
   * Posts one of the caller's own assignments as available to swap.
   * Refuses a second concurrent open offer on the same assignment — a
   * duplicate would just be confusing on the board, not a new capability.
   */
  async createOpenOffer(userId: number, assignmentId: number, notes: string | null = null): Promise<ShiftSwapOffer> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT sa.id, sa.user_id, sa.status, s.date
         FROM shift_assignments sa
         JOIN shifts s ON s.id = sa.shift_id
        WHERE sa.id = ? LIMIT 1`,
      [assignmentId]
    );
    if (rows.length === 0) throw new NotFoundError('Assignment not found');
    if (rows[0].user_id !== userId) throw new ConflictError('You can only offer your own assignment');
    if (!['pending', 'confirmed'].includes(rows[0].status as string)) {
      throw new ConflictError(`Cannot offer an assignment in status '${rows[0].status}'`);
    }
    // A shift that has already run cannot be swapped — same reasoning as
    // SwapCandidateService's own horizon filter.
    const date = typeof rows[0].date === 'string' ? rows[0].date : DateUtils.fromMySQLDate(rows[0].date as Date);
    const [todayRows] = await this.pool.execute<RowDataPacket[]>(`SELECT CURDATE() AS today`);
    if (date < (todayRows[0].today as string)) {
      throw new ConflictError('Cannot offer a shift that has already passed');
    }

    const [existingOpen] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id FROM shift_swap_offers WHERE assignment_id = ? AND status = 'open' LIMIT 1`,
      [assignmentId]
    );
    if (existingOpen.length > 0) {
      throw new ConflictError('This assignment is already posted as an open offer');
    }

    const [insert] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO shift_swap_offers (assignment_id, user_id, notes, status) VALUES (?, ?, ?, 'open')`,
      [assignmentId, userId, notes ?? null]
    );
    const created = await this.getOpenOfferById(insert.insertId);
    if (!created) throw new Error('Failed to retrieve created open offer');
    logger.info(`Open shift offer created: id=${created.id} assignment=${assignmentId} user=${userId}`);
    await this.audit.write({
      actorId: userId,
      action: 'shift_swap.offer_create',
      entityType: 'shift_swap_offer',
      entityId: created.id,
      description: `Open shift offer posted for assignment ${assignmentId}`,
      justification: notes ?? null,
      after: { id: created.id, assignmentId, status: 'open' },
    });
    return created;
  }

  async getOpenOfferById(id: number): Promise<ShiftSwapOffer | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM shift_swap_offers WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows.length === 0 ? null : mapOfferRow(rows[0]);
  }

  /**
   * Open offers visible to the caller, enriched with shift details for the
   * board. `orgUnitIds` is the same "units this caller may see" scope
   * `SwapCandidateService` uses — `null` means unrestricted, an empty array
   * means nothing visible. `mine`, when true, restricts to the caller's own
   * offers instead of excluding them (there is no reason to show someone
   * their own offer as something to claim).
   */
  async listOpenOffers(
    callerId: number,
    orgUnitIds: number[] | null,
    mine = false
  ): Promise<ShiftSwapOfferListing[]> {
    if (!mine && orgUnitIds !== null && orgUnitIds.length === 0) {
      return [];
    }
    const scope = mine
      ? ' AND o.user_id = ?'
      : orgUnitIds === null
        ? ' AND o.user_id != ?'
        : ` AND o.user_id != ? AND d.org_unit_id IN (${inClause(orgUnitIds)})`;

    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT o.*, CONCAT(u.first_name, ' ', u.last_name) AS user_name,
              s.id AS shift_id, s.date, s.start_time, s.end_time,
              d.name AS department_name
         FROM shift_swap_offers o
         JOIN shift_assignments sa ON sa.id = o.assignment_id
         JOIN shifts s ON s.id = sa.shift_id
         JOIN departments d ON d.id = s.department_id
         JOIN users u ON u.id = o.user_id
        WHERE o.status = 'open'
          AND s.date >= CURDATE()${scope}
        ORDER BY s.date ASC, s.start_time ASC
        LIMIT 200`,
      [callerId]
    );
    return rows.map((row) => ({
      ...mapOfferRow(row),
      userName: row.user_name as string,
      shiftId: row.shift_id as number,
      date: DateUtils.toDateString(row.date as string | Date),
      startTime: row.start_time as string,
      endTime: row.end_time as string,
      departmentName: row.department_name as string,
    }));
  }

  async cancelOpenOffer(id: number, userId: number): Promise<ShiftSwapOffer> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE shift_swap_offers SET status = 'cancelled' WHERE id = ? AND user_id = ? AND status = 'open'`,
      [id, userId]
    );
    if (result.affectedRows === 0) {
      const existing = await this.getOpenOfferById(id);
      if (!existing) throw new NotFoundError('Open shift offer not found');
      if (existing.userId !== userId) throw new ForbiddenError('Forbidden');
      throw new ConflictError(`Cannot cancel offer in status '${existing.status}'`);
    }
    const refreshed = await this.getOpenOfferById(id);
    if (!refreshed) throw new Error('Failed to retrieve cancelled offer');
    await this.audit.write({
      actorId: userId,
      action: 'shift_swap.offer_cancel',
      entityType: 'shift_swap_offer',
      entityId: id,
      description: `Open shift offer cancelled`,
      after: { status: 'cancelled' },
    });
    return refreshed;
  }

  /**
   * Claims an open offer by pairing it with one of the claimer's own
   * assignments. Unlike `create()`, this goes straight to `pending` (skipping
   * `pending_target`): the offer owner already asked publicly to swap, and
   * offering a specific assignment back is the claimer's consent, in one
   * action — nothing is left for the claimer to separately accept.
   *
   * `requesterUserId`/`requesterAssignmentId` on the resulting row are the
   * offer owner's, matching `create()`'s convention that the requester is
   * whoever's ask this traces back to; the workflow's approver is resolved
   * from the offer owner's org unit for the same reason.
   */
  async claimOpenOffer(
    offerId: number,
    claimerUserId: number,
    claimerAssignmentId: number,
    notes: string | null = null
  ): Promise<ShiftSwapRequest> {
    const offer = await this.getOpenOfferById(offerId);
    if (!offer) throw new NotFoundError('Open shift offer not found');
    if (offer.status !== 'open') throw new ConflictError(`Cannot claim offer in status '${offer.status}'`);
    if (offer.userId === claimerUserId) throw new ConflictError('You cannot claim your own open offer');

    const [claimerRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id, user_id FROM shift_assignments WHERE id = ? LIMIT 1`,
      [claimerAssignmentId]
    );
    if (claimerRows.length === 0) throw new NotFoundError('Claimer assignment not found');
    if (claimerRows[0].user_id !== claimerUserId) {
      throw new ConflictError('Claimer does not own the offered assignment');
    }

    // Resolve the approval gate BEFORE creating the swap request — same dry
    // run reasoning as create(). Resolved from the offer owner's org unit
    // since they are the requester of record; reused after commit instead of
    // re-fetched, since nothing changes between resolving it here and using
    // it a few lines later within the same call.
    const workflow = await this.engine.getWorkflowByChangeType('ShiftSwap.Request');
    const orgUnitId = await this.engine.resolvePrimaryOrgUnitForUser(offer.userId);
    const workflowCtx = { actorUserId: offer.userId, orgUnitId: orgUnitId ?? undefined };
    if (workflow && workflow.steps.length > 0) {
      if (!(await this.engine.canCreatePendingApprovalForStep(workflow.steps[0], workflowCtx))) {
        throw new ConflictError(
          'No approver could be resolved for this shift swap — the offer owner has no primary organizational unit whose manager can decide it. Ask an administrator to fix the assignment.'
        );
      }
    }

    const conn = await this.pool.getConnection();
    let created: ShiftSwapRequest;
    try {
      await conn.beginTransaction();

      // Re-lock and re-check under the transaction: two people racing to
      // claim the same open offer must not both succeed.
      const [offerRows] = await conn.execute<RowDataPacket[]>(
        `SELECT status FROM shift_swap_offers WHERE id = ? FOR UPDATE`,
        [offerId]
      );
      if (offerRows.length === 0) throw new NotFoundError('Open shift offer not found');
      if (offerRows[0].status !== 'open') {
        throw new ConflictError(`Cannot claim offer in status '${offerRows[0].status}'`);
      }

      const [insert] = await conn.execute<ResultSetHeader>(
        `INSERT INTO shift_swap_requests
            (requester_user_id, requester_assignment_id, target_user_id, target_assignment_id, notes, status)
         VALUES (?, ?, ?, ?, ?, 'pending')`,
        [offer.userId, offer.assignmentId, claimerUserId, claimerAssignmentId, notes ?? null]
      );
      await conn.execute(
        `UPDATE shift_swap_offers SET status = 'claimed', claimed_by_swap_request_id = ? WHERE id = ?`,
        [insert.insertId, offerId]
      );

      await conn.commit();
      const row = await this.getById(insert.insertId);
      if (!row) throw new Error('Failed to retrieve created swap request');
      created = row;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    if (workflow && workflow.steps.length > 0) {
      const pa = await this.engine.createPendingApprovalForStep(
        workflow.id,
        workflow.steps[0],
        { shiftSwapRequestId: created.id },
        workflowCtx
      );
      if (!pa) {
        // Resolution changed underneath us since the check above (e.g. a
        // concurrent org-unit membership removal). Undo the whole claim
        // rather than leaving a 'pending' swap with no pending_approvals row
        // and nobody able to act on it — the offer goes back to 'open' so
        // it can be claimed again once the underlying issue is fixed.
        await this.pool.execute(`UPDATE shift_swap_requests SET status = 'cancelled' WHERE id = ?`, [created.id]);
        await this.pool.execute(
          `UPDATE shift_swap_offers SET status = 'open', claimed_by_swap_request_id = NULL WHERE id = ?`,
          [offerId]
        );
        throw new ConflictError(
          'No approver could be resolved for this shift swap — approver resolution changed since the offer was posted. Ask an administrator to fix the assignment, then try claiming again.'
        );
      }
    }

    logger.info(`Open shift offer claimed: offer=${offerId} swap=${created.id} claimer=${claimerUserId}`);
    await this.audit.write({
      actorId: claimerUserId,
      action: 'shift_swap.offer_claim',
      entityType: 'shift_swap_request',
      entityId: created.id,
      description: `Open shift offer #${offerId} claimed: assignment ${offer.assignmentId} ↔ ${claimerAssignmentId}`,
      justification: notes ?? null,
      after: { id: created.id, status: 'pending', offerId },
    });
    this.notifications.notifyAsync({
      userId: offer.userId,
      type: 'shiftswap.offer_claimed',
      title: 'Your open shift was claimed',
      body: `Someone claimed your open shift and offered a swap back (request #${created.id}), now awaiting manager approval.`,
    });

    return created;
  }
}
