/**
 * Pending Approval Service
 *
 * Read-side queries for the pending_approvals table. Covers all four entity
 * types a decision can be about (change request, time-off, loan, shift
 * swap) — exactly one of the corresponding *_id columns is set per row.
 * Write-side mutations (approve / reject / advance / delegate) live in
 * ApprovalEngineService and the per-entity services so the full entity
 * lifecycle stays with its owner.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket } from 'mysql2/promise';
import { PendingApprovalWithContext, PendingApprovalEntityType } from '../types';

const mapRow = (r: any): PendingApprovalWithContext => {
  const targetEntityType: PendingApprovalEntityType = r.change_request_id
    ? 'change_request'
    : r.time_off_request_id
      ? 'time_off_request'
      : r.employee_loan_id
        ? 'employee_loan'
        : 'shift_swap_request';

  const changeType =
    r.cr_change_type ??
    (targetEntityType === 'time_off_request'
      ? 'TimeOff.Request'
      : targetEntityType === 'employee_loan'
        ? 'Loan.Request'
        : 'ShiftSwap.Request');

  const targetEntityId = r.change_request_id ?? r.time_off_request_id ?? r.employee_loan_id ?? r.shift_swap_request_id ?? null;

  const proposerUserId =
    r.cr_proposer_user_id ?? r.tor_user_id ?? r.el_user_id ?? r.ssr_requester_user_id;

  const justification = r.cr_justification ?? r.tor_reason ?? r.el_reason ?? r.ssr_notes ?? null;

  let proposedPayload: Record<string, unknown> = {};
  if (targetEntityType === 'change_request') {
    try {
      proposedPayload =
        typeof r.cr_proposed_payload === 'string' ? JSON.parse(r.cr_proposed_payload) : (r.cr_proposed_payload ?? {});
    } catch {
      proposedPayload = {};
    }
  } else if (targetEntityType === 'time_off_request') {
    proposedPayload = { startDate: r.tor_start_date, endDate: r.tor_end_date, type: r.tor_type };
  } else if (targetEntityType === 'employee_loan') {
    proposedPayload = { fromOrgUnitId: r.el_from_org_unit_id, toOrgUnitId: r.el_to_org_unit_id, startDate: r.el_start_date, endDate: r.el_end_date };
  } else {
    proposedPayload = { requesterAssignmentId: r.ssr_requester_assignment_id, targetAssignmentId: r.ssr_target_assignment_id };
  }

  return {
    id: r.id,
    changeRequestId: r.change_request_id ?? null,
    timeOffRequestId: r.time_off_request_id ?? null,
    employeeLoanId: r.employee_loan_id ?? null,
    shiftSwapRequestId: r.shift_swap_request_id ?? null,
    workflowId: r.workflow_id,
    stepId: r.step_id,
    stepOrder: r.step_order,
    assignedToUserId: r.assigned_to_user_id ?? null,
    assignedToOrgUnitId: r.assigned_to_org_unit_id ?? null,
    openToStructure: Boolean(r.open_to_structure),
    decidedByUserId: r.decided_by_user_id ?? null,
    status: r.status,
    decidedAt: r.decided_at ?? null,
    decisionNote: r.decision_note ?? null,
    escalatedAt: r.escalated_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    changeType,
    targetEntityType,
    targetEntityId,
    proposedPayload,
    justification,
    proposerUserId,
  };
};

export class PendingApprovalService {
  constructor(private pool: Pool) {}

  /**
   * Lists items the user can currently act on: directly assigned to them,
   * or opened to the whole structure they're a member of.
   */
  async listForUser(userId: number, status?: string): Promise<PendingApprovalWithContext[]> {
    const params: (number | string)[] = [userId, userId];
    let statusClause = '';
    if (status) {
      statusClause = ' AND pa.status = ?';
      params.push(status);
    }
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT pa.*,
              cr.change_type AS cr_change_type, cr.target_entity_type AS cr_target_entity_type,
              cr.target_entity_id AS cr_target_entity_id, cr.proposed_payload AS cr_proposed_payload,
              cr.justification AS cr_justification, cr.proposer_user_id AS cr_proposer_user_id,
              tor.user_id AS tor_user_id, tor.start_date AS tor_start_date, tor.end_date AS tor_end_date,
              tor.type AS tor_type, tor.reason AS tor_reason,
              el.user_id AS el_user_id, el.from_org_unit_id AS el_from_org_unit_id,
              el.to_org_unit_id AS el_to_org_unit_id, el.start_date AS el_start_date,
              el.end_date AS el_end_date, el.reason AS el_reason,
              ssr.requester_user_id AS ssr_requester_user_id,
              ssr.requester_assignment_id AS ssr_requester_assignment_id,
              ssr.target_assignment_id AS ssr_target_assignment_id, ssr.notes AS ssr_notes
         FROM pending_approvals pa
         LEFT JOIN change_requests cr ON cr.id = pa.change_request_id
         LEFT JOIN time_off_requests tor ON tor.id = pa.time_off_request_id
         LEFT JOIN employee_loans el ON el.id = pa.employee_loan_id
         LEFT JOIN shift_swap_requests ssr ON ssr.id = pa.shift_swap_request_id
         LEFT JOIN user_org_units member_check
           ON member_check.org_unit_id = pa.assigned_to_org_unit_id AND member_check.user_id = ?
        WHERE (pa.assigned_to_user_id = ? OR (pa.open_to_structure = TRUE AND member_check.user_id IS NOT NULL))
          ${statusClause}
        ORDER BY pa.created_at DESC`,
      params
    );
    return (rows as any[]).map(mapRow);
  }

  async countForUser(userId: number): Promise<number> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS c
         FROM pending_approvals pa
         LEFT JOIN user_org_units member_check
           ON member_check.org_unit_id = pa.assigned_to_org_unit_id AND member_check.user_id = ?
        WHERE pa.status = 'pending'
          AND (pa.assigned_to_user_id = ? OR (pa.open_to_structure = TRUE AND member_check.user_id IS NOT NULL))`,
      [userId, userId]
    );
    return ((rows[0] as any).c as number) ?? 0;
  }
}
