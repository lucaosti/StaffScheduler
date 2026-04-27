/**
 * On-call client (F21).
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import { getAuthHeaders, handleResponse } from './apiUtils';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

export type OnCallStatus = 'open' | 'assigned' | 'cancelled';

export interface OnCallPeriod {
  id: number;
  scheduleId: number | null;
  departmentId: number;
  departmentName?: string;
  date: string;
  startTime: string;
  endTime: string;
  minStaff: number;
  maxStaff: number;
  notes: string | null;
  status: OnCallStatus;
  assignedCount: number;
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

export const listMine = (filters: { start?: string; end?: string } = {}) => {
  const qs = new URLSearchParams();
  if (filters.start) qs.set('start', filters.start);
  if (filters.end) qs.set('end', filters.end);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return request<Array<OnCallPeriod & { assignmentStatus: string }>>(`/on-call/me${suffix}`);
};

export const listPeriods = (filters: {
  departmentId?: number;
  status?: OnCallStatus;
  start?: string;
  end?: string;
} = {}) => {
  const qs = new URLSearchParams();
  if (filters.departmentId !== undefined) qs.set('departmentId', String(filters.departmentId));
  if (filters.status) qs.set('status', filters.status);
  if (filters.start) qs.set('start', filters.start);
  if (filters.end) qs.set('end', filters.end);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return request<OnCallPeriod[]>(`/on-call/periods${suffix}`);
};

export const createPeriod = (input: {
  departmentId: number;
  date: string;
  startTime: string;
  endTime: string;
  minStaff?: number;
  maxStaff?: number;
  notes?: string;
}) =>
  request<OnCallPeriod>(`/on-call/periods`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const assignUser = (periodId: number, userId: number, notes?: string) =>
  request<unknown>(`/on-call/periods/${periodId}/assign`, {
    method: 'POST',
    body: JSON.stringify({ userId, notes: notes ?? null }),
  });

export const unassignUser = (periodId: number, userId: number) =>
  request<unknown>(`/on-call/periods/${periodId}/assign/${userId}`, { method: 'DELETE' });
