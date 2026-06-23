/**
 * Audit log service — wraps /api/audit-logs endpoints.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse, AuditLogEntry, AuditLogPage } from '../types';
import { getAuthHeaders, handleResponse, API_BASE_URL } from './apiUtils';

const BASE = `${API_BASE_URL}/audit-logs`;

export interface AuditLogFilters {
  userId?: number;
  action?: string;
  entityType?: string;
  entityId?: number;
  fromDate?: string;
  toDate?: string;
  requestId?: string;
  page?: number;
  pageSize?: number;
}

type AuditPageResponse = ApiResponse<AuditLogEntry[]> & {
  meta?: { total: number; page: number; pageSize: number; pages: number };
};

export const listAuditLogs = async (filters: AuditLogFilters = {}): Promise<AuditPageResponse> => {
  const qs = new URLSearchParams();
  if (filters.userId !== undefined) qs.set('userId', String(filters.userId));
  if (filters.action) qs.set('action', filters.action);
  if (filters.entityType) qs.set('entityType', filters.entityType);
  if (filters.entityId !== undefined) qs.set('entityId', String(filters.entityId));
  if (filters.fromDate) qs.set('fromDate', filters.fromDate);
  if (filters.toDate) qs.set('toDate', filters.toDate);
  if (filters.requestId) qs.set('requestId', filters.requestId);
  if (filters.page !== undefined) qs.set('page', String(filters.page));
  if (filters.pageSize !== undefined) qs.set('pageSize', String(filters.pageSize));

  const url = `${BASE}${qs.toString() ? `?${qs}` : ''}`;
  const res = await fetch(url, { method: 'GET', ...getAuthHeaders() });
  return handleResponse<AuditLogEntry[]>(res) as Promise<AuditPageResponse>;
};

export const buildExportUrl = (filters: Omit<AuditLogFilters, 'page' | 'pageSize'>, format: 'csv' | 'json'): string => {
  const qs = new URLSearchParams({ format });
  if (filters.userId !== undefined) qs.set('userId', String(filters.userId));
  if (filters.action) qs.set('action', filters.action);
  if (filters.entityType) qs.set('entityType', filters.entityType);
  if (filters.fromDate) qs.set('fromDate', filters.fromDate);
  if (filters.toDate) qs.set('toDate', filters.toDate);
  return `${BASE}/export?${qs}`;
};
