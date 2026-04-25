/**
 * Shift swap requests (F01).
 *
 * Two-leg swap: employee A asks to exchange their assignment with employee B's.
 * The swap is finalised by a manager. Approval atomically rewrites the
 * `user_id` on both `shift_assignments` rows so neither employee ends up
 * unassigned mid-swap.
 *
 * @author Luca Ostinelli
 */

import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { logger } from '../config/logger';
import { evaluateAssignmentCompliance } from './ComplianceEngine';

export type SwapStatus = 'pending' | 'approved' | 'declined' | 'cancelled';

export interface ShiftSwapRequest {
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

export interface CreateSwapInput {
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
  constructor(private pool: Pool) {}

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
      return created;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
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
      `SELECT * FROM shift_swap_requests${where} ORDER BY created_at DESC`,
      params
    );
    return rows.map(mapRow);
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
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.execute<RowDataPacket[]>(
        `SELECT * FROM shift_swap_requests WHERE id = ? FOR UPDATE`,
        [id]
      );
      if (rows.length === 0) throw new Error('Shift swap request not found');
      const swap = mapRow(rows[0]);
      if (swap.status !== 'pending') {
        throw new Error(`Cannot approve swap in status '${swap.status}'`);
      }

      // Load the two assignments and the underlying shifts to feed compliance.
      const [pairRows] = await conn.execute<RowDataPacket[]>(
        `SELECT sa.id AS assignment_id, sa.user_id, s.date, s.start_time, s.end_time
           FROM shift_assignments sa
           JOIN shifts s ON sa.shift_id = s.id
          WHERE sa.id IN (?, ?)`,
        [swap.requesterAssignmentId, swap.targetAssignmentId]
      );
      if (pairRows.length !== 2) throw new Error('One or both assignments are gone');

      const reqRow = pairRows.find((r) => r.assignment_id === swap.requesterAssignmentId);
      const tgtRow = pairRows.find((r) => r.assignment_id === swap.targetAssignmentId);
      if (!reqRow || !tgtRow) throw new Error('Assignment row mismatch');

      // Compliance: requester would be working the target shift, target the requester's.
      const swappedRequester = await evaluateAssignmentCompliance(
        this.pool,
        swap.requesterUserId,
        {
          date: typeof tgtRow.date === 'string' ? tgtRow.date : new Date(tgtRow.date as Date).toISOString().slice(0, 10),
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
          date: typeof reqRow.date === 'string' ? reqRow.date : new Date(reqRow.date as Date).toISOString().slice(0, 10),
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

      // Swap the user_id on both assignments.
      await conn.execute(
        `UPDATE shift_assignments SET user_id = ? WHERE id = ?`,
        [swap.targetUserId, swap.requesterAssignmentId]
      );
      await conn.execute(
        `UPDATE shift_assignments SET user_id = ? WHERE id = ?`,
        [swap.requesterUserId, swap.targetAssignmentId]
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
    return refreshed;
  }

  async decline(
    id: number,
    reviewerId: number,
    notes: string | null = null
  ): Promise<ShiftSwapRequest> {
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
    return refreshed;
  }
}
