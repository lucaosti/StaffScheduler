/**
 * Change Request Service
 *
 * Enables subordinates to propose changes that, once approved and applied,
 * are attributed to the authority holder (approver) in the audit log.
 * The proposer's identity is recorded in on_behalf_of_user_id so the full
 * chain of custody is always auditable.
 *
 * Lifecycle:  pending → approved → applied
 *                      → rejected
 *             pending → cancelled
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import {
  ChangeRequest,
  ChangeRequestStatus,
  CreateChangeRequestInput,
  ChangeRequestFilters,
} from '../types';
import { logger } from '../config/logger';
import { AuditLogService } from './AuditLogService';

const mapRow = (row: RowDataPacket): ChangeRequest => ({
  id: row.id as number,
  changeType: row.change_type as string,
  proposerUserId: row.proposer_user_id as number,
  targetEntityType: row.target_entity_type as string,
  targetEntityId: (row.target_entity_id as number | null) ?? null,
  proposedPayload: (() => {
    try { return typeof row.proposed_payload === 'string' ? JSON.parse(row.proposed_payload) : row.proposed_payload; } catch { return {}; }
  })(),
  justification: (row.justification as string | null) ?? null,
  status: row.status as ChangeRequestStatus,
  approverUserId: (row.approver_user_id as number | null) ?? null,
  approvedAt: (row.approved_at as string | null) ?? null,
  rejectedAt: (row.rejected_at as string | null) ?? null,
  rejectionReason: (row.rejection_reason as string | null) ?? null,
  appliedAt: (row.applied_at as string | null) ?? null,
  onBehalfOfUserId: (row.on_behalf_of_user_id as number | null) ?? null,
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
});

export class ChangeRequestService {
  private audit: AuditLogService;

  constructor(private pool: Pool) {
    this.audit = new AuditLogService(pool);
  }

  // --------------------------------------------------------------------------
  // Read
  // --------------------------------------------------------------------------

  async list(filters: ChangeRequestFilters = {}): Promise<{ total: number; items: ChangeRequest[] }> {
    const conditions: string[] = [];
    const params: Array<string | number> = [];

    if (filters.proposerUserId !== undefined) {
      conditions.push('proposer_user_id = ?');
      params.push(filters.proposerUserId);
    }
    if (filters.approverUserId !== undefined) {
      conditions.push('approver_user_id = ?');
      params.push(filters.approverUserId);
    }
    if (filters.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    }
    if (filters.changeType) {
      conditions.push('change_type = ?');
      params.push(filters.changeType);
    }
    if (filters.targetEntityType) {
      conditions.push('target_entity_type = ?');
      params.push(filters.targetEntityType);
    }

    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';

    const [countRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM change_requests${where}`,
      params
    );
    const total = (countRows[0] as { c: number }).c;

    const limit = Math.max(1, Math.min(500, filters.limit ?? 100));
    const offset = Math.max(0, filters.offset ?? 0);

    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM change_requests${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return { total, items: rows.map(mapRow) };
  }

  async getById(id: number): Promise<ChangeRequest | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT * FROM change_requests WHERE id = ? LIMIT 1',
      [id]
    );
    return rows.length === 0 ? null : mapRow(rows[0]);
  }

  // --------------------------------------------------------------------------
  // Lifecycle mutations
  // --------------------------------------------------------------------------

  async create(input: CreateChangeRequestInput, proposerUserId: number): Promise<ChangeRequest> {
    const [res] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO change_requests
         (change_type, proposer_user_id, target_entity_type, target_entity_id,
          proposed_payload, justification, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [
        input.changeType,
        proposerUserId,
        input.targetEntityType,
        input.targetEntityId ?? null,
        JSON.stringify(input.proposedPayload),
        input.justification ?? null,
      ]
    );

    const created = await this.getById(res.insertId);
    if (!created) throw new Error('Failed to retrieve created change request');

    await this.audit.write({
      actorId: proposerUserId,
      action: 'change_request.create',
      entityType: 'change_request',
      entityId: created.id,
      description: `Change request proposed: ${created.changeType} on ${created.targetEntityType}`,
      justification: input.justification ?? undefined,
      after: created as unknown as Record<string, unknown>,
    });

    logger.info(`Change request created: id=${created.id} type=${created.changeType} proposer=${proposerUserId}`);
    return created;
  }

  async approve(id: number, approverUserId: number, justification?: string | null): Promise<ChangeRequest> {
    const existing = await this.getById(id);
    if (!existing) throw new Error('Change request not found');
    if (existing.status !== 'pending') {
      throw new Error(`Cannot approve a change request in '${existing.status}' status`);
    }

    await this.pool.execute(
      `UPDATE change_requests
          SET status = 'approved', approver_user_id = ?, approved_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [approverUserId, id]
    );

    const updated = await this.getById(id);
    if (!updated) throw new Error('Failed to retrieve updated change request');

    await this.audit.write({
      actorId: approverUserId,
      action: 'change_request.approve',
      entityType: 'change_request',
      entityId: id,
      description: `Change request approved: ${existing.changeType} on ${existing.targetEntityType}`,
      justification: justification ?? undefined,
      before: existing as unknown as Record<string, unknown>,
      after: updated as unknown as Record<string, unknown>,
    });

    return updated;
  }

  async reject(id: number, approverUserId: number, rejectionReason: string): Promise<ChangeRequest> {
    const existing = await this.getById(id);
    if (!existing) throw new Error('Change request not found');
    if (existing.status !== 'pending') {
      throw new Error(`Cannot reject a change request in '${existing.status}' status`);
    }

    await this.pool.execute(
      `UPDATE change_requests
          SET status = 'rejected', approver_user_id = ?, rejected_at = CURRENT_TIMESTAMP,
              rejection_reason = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [approverUserId, rejectionReason, id]
    );

    const updated = await this.getById(id);
    if (!updated) throw new Error('Failed to retrieve updated change request');

    await this.audit.write({
      actorId: approverUserId,
      action: 'change_request.reject',
      entityType: 'change_request',
      entityId: id,
      description: `Change request rejected: ${existing.changeType} — ${rejectionReason}`,
      before: existing as unknown as Record<string, unknown>,
      after: updated as unknown as Record<string, unknown>,
    });

    return updated;
  }

  /**
   * Marks the request as applied and writes a proxy audit log entry.
   *
   * The audit log records:
   *   user_id           = approverUserId (the authority holder who takes responsibility)
   *   on_behalf_of_user_id = proposer (who originally requested the change)
   *
   * This means externally the action appears as if directly decided by the
   * approver; the proposer's identity is preserved for full traceability.
   */
  async apply(id: number, actorUserId: number, justification?: string | null): Promise<ChangeRequest> {
    const existing = await this.getById(id);
    if (!existing) throw new Error('Change request not found');
    if (existing.status !== 'approved') {
      throw new Error(`Cannot apply a change request in '${existing.status}' status — must be approved first`);
    }

    const authorityHolder = existing.approverUserId ?? actorUserId;

    await this.pool.execute(
      `UPDATE change_requests
          SET status = 'applied', applied_at = CURRENT_TIMESTAMP,
              on_behalf_of_user_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [existing.proposerUserId, id]
    );

    const updated = await this.getById(id);
    if (!updated) throw new Error('Failed to retrieve updated change request');

    // Attribution: the authority holder (approver) is the actor; the proposer appears as on_behalf_of.
    await this.audit.write({
      actorId: authorityHolder,
      onBehalfOfUserId: existing.proposerUserId,
      action: 'change_request.apply',
      entityType: existing.targetEntityType,
      entityId: existing.targetEntityId ?? undefined,
      description: `Change applied via request #${id}: ${existing.changeType}`,
      justification: justification ?? undefined,
      before: existing as unknown as Record<string, unknown>,
      after: updated as unknown as Record<string, unknown>,
    });

    logger.info(`Change request applied: id=${id} authority=${authorityHolder} proposer=${existing.proposerUserId}`);
    return updated;
  }

  async cancel(id: number, requestorUserId: number): Promise<ChangeRequest> {
    const existing = await this.getById(id);
    if (!existing) throw new Error('Change request not found');
    if (existing.status !== 'pending') {
      throw new Error(`Cannot cancel a change request in '${existing.status}' status`);
    }

    await this.pool.execute(
      `UPDATE change_requests
          SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [id]
    );

    const updated = await this.getById(id);
    if (!updated) throw new Error('Failed to retrieve updated change request');

    await this.audit.write({
      actorId: requestorUserId,
      action: 'change_request.cancel',
      entityType: 'change_request',
      entityId: id,
      description: `Change request cancelled: ${existing.changeType} on ${existing.targetEntityType}`,
      before: existing as unknown as Record<string, unknown>,
      after: updated as unknown as Record<string, unknown>,
    });

    return updated;
  }
}
