/**
 * Shift swap client (F01).
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import { getAuthHeaders, handleResponse } from './apiUtils';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

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

const request = async <T>(path: string, init: RequestInit = {}): Promise<ApiResponse<T>> => {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { ...getAuthHeaders(), ...(init.headers || {}) },
  });
  return handleResponse<T>(res);
};

export const list = (filters: { userId?: number; status?: SwapStatus } = {}) => {
  const qs = new URLSearchParams();
  if (filters.userId !== undefined) qs.set('userId', String(filters.userId));
  if (filters.status) qs.set('status', filters.status);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return request<ShiftSwapRequest[]>(`/shift-swap${suffix}`);
};

export const create = (input: {
  requesterAssignmentId: number;
  targetAssignmentId: number;
  notes?: string;
}) =>
  request<ShiftSwapRequest>(`/shift-swap`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const approve = (id: number, notes?: string) =>
  request<ShiftSwapRequest>(`/shift-swap/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ notes: notes ?? null }),
  });

export const decline = (id: number, notes?: string) =>
  request<ShiftSwapRequest>(`/shift-swap/${id}/decline`, {
    method: 'POST',
    body: JSON.stringify({ notes: notes ?? null }),
  });

export const cancel = (id: number) =>
  request<ShiftSwapRequest>(`/shift-swap/${id}/cancel`, { method: 'POST' });
