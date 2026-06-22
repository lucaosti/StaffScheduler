/**
 * Change requests API client.
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import { AUTH_HEADERS, handleResponse, API_BASE_URL } from './apiUtils';

export type ChangeRequestStatus = 'pending' | 'approved' | 'rejected' | 'applied' | 'cancelled';

export interface ChangeRequest {
  id: number;
  changeType: string;
  proposerUserId: number;
  targetEntityType: string;
  targetEntityId: number | null;
  proposedPayload: Record<string, unknown>;
  justification: string | null;
  status: ChangeRequestStatus;
  approverUserId: number | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  appliedAt: string | null;
  onBehalfOfUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChangeRequestPage {
  total: number;
  items: ChangeRequest[];
}

export interface CreateChangeRequestInput {
  changeType: string;
  targetEntityType: string;
  targetEntityId?: number | null;
  proposedPayload: Record<string, unknown>;
  justification?: string | null;
}

const request = async <T>(path: string, init: RequestInit = {}): Promise<ApiResponse<T>> => {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    ...init,
    headers: { ...AUTH_HEADERS, ...(init.headers as Record<string, string> ?? {}) },
  });
  return handleResponse<T>(res);
};

export const listChangeRequests = (filters?: {
  proposerUserId?: number;
  approverUserId?: number;
  status?: ChangeRequestStatus;
  changeType?: string;
  limit?: number;
  offset?: number;
}) => {
  const params = new URLSearchParams();
  if (filters?.proposerUserId !== undefined) params.set('proposerUserId', String(filters.proposerUserId));
  if (filters?.approverUserId !== undefined) params.set('approverUserId', String(filters.approverUserId));
  if (filters?.status) params.set('status', filters.status);
  if (filters?.changeType) params.set('changeType', filters.changeType);
  if (filters?.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters?.offset !== undefined) params.set('offset', String(filters.offset));
  const qs = params.toString();
  return request<ChangeRequestPage>(`/change-requests${qs ? `?${qs}` : ''}`);
};

export const getChangeRequest = (id: number) =>
  request<ChangeRequest>(`/change-requests/${id}`);

export const createChangeRequest = (input: CreateChangeRequestInput) =>
  request<ChangeRequest>('/change-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

export const approveChangeRequest = (id: number, justification?: string | null) =>
  request<ChangeRequest>(`/change-requests/${id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ justification }),
  });

export const rejectChangeRequest = (id: number, rejectionReason: string) =>
  request<ChangeRequest>(`/change-requests/${id}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rejectionReason }),
  });

export const applyChangeRequest = (id: number, justification?: string | null) =>
  request<ChangeRequest>(`/change-requests/${id}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ justification }),
  });

export const cancelChangeRequest = (id: number) =>
  request<ChangeRequest>(`/change-requests/${id}/cancel`, { method: 'POST' });
