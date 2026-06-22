/**
 * Pending Approval Service
 *
 * Read-side queries for the pending_approvals table.  Write-side mutations
 * (approve / reject / advance) live in ChangeRequestService so the full
 * change_request lifecycle stays in one place.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket } from 'mysql2/promise';
import { PendingApprovalWithContext } from '../types';

const mapRow = (r: any): PendingApprovalWithContext => ({
  id: r.id,
  changeRequestId: r.change_request_id,
  workflowId: r.workflow_id,
  stepId: r.step_id,
  stepOrder: r.step_order,
  assignedToUserId: r.assigned_to_user_id,
  status: r.status,
  decidedAt: r.decided_at ?? null,
  decisionNote: r.decision_note ?? null,
  escalatedAt: r.escalated_at ?? null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  changeType: r.change_type,
  targetEntityType: r.target_entity_type,
  targetEntityId: r.target_entity_id ?? null,
  proposedPayload: (() => {
    try {
      return typeof r.proposed_payload === 'string'
        ? JSON.parse(r.proposed_payload)
        : r.proposed_payload;
    } catch {
      return {};
    }
  })(),
  justification: r.justification ?? null,
  proposerUserId: r.proposer_user_id,
});

export class PendingApprovalService {
  constructor(private pool: Pool) {}

  async listForUser(userId: number, status?: string): Promise<PendingApprovalWithContext[]> {
    const params: (number | string)[] = [userId];
    let statusClause = '';
    if (status) {
      statusClause = ' AND pa.status = ?';
      params.push(status);
    }
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT pa.*,
              cr.change_type, cr.target_entity_type, cr.target_entity_id,
              cr.proposed_payload, cr.justification, cr.proposer_user_id
         FROM pending_approvals pa
         JOIN change_requests cr ON cr.id = pa.change_request_id
        WHERE pa.assigned_to_user_id = ?${statusClause}
        ORDER BY pa.created_at DESC`,
      params
    );
    return (rows as any[]).map(mapRow);
  }

  async countForUser(userId: number): Promise<number> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS c
         FROM pending_approvals
        WHERE assigned_to_user_id = ? AND status = 'pending'`,
      [userId]
    );
    return ((rows[0] as any).c as number) ?? 0;
  }
}
