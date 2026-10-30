/**
 * Dashboard server-state hook (TanStack Query).
 *
 * The dashboard's aggregate stats used to load through a hand-written
 * `loadDashboardData` with its own loading/error state and a "Try Again"
 * button that re-invoked it; the query gains caching and a `refetch` the
 * retry button can call directly. The recent-activity feed and the attention
 * items are separate queries — see each for why.
 *
 * @author Luca Ostinelli
 */

import { useQuery } from '@tanstack/react-query';
import type { DashboardStats, AttentionItems, AuditLogEntry } from '../types';
import { getDashboardStats, getAttentionItems, getRecentActivity } from '../services/dashboardService';

/** Loads the dashboard stats. */
export function useDashboardData() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: async (): Promise<DashboardStats> => {
      const dashboardResponse = await getDashboardStats();
      if (!dashboardResponse.success || !dashboardResponse.data) {
        throw new Error('Failed to load dashboard statistics');
      }
      return dashboardResponse.data;
    },
  });
}

/**
 * The recent-activity feed, fetched only for a caller holding `audit.read`.
 *
 * It used to load inside the stats query for everyone; the audit endpoint
 * answers 403 without `audit.read`, the service turns any failure into an
 * empty list, and the panel then said "No recent activity" — a false
 * statement about the organisation rather than "you cannot see this" (#894).
 * Gating with `enabled` means the request is never made without the
 * permission, and the page hides the panel instead.
 */
export function useRecentActivity(enabled: boolean) {
  return useQuery({
    queryKey: ['dashboard', 'recent-activity'],
    queryFn: (): Promise<AuditLogEntry[]> => getRecentActivity(5),
    enabled,
  });
}

/**
 * Separate from `useDashboardData`: attention items run their own,
 * potentially heavier query (an org-unit-scoped shift scan plus the
 * caller's pending-approval list) and a slow response here should not hold
 * up the stat cards, which is what one combined query would do.
 */
export function useAttentionItems() {
  return useQuery({
    queryKey: ['dashboard', 'attention-items'],
    queryFn: async (): Promise<AttentionItems> => {
      const response = await getAttentionItems();
      if (!response.success || !response.data) {
        throw new Error('Failed to load attention items');
      }
      return response.data;
    },
  });
}
