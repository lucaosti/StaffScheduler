/**
 * Pending approval service — wraps /api/pending-approvals endpoints.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import { getAuthHeaders, handleResponse, API_BASE_URL } from './apiUtils';

const BASE = `${API_BASE_URL}/pending-approvals`;

export type PendingApprovalStatus = 'pending' | 'approved' | 'rejected' | 'escalated';

export interface PendingApprovalItem {
  id: number;
  changeRequestId: number;
  workflowId: number;
  stepId: number;
  stepOrder: number;
  assignedToUserId: number;
  status: PendingApprovalStatus;
  decidedAt: string | null;
  decisionNote: string | null;
  escalatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Context fields
  changeType: string;
  targetEntityType: string;
  targetEntityId: number | null;
  proposedPayload: Record<string, unknown>;
  justification: string | null;
  proposerUserId: number;
}

export interface PendingApprovalListResponse {
  items: PendingApprovalItem[];
  total: number;
}

export const listPendingApprovals = async (
  status = 'pending'
): Promise<ApiResponse<PendingApprovalListResponse>> => {
  const qs = new URLSearchParams({ status });
  const res = await fetch(`${BASE}?${qs}`, { method: 'GET', ...getAuthHeaders() });
  return handleResponse<PendingApprovalListResponse>(res);
};

export const countPendingApprovals = async (): Promise<ApiResponse<{ count: number }>> => {
  const res = await fetch(`${BASE}/count`, { method: 'GET', ...getAuthHeaders() });
  return handleResponse<{ count: number }>(res);
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
