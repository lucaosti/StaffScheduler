/**
 * Dashboard Service for Staff Scheduler Frontend
 * 
 * Handles all dashboard-related API calls including statistics retrieval,
 * analytics data, metrics calculation, and overview information.
 * 
 * Features:
 * - Real-time statistics and metrics
 * - Performance analytics data
 * - Employee and shift summaries
 * - Cost and hour tracking
 * - Coverage and satisfaction metrics
 * - Error handling with custom ApiError
 * 
 * @author Luca Ostinelli
 */

import { ApiResponse, DashboardStats, AuditLogEntry } from '../types';
import { getAuthHeaders, API_BASE_URL } from './apiUtils';
import { apiClient } from '../api/client';

export const getDashboardStats = (): Promise<ApiResponse<DashboardStats>> =>
  apiClient.get<DashboardStats, '/dashboard/stats'>('/dashboard/stats');

export const getRecentActivity = async (limit = 5): Promise<AuditLogEntry[]> => {
  try {
    const response = await fetch(`${API_BASE_URL}/audit-logs?limit=${limit}`, {
      method: 'GET',
      ...getAuthHeaders(),
    });
    if (!response.ok) return [];
    const body = await response.json();
    const items = body?.data?.items ?? body?.data ?? [];
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
};
