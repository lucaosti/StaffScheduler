/**
 * Time-off client (F02).
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import { getAuthHeaders, handleResponse } from './apiUtils';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

export type TimeOffType = 'vacation' | 'sick' | 'personal' | 'other';
export type TimeOffStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface TimeOffRequest {
  id: number;
  userId: number;
  startDate: string;
  endDate: string;
  type: TimeOffType;
  reason: string | null;
  status: TimeOffStatus;
  reviewerId: number | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  unavailabilityId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTimeOffInput {
  startDate: string;
  endDate: string;
  type?: TimeOffType;
  reason?: string;
}

const request = async <T>(path: string, init: RequestInit = {}): Promise<ApiResponse<T>> => {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { ...getAuthHeaders(), ...(init.headers || {}) },
  });
  return handleResponse<T>(res);
};

export const list = (filters: { userId?: number; status?: TimeOffStatus } = {}) => {
  const qs = new URLSearchParams();
  if (filters.userId !== undefined) qs.set('userId', String(filters.userId));
  if (filters.status) qs.set('status', filters.status);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return request<TimeOffRequest[]>(`/time-off${suffix}`);
};

export const getById = (id: number) => request<TimeOffRequest>(`/time-off/${id}`);

export const create = (input: CreateTimeOffInput) =>
  request<TimeOffRequest>(`/time-off`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const approve = (id: number, notes?: string) =>
  request<TimeOffRequest>(`/time-off/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ notes: notes ?? null }),
  });

export const reject = (id: number, notes?: string) =>
  request<TimeOffRequest>(`/time-off/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ notes: notes ?? null }),
  });

export const cancel = (id: number) =>
  request<TimeOffRequest>(`/time-off/${id}/cancel`, { method: 'POST' });
