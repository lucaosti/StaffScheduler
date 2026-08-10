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
 * a team member, or open it to the team, see ApprovalDecisionService), and its
 * `pending_approvals` row is created only once B accepts — there is nothing
 * for a manager to decide before that. Once the manager approves, this
 * atomically rewrites the `user_id` on both `shift_assignments` rows so
 * neither employee ends up unassigned mid-swap.
 *
 * The "open shift board" — posting an assignment publicly rather than to a
 * named target — is a discovery layer built on top of this class, not a
 * second approval path; see `ShiftSwapOfferService`, which claims an open
 * offer by creating a real row here through `getById`.
 *
 * @author Luca Ostinelli
 */

import { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors';
import { logger } from '../config/logger';
import { evaluateAssignmentCompliance } from './ComplianceEngine';
import { ApprovalWorkflowService } from './ApprovalWorkflowService';
import { ApproverResolutionService } from './ApproverResolutionService';
import { ApprovalDecisionService } from './ApprovalDecisionService';
import { NotificationService } from './NotificationService';
import { AuditLogService } from './AuditLogService';
import { DateUtils } from '../utils';

export type SwapStatus = 'pending_target' | 'pending' | 'approved' | 'declined' | 'cancelled';
type DeclinedBy = 'target' | 'manager';

export interface ShiftSwapRequest {
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

/** Exported so `ShiftSwapOfferService` reads the same row shape when it claims an offer into a real request. */
export const mapShiftSwapRequestRow = (row: RowDataPacket): ShiftSwapRequest => ({
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
  private workflows: ApprovalWorkflowService;
  private resolution: ApproverResolutionService;
  private decisions: ApprovalDecisionService;

  constructor(private pool: Pool, notifications?: NotificationService) {
    this.notifications = notifications ?? new NotificationService(pool);
    this.audit = new AuditLogService(pool);
    this.workflows = new ApprovalWorkflowService(pool);
    this.resolution = new ApproverResolutionService(pool);
    this.decisions = new ApprovalDecisionService(pool);
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
    const workflow = await this.workflows.getWorkflowByChangeType('ShiftSwap.Request');
    if (workflow && workflow.steps.length > 0) {
      const orgUnitId = await this.resolution.resolvePrimaryOrgUnitForUser(input.requesterUserId);
      const workflowCtx = { actorUserId: input.requesterUserId, orgUnitId: orgUnitId ?? undefined };
      if (!(await this.resolution.canCreatePendingApprovalForStep(workflow.steps[0], workflowCtx))) {
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
    const workflow = await this.workflows.getWorkflowByChangeType('ShiftSwap.Request');
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE shift_swap_requests SET status = 'pending' WHERE id = ? AND status = 'pending_target'`,
      [id]
    );
    if (result.affectedRows === 0) {
      const current = await this.getById(id);
      throw new ConflictError(`Cannot respond to swap in status '${current?.status ?? 'unknown'}'`);
    }

    if (workflow && workflow.steps.length > 0) {
      const orgUnitId = await this.resolution.resolvePrimaryOrgUnitForUser(existing.requesterUserId);
      const workflowCtx = { actorUserId: existing.requesterUserId, orgUnitId: orgUnitId ?? undefined };
      const pa = await this.decisions.createPendingApprovalForStep(
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
    return rows.length === 0 ? null : mapShiftSwapRequestRow(rows[0]);
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
    return rows.map(mapShiftSwapRequestRow);
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
    if (!(await this.decisions.wouldBeFinalStep(pendingApprovalId))) {
      await this.decisions.decidePendingApproval(
        pendingApprovalId,
        reviewerId,
        'approved',
        notes,
        async () => {
          const orgUnitId = await this.resolution.resolvePrimaryOrgUnitForUser(existingForAuth.requesterUserId);
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
      swap = mapShiftSwapRequestRow(rows[0]);
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

      await this.decisions.decidePendingApproval(
        pendingApprovalId,
        reviewerId,
        'approved',
        notes,
        async () => {
          const orgUnitId = await this.resolution.resolvePrimaryOrgUnitForUser(swap.requesterUserId);
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
    await this.decisions.decidePendingApproval(
      pendingApprovalId,
      reviewerId,
      'rejected',
      notes,
      async () => {
        const orgUnitId = await this.resolution.resolvePrimaryOrgUnitForUser(existing.requesterUserId);
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
}
