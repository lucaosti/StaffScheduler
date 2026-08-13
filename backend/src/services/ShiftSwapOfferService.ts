/**
 * Open shift board (F01) — an employee posts one of their own assignments as
 * available, without naming a specific counterpart; any eligible peer can
 * claim it by offering one of their own back.
 *
 * Split out of `ShiftSwapService`, which this depends on: claiming an offer
 * produces a real `shift_swap_requests` row through the exact same
 * compliance/approval machinery `ShiftSwapService` itself uses for a
 * targeted request — this class is a discovery layer on top of it, not a
 * second approval path, so it shares that machinery rather than duplicating
 * it.
 *
 * @author Luca Ostinelli
 */

import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { usingConnection } from '../utils/transaction';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors';
import { logger } from '../config/logger';
import { ApprovalWorkflowService } from './ApprovalWorkflowService';
import { ApproverResolutionService } from './ApproverResolutionService';
import { ApprovalDecisionService } from './ApprovalDecisionService';
import { NotificationService } from './NotificationService';
import { AuditLogService } from './AuditLogService';
import { DateUtils } from '../utils';
import { inClause } from '../utils/sql';
import { ShiftSwapService, ShiftSwapRequest } from './ShiftSwapService';

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

export class ShiftSwapOfferService {
  private notifications: NotificationService;
  private audit: AuditLogService;
  private workflows: ApprovalWorkflowService;
  private resolution: ApproverResolutionService;
  private decisions: ApprovalDecisionService;

  constructor(
    private pool: Pool,
    private swaps: ShiftSwapService,
    notifications?: NotificationService
  ) {
    this.notifications = notifications ?? new NotificationService(pool);
    this.audit = new AuditLogService(pool);
    this.workflows = new ApprovalWorkflowService(pool);
    this.resolution = new ApproverResolutionService(pool);
    this.decisions = new ApprovalDecisionService(pool);
  }

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
   * assignments. Unlike `ShiftSwapService.create()`, this goes straight to
   * `pending` (skipping `pending_target`): the offer owner already asked
   * publicly to swap, and offering a specific assignment back is the
   * claimer's consent, in one action — nothing is left for the claimer to
   * separately accept.
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
    // run reasoning as ShiftSwapService.create(). Resolved from the offer
    // owner's org unit since they are the requester of record; reused after
    // commit instead of re-fetched, since nothing changes between resolving
    // it here and using it a few lines later within the same call.
    const workflow = await this.workflows.getWorkflowByChangeType('ShiftSwap.Request');
    const orgUnitId = await this.resolution.resolvePrimaryOrgUnitForUser(offer.userId);
    const workflowCtx = { actorUserId: offer.userId, orgUnitId: orgUnitId ?? undefined };
    if (workflow && workflow.steps.length > 0) {
      if (!(await this.resolution.canCreatePendingApprovalForStep(workflow.steps[0], workflowCtx))) {
        throw new ConflictError(
          'No approver could be resolved for this shift swap — the offer owner has no primary organizational unit whose manager can decide it. Ask an administrator to fix the assignment.'
        );
      }
    }

    const created = await usingConnection(this.pool, async (conn) => {
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
        const row = await this.swaps.getById(insert.insertId);
        if (!row) throw new Error('Failed to retrieve created swap request');
        return row;
      } catch (err) {
        await conn.rollback();
        throw err;
      }
    });

    if (workflow && workflow.steps.length > 0) {
      const pa = await this.decisions.createPendingApprovalForStep(
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
