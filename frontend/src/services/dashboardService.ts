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

import { ApiResponse, DashboardStats, AttentionItems, AuditLogEntry } from '../types';
import { apiClient } from '../api/client';
import { listAuditLogs } from './auditLogService';

export const getDashboardStats = (): Promise<ApiResponse<DashboardStats>> =>
  apiClient.get<DashboardStats, '/dashboard/stats'>('/dashboard/stats');

export const getAttentionItems = (): Promise<ApiResponse<AttentionItems>> =>
  apiClient.get<AttentionItems, '/dashboard/attention-items'>('/dashboard/attention-items');

/**
 * Routed through `listAuditLogs` (the generated client) rather than a raw
 * `fetch`, per the service-layer convention — this used to hand-parse the
 * response body itself, duplicating what `handleResponse` already does.
 *
 * Still swallows its own failure into an empty list rather than throwing:
 * the recent-activity feed is a secondary widget on the dashboard, and a
 * failure here should not take down the stat cards `useDashboardData`
 * loads alongside it.
 */
export const getRecentActivity = async (limit = 5): Promise<AuditLogEntry[]> => {
  try {
    const res = await listAuditLogs({ limit });
    return res.success && Array.isArray(res.data) ? res.data : [];
  } catch {
    return [];
  }
};
