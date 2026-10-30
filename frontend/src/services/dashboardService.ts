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
 * Failures propagate (#894 review). This used to swallow them into an empty
 * list, so a disabled audit module (404) or a server fault rendered as "No
 * recent activity" — a false statement about the organisation. The feed is
 * its own query now (`useRecentActivity`), so a failure here no longer takes
 * the stat cards down with it, which was the reason for swallowing.
 */
export const getRecentActivity = async (limit = 5): Promise<AuditLogEntry[]> => {
  // page + pageSize, not `limit` (#942): GET /audit-logs answers `?limit=`
  // with `{ total, items }` but page+pageSize with the paginated envelope,
  // whose `data` is the entry array the Audit Logs page also reads. Asked
  // with `limit` and checked for an array, the panel was empty for everyone.
  const res = await listAuditLogs({ page: 1, pageSize: limit });
  return res.success && Array.isArray(res.data) ? res.data : [];
};
