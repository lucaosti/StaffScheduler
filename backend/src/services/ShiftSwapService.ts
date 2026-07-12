/**
 * Shift swap requests (F01).
 *
 * Two-leg swap: employee A asks to exchange their assignment with employee B's.
 * The decision is routed through the `approval_workflows`/`pending_approvals`
 * engine (`ShiftSwap.Request`, demo-seeded as `unit_structure` — assigned to
 * the requester's unit as a whole; the unit head can keep it, delegate it to
 * a team member, or open it to the team, see ApprovalEngineService). Once
 * that decision resolves as approved, this atomically rewrites the `user_id`
 * on both `shift_assignments` rows so neither employee ends up unassigned
 * mid-swap.
 *
 * @author Luca Ostinelli
 */

import { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { logger } from '../config/logger';
import { evaluateAssignmentCompliance } from './ComplianceEngine';
import { ApprovalEngineService } from './ApprovalEngineService';
import { NotificationService } from './NotificationService';
import { AuditLogService } from './AuditLogService';
import { DateUtils } from '../utils';

type SwapStatus = 'pending' | 'approved' | 'declined' | 'cancelled';

interface ShiftSwapRequest {
  id: number;
  requesterUserId: number;
  requesterAssignmentId: number;
  targetUserId: number;
  targetAssignmentId: number;
  status: SwapStatus;
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

const mapRow = (row: RowDataPacket): ShiftSwapRequest => ({
  id: row.id as number,
  requesterUserId: row.requester_user_id as number,
  requesterAssignmentId: row.requester_assignment_id as number,
  targetUserId: row.target_user_id as number,
  targetAssignmentId: row.target_assignment_id as number,
  status: row.status as SwapStatus,
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
   * Creates a pending swap request. Validates that the requester owns
   * `requesterAssignmentId`, that `targetAssignmentId` belongs to a
   * different user, and resolves the target user from the row.
   */
  async create(input: CreateSwapInput): Promise<ShiftSwapRequest> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

      const [reqRows] = await conn.execute<RowDataPacket[]>(
        `SELECT id, user_id FROM shift_assignments WHERE id = ? LIMIT 1`,
        [input.requesterAssignmentId]
      );
      if (reqRows.length === 0) throw new Error('Requester assignment not found');
      if (reqRows[0].user_id !== input.requesterUserId) {
        throw new Error('Requester does not own the requester assignment');
      }

      const [tgtRows] = await conn.execute<RowDataPacket[]>(
        `SELECT id, user_id FROM shift_assignments WHERE id = ? LIMIT 1`,
        [input.targetAssignmentId]
      );
      if (tgtRows.length === 0) throw new Error('Target assignment not found');
      const targetUserId = tgtRows[0].user_id as number;
      if (targetUserId === input.requesterUserId) {
        throw new Error('Target assignment must belong to a different user');
      }

      const [insert] = await conn.execute<ResultSetHeader>(
        `INSERT INTO shift_swap_requests
            (requester_user_id, requester_assignment_id, target_user_id, target_assignment_id, notes, status)
         VALUES (?, ?, ?, ?, ?, 'pending')`,
        [
          input.requesterUserId,
          input.requesterAssignmentId,
          targetUserId,
          input.targetAssignmentId,
          input.notes ?? null,
        ]
      );
      await conn.commit();

      const created = await this.getById(insert.insertId);
      if (!created) throw new Error('Failed to retrieve created swap request');
      logger.info(`Shift swap created: id=${created.id} requester=${input.requesterUserId}`);
      await this.audit.write({
        actorId: input.requesterUserId,
        action: 'shift_swap.create',
        entityType: 'shift_swap_request',
        entityId: created.id,
        description: `Shift swap requested: assignment ${input.requesterAssignmentId} ↔ ${input.targetAssignmentId}`,
        after: { id: created.id, status: 'pending', targetUserId: created.targetUserId },
      });

      const workflow = await this.engine.getWorkflowByChangeType('ShiftSwap.Request');
      if (workflow && workflow.steps.length > 0) {
        const orgUnitId = await this.engine.resolvePrimaryOrgUnitForUser(input.requesterUserId);
        await this.engine.createPendingApprovalForStep(
          workflow.id,
          workflow.steps[0],
          { shiftSwapRequestId: created.id },
          { actorUserId: input.requesterUserId, orgUnitId: orgUnitId ?? undefined }
        );
      }

      return created;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
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
    if (pairRows.length !== 2) throw new Error('One or both assignments are gone');

    const reqRow = pairRows.find((r) => r.assignment_id === swap.requesterAssignmentId);
    const tgtRow = pairRows.find((r) => r.assignment_id === swap.targetAssignmentId);
    if (!reqRow || !tgtRow) throw new Error('Assignment row mismatch');

    // Re-verify current ownership. A different swap approved between this
    // request's creation and its decision can reassign one of these two
    // rows to someone else entirely; blindly trusting the ids would silently
    // overwrite that third party's shift without ever checking their
    // compliance. Ownership must still match what the request was created
    // against.
    if (reqRow.user_id !== swap.requesterUserId) {
      throw new Error(
        `Requester's assignment (#${reqRow.assignment_id}) has been reassigned to another user since this request was created`
      );
    }
    if (tgtRow.user_id !== swap.targetUserId) {
      throw new Error(
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
      throw new Error(`${who} is already assigned to the other party's shift (assignment #${dup.id})`);
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
      throw new Error(
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
      throw new Error(
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
    notes: string | null = null
  ): Promise<ShiftSwapRequest> {
    const existingForAuth = await this.getById(id);
    if (!existingForAuth) throw new Error('Shift swap request not found');
    if (existingForAuth.status !== 'pending') {
      throw new Error(`Cannot approve swap in status '${existingForAuth.status}'`);
    }
    const pendingApprovalId = await this.findPendingApprovalId(id);
    if (pendingApprovalId === null) throw new Error('No pending approval found for this shift swap');

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
        }
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
      if (rows.length === 0) throw new Error('Shift swap request not found');
      swap = mapRow(rows[0]);
      if (swap.status !== 'pending') {
        throw new Error(`Cannot approve swap in status '${swap.status}'`);
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
        }
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
    notes: string | null = null
  ): Promise<ShiftSwapRequest> {
    const existing = await this.getById(id);
    if (!existing) throw new Error('Shift swap request not found');
    if (existing.status !== 'pending') {
      throw new Error(`Cannot decline swap in status '${existing.status}'`);
    }
    const pendingApprovalId = await this.findPendingApprovalId(id);
    if (pendingApprovalId === null) throw new Error('No pending approval found for this shift swap');
    await this.engine.decidePendingApproval(
      pendingApprovalId,
      reviewerId,
      'rejected',
      notes,
      async () => {
        const orgUnitId = await this.engine.resolvePrimaryOrgUnitForUser(existing.requesterUserId);
        return { actorUserId: reviewerId, orgUnitId: orgUnitId ?? undefined };
      }
    );

    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE shift_swap_requests
          SET status = 'declined', reviewer_id = ?, reviewed_at = CURRENT_TIMESTAMP, review_notes = ?
        WHERE id = ? AND status = 'pending'`,
      [reviewerId, notes, id]
    );
    if (result.affectedRows === 0) {
      const existing = await this.getById(id);
      if (!existing) throw new Error('Shift swap request not found');
      throw new Error(`Cannot decline swap in status '${existing.status}'`);
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
        WHERE id = ? AND requester_user_id = ? AND status = 'pending'`,
      [id, requesterUserId]
    );
    if (result.affectedRows === 0) {
      const existing = await this.getById(id);
      if (!existing) throw new Error('Shift swap request not found');
      if (existing.requesterUserId !== requesterUserId) throw new Error('Forbidden');
      throw new Error(`Cannot cancel swap in status '${existing.status}'`);
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
