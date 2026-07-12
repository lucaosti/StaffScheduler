/**
 * Pending approval service — wraps /api/pending-approvals endpoints.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import { getAuthHeaders, handleResponse, API_BASE_URL } from './apiUtils';

const BASE = `${API_BASE_URL}/pending-approvals`;

type PendingApprovalStatus = 'pending' | 'approved' | 'rejected' | 'escalated';

export interface PendingApprovalItem {
  id: number;
  changeRequestId: number | null;
  timeOffRequestId: number | null;
  employeeLoanId: number | null;
  shiftSwapRequestId: number | null;
  workflowId: number;
  stepId: number;
  stepOrder: number;
  assignedToUserId: number | null;
  assignedToOrgUnitId: number | null;
  openToStructure: boolean;
  decidedByUserId: number | null;
  status: PendingApprovalStatus;
  decidedAt: string | null;
  decisionNote: string | null;
  escalatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Context fields
  changeType: string;
  targetEntityType: 'change_request' | 'time_off_request' | 'employee_loan' | 'shift_swap_request';
  targetEntityId: number | null;
  proposedPayload: Record<string, unknown>;
  justification: string | null;
  proposerUserId: number;
}

export interface PendingApprovalListResponse {
  items: PendingApprovalItem[];
  total: number;
}

type DecisionReassignmentAction = 'kept' | 'delegated_to_person' | 'opened_to_structure';

export interface DecisionChain {
  pendingApprovalId: number;
  status: PendingApprovalStatus;
  assignedToOrgUnit: { id: number; name: string; headUserId: number | null; headName: string | null } | null;
  reassignments: Array<{
    id: number;
    action: DecisionReassignmentAction;
    actorUserId: number;
    targetUserId: number | null;
    createdAt: string;
    actorName: string;
    targetName: string | null;
  }>;
  currentAssigneeUserId: number | null;
  openToStructure: boolean;
  decidedByUserId: number | null;
  decidedByName: string | null;
}

export const listPendingApprovals = async (
  status = 'pending'
): Promise<ApiResponse<PendingApprovalListResponse>> => {
  const qs = new URLSearchParams({ status });
  const res = await fetch(`${BASE}?${qs}`, { method: 'GET', ...getAuthHeaders() });
  return handleResponse<PendingApprovalListResponse>(res);
};

export const approvePendingItem = async (
  id: number,
  note?: string
): Promise<ApiResponse<PendingApprovalItem>> => {
  const res = await fetch(`${BASE}/${id}/approve`, {
    method: 'POST',
    ...getAuthHeaders(),
    body: JSON.stringify({ note: note ?? null }),
  });
  return handleResponse<PendingApprovalItem>(res);
};

export const rejectPendingItem = async (
  id: number,
  note?: string
): Promise<ApiResponse<PendingApprovalItem>> => {
  const res = await fetch(`${BASE}/${id}/reject`, {
    method: 'POST',
    ...getAuthHeaders(),
    body: JSON.stringify({ note: note ?? null }),
  });
  return handleResponse<PendingApprovalItem>(res);
};

// -------- Structure delegation (entity-agnostic) --------

export const keepPendingItem = async (id: number): Promise<ApiResponse<PendingApprovalItem>> => {
  const res = await fetch(`${BASE}/${id}/keep`, { method: 'POST', ...getAuthHeaders() });
  return handleResponse<PendingApprovalItem>(res);
};

export const delegatePendingItem = async (
  id: number,
  targetUserId: number
): Promise<ApiResponse<PendingApprovalItem>> => {
  const res = await fetch(`${BASE}/${id}/delegate`, {
    method: 'POST',
    ...getAuthHeaders(),
    body: JSON.stringify({ targetUserId }),
  });
  return handleResponse<PendingApprovalItem>(res);
};

export const openPendingItemToStructure = async (id: number): Promise<ApiResponse<PendingApprovalItem>> => {
  const res = await fetch(`${BASE}/${id}/open-to-structure`, { method: 'POST', ...getAuthHeaders() });
  return handleResponse<PendingApprovalItem>(res);
};

export const getDecisionChain = async (id: number): Promise<ApiResponse<DecisionChain>> => {
  const res = await fetch(`${BASE}/${id}/chain`, { method: 'GET', ...getAuthHeaders() });
  return handleResponse<DecisionChain>(res);
};
