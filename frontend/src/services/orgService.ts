/**
 * Org tree, memberships, and employee loans client.
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import { getAuthHeaders, handleResponse } from './apiUtils';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

export interface OrgUnit {
  id: number;
  name: string;
  description: string | null;
  parentId: number | null;
  managerUserId: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OrgUnitNode extends OrgUnit {
  children: OrgUnitNode[];
}

export interface UserOrgUnit {
  id: number;
  userId: number;
  orgUnitId: number;
  isPrimary: boolean;
  assignedAt: string;
}

type LoanStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'ended';

export interface EmployeeLoan {
  id: number;
  userId: number;
  fromOrgUnitId: number;
  toOrgUnitId: number;
  startDate: string;
  endDate: string;
  reason: string | null;
  status: LoanStatus;
  requestedBy: number;
  approverUserId: number | null;
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

// -------- Org units --------

export const listUnits = () => request<OrgUnit[]>(`/org/units`);
export const getTree = () => request<OrgUnitNode[]>(`/org/units/tree`);
export const getUnit = (id: number) => request<OrgUnit>(`/org/units/${id}`);

export const createUnit = (input: {
  name: string;
  description?: string;
  parentId?: number | null;
  managerUserId?: number | null;
}) =>
  request<OrgUnit>(`/org/units`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const updateUnit = (
  id: number,
  patch: Partial<{
    name: string;
    description: string | null;
    parentId: number | null;
    managerUserId: number | null;
    isActive: boolean;
  }>
) =>
  request<OrgUnit>(`/org/units/${id}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });

export const deleteUnit = (id: number) =>
  request<void>(`/org/units/${id}`, { method: 'DELETE' });

// -------- Memberships --------

export const listMembers = (orgUnitId: number) =>
  request<UserOrgUnit[]>(`/org/units/${orgUnitId}/members`);

export const addMember = (orgUnitId: number, userId: number, isPrimary = false) =>
  request<UserOrgUnit>(`/org/units/${orgUnitId}/members`, {
    method: 'POST',
    body: JSON.stringify({ userId, isPrimary }),
  });

export const setPrimaryMember = (orgUnitId: number, userId: number) =>
  request<void>(`/org/units/${orgUnitId}/members/${userId}/primary`, { method: 'PATCH' });

export const removeMember = (orgUnitId: number, userId: number) =>
  request<void>(`/org/units/${orgUnitId}/members/${userId}`, { method: 'DELETE' });

// -------- Loans --------

export const listLoans = (filters: {
  userId?: number;
  toOrgUnitId?: number;
  fromOrgUnitId?: number;
  status?: LoanStatus;
} = {}) => {
  const qs = new URLSearchParams();
  if (filters.userId !== undefined) qs.set('userId', String(filters.userId));
  if (filters.toOrgUnitId !== undefined) qs.set('toOrgUnitId', String(filters.toOrgUnitId));
  if (filters.fromOrgUnitId !== undefined) qs.set('fromOrgUnitId', String(filters.fromOrgUnitId));
  if (filters.status) qs.set('status', filters.status);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return request<EmployeeLoan[]>(`/org/loans${suffix}`);
};

export const createLoan = (input: {
  userId: number;
  fromOrgUnitId: number;
  toOrgUnitId: number;
  startDate: string;
  endDate: string;
  reason?: string;
}) =>
  request<EmployeeLoan>(`/org/loans`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const approveLoan = (id: number, notes?: string) =>
  request<EmployeeLoan>(`/org/loans/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ notes: notes ?? null }),
  });

export const rejectLoan = (id: number, notes?: string) =>
  request<EmployeeLoan>(`/org/loans/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ notes: notes ?? null }),
  });

export const cancelLoan = (id: number) =>
  request<EmployeeLoan>(`/org/loans/${id}/cancel`, { method: 'POST' });
