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
import type { DashboardStats, AuditLogEntry } from '../types';
import { getDashboardStats, getRecentActivity } from '../services/dashboardService';

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
