/**
 * Policies, exception requests, and approval-matrix client.
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import { getAuthHeaders, handleResponse } from './apiUtils';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

export type PolicyScope = 'global' | 'org_unit' | 'schedule' | 'shift_template';

export interface Policy {
  id: number;
  scopeType: PolicyScope;
  scopeId: number | null;
  policyKey: string;
  policyValue: unknown;
  description: string | null;
  imposedByUserId: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

type ExceptionStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface PolicyExceptionRequest {
  id: number;
  policyId: number;
  targetType: string;
  targetId: number;
  reason: string | null;
  status: ExceptionStatus;
  requestedByUserId: number;
  reviewerUserId: number | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

type ApproverScope =
  | 'policy_owner'
  | 'unit_manager'
  | 'unit_manager_chain'
  | 'company_role'
  | 'company_user';

export interface ApprovalMatrixRow {
  id: number;
  changeType: string;
  approverScope: ApproverScope;
  approverRole: 'admin' | 'manager' | 'employee' | null;
  approverUserId: number | null;
  autoApproveForOwner: boolean;
  description: string | null;
}

interface PolicyViolation {
  policyId: number;
  policyKey: string;
  scopeType: PolicyScope;
  scopeId: number | null;
  message: string;
  hasApprovedException: boolean;
  imposedByUserId: number;
}

const request = async <T>(path: string, init: RequestInit = {}): Promise<ApiResponse<T>> => {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { ...getAuthHeaders(), ...(init.headers || {}) },
  });
  return handleResponse<T>(res);
};

// -------- Policies --------

export const listPolicies = () => request<Policy[]>(`/policies`);
export const getPolicy = (id: number) => request<Policy>(`/policies/${id}`);

export const createPolicy = (input: {
  scopeType: PolicyScope;
  scopeId?: number | null;
  policyKey: string;
  policyValue: unknown;
  description?: string | null;
}) =>
  request<Policy>(`/policies`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const updatePolicy = (
  id: number,
  patch: Partial<{
    scopeType: PolicyScope;
    scopeId: number | null;
    policyKey: string;
    policyValue: unknown;
    description: string | null;
    isActive: boolean;
  }>
) =>
  request<Policy>(`/policies/${id}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });

export const deletePolicy = (id: number) =>
  request<void>(`/policies/${id}`, { method: 'DELETE' });

// -------- Exceptions --------

export const listExceptions = (filters: {
  policyId?: number;
  targetType?: string;
  targetId?: number;
  status?: ExceptionStatus;
  requestedByUserId?: number;
} = {}) => {
  const qs = new URLSearchParams();
  if (filters.policyId !== undefined) qs.set('policyId', String(filters.policyId));
  if (filters.targetType) qs.set('targetType', filters.targetType);
  if (filters.targetId !== undefined) qs.set('targetId', String(filters.targetId));
  if (filters.status) qs.set('status', filters.status);
  if (filters.requestedByUserId !== undefined)
    qs.set('requestedByUserId', String(filters.requestedByUserId));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return request<PolicyExceptionRequest[]>(`/policies/exceptions${suffix}`);
};

export const createException = (input: {
  policyId: number;
  targetType: string;
  targetId: number;
  reason?: string | null;
}) =>
  request<PolicyExceptionRequest>(`/policies/exceptions`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const approveException = (id: number, notes?: string) =>
  request<PolicyExceptionRequest>(`/policies/exceptions/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ notes: notes ?? null }),
  });

export const rejectException = (id: number, notes?: string) =>
  request<PolicyExceptionRequest>(`/policies/exceptions/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ notes: notes ?? null }),
  });

export const cancelException = (id: number) =>
  request<PolicyExceptionRequest>(`/policies/exceptions/${id}/cancel`, { method: 'POST' });

// -------- Approval matrix --------

export const listMatrix = () => request<ApprovalMatrixRow[]>(`/policies/approval-matrix`);

export const updateMatrix = (
  changeType: string,
  patch: Partial<Omit<ApprovalMatrixRow, 'id' | 'changeType'>>
) =>
  request<ApprovalMatrixRow>(`/policies/approval-matrix/${encodeURIComponent(changeType)}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });

// -------- Validation --------

export const validateAssignment = (input: { userId: number; shiftId: number }) =>
  request<{ ok: boolean; violations: PolicyViolation[] }>(`/policies/validate/assignment`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
