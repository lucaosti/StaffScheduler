/**
 * Responsibility rules API client.
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import { AUTH_HEADERS, handleResponse, API_BASE_URL } from './apiUtils';

export type ResponsibilitySubjectType = 'org_unit' | 'department' | 'role' | 'all';

export interface ResponsibilityRule {
  id: number;
  subjectType: ResponsibilitySubjectType;
  subjectId: number | null;
  permissionCode: string;
  responsibleOrgUnitId: number;
  delegatedToRoleId: number | null;
  description: string | null;
  isActive: boolean;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateResponsibilityRuleInput {
  subjectType: ResponsibilitySubjectType;
  subjectId?: number | null;
  permissionCode: string;
  responsibleOrgUnitId: number;
  delegatedToRoleId?: number | null;
  description?: string | null;
}

export interface UpdateResponsibilityRuleInput {
  subjectType?: ResponsibilitySubjectType;
  subjectId?: number | null;
  permissionCode?: string;
  responsibleOrgUnitId?: number;
  delegatedToRoleId?: number | null;
  description?: string | null;
  isActive?: boolean;
}

const request = async <T>(path: string, init: RequestInit = {}): Promise<ApiResponse<T>> => {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    ...init,
    headers: { ...AUTH_HEADERS, ...(init.headers as Record<string, string> ?? {}) },
  });
  return handleResponse<T>(res);
};

export const listResponsibilityRules = (filters?: {
  subjectType?: string;
  permissionCode?: string;
  responsibleOrgUnitId?: number;
  isActive?: boolean;
}) => {
  const params = new URLSearchParams();
  if (filters?.subjectType) params.set('subjectType', filters.subjectType);
  if (filters?.permissionCode) params.set('permissionCode', filters.permissionCode);
  if (filters?.responsibleOrgUnitId !== undefined) params.set('responsibleOrgUnitId', String(filters.responsibleOrgUnitId));
  if (filters?.isActive !== undefined) params.set('isActive', String(filters.isActive));
  const qs = params.toString();
  return request<ResponsibilityRule[]>(`/responsibility-rules${qs ? `?${qs}` : ''}`);
};

export const createResponsibilityRule = (input: CreateResponsibilityRuleInput) =>
  request<ResponsibilityRule>('/responsibility-rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

export const updateResponsibilityRule = (id: number, patch: UpdateResponsibilityRuleInput) =>
  request<ResponsibilityRule>(`/responsibility-rules/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });

export const deleteResponsibilityRule = (id: number) =>
  request<void>(`/responsibility-rules/${id}`, { method: 'DELETE' });

export interface MatrixEntry {
  subjectType: ResponsibilitySubjectType;
  subjectId: number | null;
  permissionCode: string;
  rules: ResponsibilityRule[];
}

export const getResponsibilityMatrix = () =>
  request<{ matrix: MatrixEntry[] }>('/responsibility-rules/matrix');

export const getMyResponsibilities = () =>
  request<ResponsibilityRule[]>('/responsibility-rules/my-responsibilities');
