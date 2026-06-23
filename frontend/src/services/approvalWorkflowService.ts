/**
 * Approval workflow service — wraps /api/approval-workflows endpoints.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import { getAuthHeaders, handleResponse, API_BASE_URL } from './apiUtils';

const BASE = `${API_BASE_URL}/approval-workflows`;

export type ApproverScope =
  | 'policy_owner'
  | 'unit_manager'
  | 'unit_manager_chain'
  | 'company_role'
  | 'company_user';

export interface ApprovalStep {
  id?: number;
  workflowId?: number;
  stepOrder: number;
  approverScope: ApproverScope;
  approverRoleId?: number | null;
  approverUserId?: number | null;
  autoApproveForOwner?: boolean;
  escalateAfterHours?: number | null;
}

export interface ApprovalWorkflow {
  id: number;
  changeType: string;
  requireAll: boolean;
  description: string | null;
  steps: ApprovalStep[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkflowBody {
  changeType: string;
  requireAll?: boolean;
  description?: string;
  steps: ApprovalStep[];
}

export interface UpdateWorkflowBody {
  requireAll?: boolean;
  description?: string;
  steps?: ApprovalStep[];
}

export const listWorkflows = async (): Promise<ApiResponse<ApprovalWorkflow[]>> => {
  const res = await fetch(BASE, { method: 'GET', ...getAuthHeaders() });
  return handleResponse<ApprovalWorkflow[]>(res);
};

export const getWorkflowByType = async (changeType: string): Promise<ApiResponse<ApprovalWorkflow>> => {
  const res = await fetch(`${BASE}/${encodeURIComponent(changeType)}`, { method: 'GET', ...getAuthHeaders() });
  return handleResponse<ApprovalWorkflow>(res);
};

export const createWorkflow = async (body: CreateWorkflowBody): Promise<ApiResponse<ApprovalWorkflow>> => {
  const res = await fetch(BASE, {
    method: 'POST',
    ...getAuthHeaders(),
    body: JSON.stringify(body),
  });
  return handleResponse<ApprovalWorkflow>(res);
};

export const updateWorkflow = async (id: number, body: UpdateWorkflowBody): Promise<ApiResponse<ApprovalWorkflow>> => {
  const res = await fetch(`${BASE}/${id}`, {
    method: 'PUT',
    ...getAuthHeaders(),
    body: JSON.stringify(body),
  });
  return handleResponse<ApprovalWorkflow>(res);
};

export const deleteWorkflow = async (id: number): Promise<ApiResponse<void>> => {
  const res = await fetch(`${BASE}/${id}`, { method: 'DELETE', ...getAuthHeaders() });
  return handleResponse<void>(res);
};
