/**
 * Time-off / leave management (F02).
 *
 * Workflow:
 *   1. Employee creates a `time_off_requests` row with status `pending`,
 *      plus the first `pending_approvals` row for the `TimeOff.Request`
 *      workflow (see ApprovalEngineService). That step is `unit_manager` by
 *      default, so it resolves straight to the requester's unit manager —
 *      but the workflow can be reconfigured to `unit_structure`, in which
 *      case the unit's head decides whether to keep, delegate, or open the
 *      decision to their team (ApprovalEngineService.keepForSelf /
 *      delegateToPerson / openToStructure).
 *   2. Whoever is authorized to decide the pending_approvals row approves or
 *      rejects it. Approval inserts a row into `user_unavailability` and
 *      links it back via `unavailability_id`.
 *   3. Rejected and cancelled requests stay in the table for the audit trail
 *      but never produce an unavailability block.
 *
 * The service is the single writer to `time_off_requests`. Routes are thin.
 *
 * @author Luca Ostinelli
 */

import { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { logger } from '../config/logger';
import { AuditLogService } from './AuditLogService';
import { ApprovalEngineService } from './ApprovalEngineService';
import { NotificationService } from './NotificationService';
import { DateUtils } from '../utils';

type TimeOffType = 'vacation' | 'sick' | 'personal' | 'other';
type TimeOffStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

interface TimeOffRequest {
  id: number;
  userId: number;
  startDate: string;
  endDate: string;
  type: TimeOffType;
  reason: string | null;
  status: TimeOffStatus;
  reviewerId: number | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  unavailabilityId: number | null;
  createdAt: string;
  updatedAt: string;
}

interface CreateTimeOffInput {
  userId: number;
  startDate: string;
  endDate: string;
  type?: TimeOffType;
  reason?: string;
}

interface ListTimeOffFilters {
  userId?: number;
  status?: TimeOffStatus;
  /** When set, only return requests overlapping this window. */
  rangeStart?: string;
  rangeEnd?: string;
}

const mapRow = (row: RowDataPacket): TimeOffRequest => ({
  id: row.id as number,
  userId: row.user_id as number,
  startDate:
    typeof row.start_date === 'string' ? row.start_date : DateUtils.fromMySQLDate(row.start_date),
  endDate:
    typeof row.end_date === 'string' ? row.end_date : DateUtils.fromMySQLDate(row.end_date),
  type: row.type as TimeOffType,
  reason: (row.reason as string) ?? null,
  status: row.status as TimeOffStatus,
  reviewerId: (row.reviewer_id as number | null) ?? null,
  reviewedAt: (row.reviewed_at as string | null) ?? null,
  reviewNotes: (row.review_notes as string | null) ?? null,
  unavailabilityId: (row.unavailability_id as number | null) ?? null,
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
});

export class TimeOffService {
  private audit: AuditLogService;
  private engine: ApprovalEngineService;
  private notifications: NotificationService;
  constructor(private pool: Pool) {
    this.audit = new AuditLogService(pool);
    this.engine = new ApprovalEngineService(pool);
    this.notifications = new NotificationService(pool);
  }

  /** Creates a new pending request. Range is validated; reason is optional. */
  async create(input: CreateTimeOffInput): Promise<TimeOffRequest> {
    if (!input.startDate || !input.endDate) {
      throw new Error('startDate and endDate are required');
    }
    if (input.endDate < input.startDate) {
      throw new Error('endDate must be on or after startDate');
    }

    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO time_off_requests (user_id, start_date, end_date, type, reason, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [
        input.userId,
        input.startDate,
        input.endDate,
        input.type ?? 'vacation',
        input.reason ?? null,
      ]
    );
    const created = await this.getById(result.insertId);
    if (!created) throw new Error('Failed to retrieve created time-off request');
    logger.info(`Time-off request created: id=${created.id} user=${input.userId}`);
    await this.audit.write({
      actorId: input.userId,
      action: 'time_off.create',
      entityType: 'time_off_request',
      entityId: created.id,
      description: `Time-off request created (${input.type ?? 'vacation'}) from ${input.startDate} to ${input.endDate}`,
      justification: input.reason ?? null,
      after: { id: created.id, status: created.status, startDate: created.startDate, endDate: created.endDate },
    });

    const workflow = await this.engine.getWorkflowByChangeType('TimeOff.Request');
    if (workflow && workflow.steps.length > 0) {
      const orgUnitId = await this.engine.resolvePrimaryOrgUnitForUser(input.userId);
      await this.engine.createPendingApprovalForStep(
        workflow.id,
        workflow.steps[0],
        { timeOffRequestId: created.id },
        { actorUserId: input.userId, orgUnitId: orgUnitId ?? undefined }
      );
    }

    return created;
  }

  async getById(id: number): Promise<TimeOffRequest | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM time_off_requests WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows.length === 0 ? null : mapRow(rows[0]);
  }

  async list(filters: ListTimeOffFilters = {}): Promise<TimeOffRequest[]> {
    const conditions: string[] = [];
    const params: Array<string | number> = [];

    if (filters.userId !== undefined) {
      conditions.push('user_id = ?');
      params.push(filters.userId);
    }
    if (filters.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    }
    if (filters.rangeStart && filters.rangeEnd) {
      conditions.push('start_date <= ? AND end_date >= ?');
      params.push(filters.rangeEnd, filters.rangeStart);
    }

    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM time_off_requests${where} ORDER BY start_date DESC LIMIT 500`,
      params
    );
    return rows.map(mapRow);
  }

  private async findPendingApprovalId(timeOffRequestId: number): Promise<number | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id FROM pending_approvals WHERE time_off_request_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`,
      [timeOffRequestId]
    );
    return rows.length === 0 ? null : ((rows[0] as any).id as number);
  }

  /**
   * Approves a pending request. Authorization is delegated to
   * `ApprovalEngineService.decidePendingApproval` (assignee, or any member
   * of the structure once opened). Only once the workflow is fully resolved
   * (`isFinalStep`) does this insert the `user_unavailability` row — atomic
   * with the status flip, in the same transaction.
   */
  /**
   * Throws if `userId` already has a `user_unavailability` row for the exact
   * same range (the table's unique constraint). Called both as an upfront
   * dry run (before the workflow decision commits) and again with the row
   * lock held, mirroring the same fix applied to
   * ShiftSwapService.approve — see that file's `checkSwapCompliance` for the
   * original bug this pattern fixes: without the dry run, a duplicate-range
   * request could get its pending_approval committed "approved" and then
   * fail on the INSERT, leaving it permanently stuck (approved decision,
   * never-applied side effect, unretryable).
   */
  private async checkNoDuplicateUnavailability(
    conn: Pool | PoolConnection,
    userId: number,
    startDate: string,
    endDate: string
  ): Promise<void> {
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT id FROM user_unavailability WHERE user_id = ? AND start_date = ? AND end_date = ? LIMIT 1`,
      [userId, startDate, endDate]
    );
    if (rows.length > 0) {
      throw new Error(`User already has unavailability recorded for ${startDate}..${endDate}`);
    }
  }

  async approve(
    id: number,
    reviewerId: number,
    notes: string | null = null
  ): Promise<TimeOffRequest> {
    const existing = await this.getById(id);
    if (!existing) throw new Error('Time-off request not found');
    if (existing.status !== 'pending') {
      throw new Error(`Cannot approve request in status '${existing.status}'`);
    }

    const pendingApprovalId = await this.findPendingApprovalId(id);
    if (pendingApprovalId === null) {
      throw new Error('No pending approval found for this time-off request');
    }

    await this.checkNoDuplicateUnavailability(this.pool, existing.userId, existing.startDate, existing.endDate);

    const decision = await this.engine.decidePendingApproval(
      pendingApprovalId,
      reviewerId,
      'approved',
      notes,
      async () => ({ actorUserId: reviewerId })
    );

    if (!decision.isFinalStep) {
      const refreshed = await this.getById(id);
      if (!refreshed) throw new Error('Failed to retrieve time-off request');
      return refreshed;
    }

    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.execute<RowDataPacket[]>(
        `SELECT * FROM time_off_requests WHERE id = ? FOR UPDATE`,
        [id]
      );
      if (rows.length === 0) throw new Error('Time-off request not found');
      const current = mapRow(rows[0]);
      await this.checkNoDuplicateUnavailability(conn, current.userId, current.startDate, current.endDate);

      const [unavailRes] = await conn.execute<ResultSetHeader>(
        `INSERT INTO user_unavailability (user_id, start_date, end_date, reason)
         VALUES (?, ?, ?, ?)`,
        [
          current.userId,
          current.startDate,
          current.endDate,
          `[time-off-request:${id}] ${current.reason ?? current.type}`,
        ]
      );

      await conn.execute(
        `UPDATE time_off_requests
            SET status = 'approved',
                reviewer_id = ?,
                reviewed_at = CURRENT_TIMESTAMP,
                review_notes = ?,
                unavailability_id = ?
          WHERE id = ?`,
        [reviewerId, notes, unavailRes.insertId, id]
      );

      await conn.commit();
      logger.info(`Time-off request approved: id=${id} reviewer=${reviewerId}`);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    const refreshed = await this.getById(id);
    if (!refreshed) throw new Error('Failed to retrieve approved request');
    await this.audit.write({
      actorId: reviewerId,
      action: 'time_off.approve',
      entityType: 'time_off_request',
      entityId: id,
      description: `Time-off request approved`,
      justification: notes ?? null,
      after: { status: 'approved', reviewerId, unavailabilityId: refreshed.unavailabilityId },
    });
    this.notifications.notifyAsync({
      userId: refreshed.userId,
      type: 'time_off.approved',
      title: 'Time-off request approved',
      body: `Your ${refreshed.type} request for ${refreshed.startDate} to ${refreshed.endDate} has been approved.`,
    });
    return refreshed;
  }

  async reject(
    id: number,
    reviewerId: number,
    notes: string | null = null
  ): Promise<TimeOffRequest> {
    const existing = await this.getById(id);
    if (!existing) throw new Error('Time-off request not found');
    if (existing.status !== 'pending') {
      throw new Error(`Cannot reject request in status '${existing.status}'`);
    }

    const pendingApprovalId = await this.findPendingApprovalId(id);
    if (pendingApprovalId === null) {
      throw new Error('No pending approval found for this time-off request');
    }

    const decision = await this.engine.decidePendingApproval(
      pendingApprovalId,
      reviewerId,
      'rejected',
      notes,
      async () => ({ actorUserId: reviewerId })
    );
    void decision;

    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE time_off_requests
          SET status = 'rejected',
              reviewer_id = ?,
              reviewed_at = CURRENT_TIMESTAMP,
              review_notes = ?
        WHERE id = ? AND status = 'pending'`,
      [reviewerId, notes, id]
    );
    if (result.affectedRows === 0) {
      const current = await this.getById(id);
      throw new Error(`Cannot reject request in status '${current?.status ?? existing.status}'`);
    }
    logger.info(`Time-off request rejected: id=${id} reviewer=${reviewerId}`);
    const refreshed = await this.getById(id);
    if (!refreshed) throw new Error('Failed to retrieve rejected request');
    await this.audit.write({
      actorId: reviewerId,
      action: 'time_off.reject',
      entityType: 'time_off_request',
      entityId: id,
      description: `Time-off request rejected`,
      justification: notes ?? null,
      after: { status: 'rejected', reviewerId },
    });
    this.notifications.notifyAsync({
      userId: refreshed.userId,
      type: 'time_off.rejected',
      title: 'Time-off request rejected',
      body: notes ?? `Your ${refreshed.type} request for ${refreshed.startDate} to ${refreshed.endDate} was rejected.`,
    });
    return refreshed;
  }

  /**
   * Cancellation by the requesting user. Only allowed while still pending,
   * to avoid unilaterally undoing an already-approved time off (which would
   * orphan the unavailability row).
   */
  async cancel(id: number, requesterId: number): Promise<TimeOffRequest> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE time_off_requests
          SET status = 'cancelled'
        WHERE id = ? AND user_id = ? AND status = 'pending'`,
      [id, requesterId]
    );
    if (result.affectedRows === 0) {
      const existing = await this.getById(id);
      if (!existing) throw new Error('Time-off request not found');
      if (existing.userId !== requesterId) throw new Error('Forbidden');
      throw new Error(`Cannot cancel request in status '${existing.status}'`);
    }
    logger.info(`Time-off request cancelled: id=${id} user=${requesterId}`);
    const refreshed = await this.getById(id);
    if (!refreshed) throw new Error('Failed to retrieve cancelled request');
    await this.audit.write({
      actorId: requesterId,
      action: 'time_off.cancel',
      entityType: 'time_off_request',
      entityId: id,
      description: `Time-off request cancelled`,
      after: { status: 'cancelled' },
    });
    return refreshed;
  }
}
