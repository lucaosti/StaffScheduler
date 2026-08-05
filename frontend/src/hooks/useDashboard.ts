/**
 * Dashboard server-state hook (TanStack Query).
 *
 * The dashboard loads two things together — aggregate stats and a short recent-
 * activity feed — and rendered them via a hand-written `loadDashboardData` with
 * its own loading/error state and a "Try Again" button that re-invoked it. One
 * query returning both keeps the page's single load unit while gaining caching
 * and a `refetch` the retry button can call directly.
 *
 * @author Luca Ostinelli
 */

import { useQuery } from '@tanstack/react-query';
import type { DashboardStats, AttentionItems, AuditLogEntry } from '../types';
import { getDashboardStats, getAttentionItems, getRecentActivity } from '../services/dashboardService';

interface DashboardData {
  stats: DashboardStats;
  recentActivity: AuditLogEntry[];
}

/** Loads dashboard stats + recent activity as one cached unit. */
export function useDashboardData() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: async (): Promise<DashboardData> => {
      const [dashboardResponse, activity] = await Promise.all([
        getDashboardStats(),
        getRecentActivity(5),
      ]);
      if (!dashboardResponse.success || !dashboardResponse.data) {
        throw new Error('Failed to load dashboard statistics');
      }
      return { stats: dashboardResponse.data, recentActivity: activity };
    },
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
