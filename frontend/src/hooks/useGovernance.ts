/**
 * Governance / responsibility server-state hooks (TanStack Query).
 *
 * Shared by the RaciMatrix page (read-only matrix view) and, going forward, the
 * Governance page. Centralising the responsibility-matrix query here means both
 * views read the same cache entry instead of each fetching independently.
 *
 * @author Luca Ostinelli
 */

import { useQuery } from '@tanstack/react-query';
import {
  getResponsibilityMatrix,
  listResponsibilityRules,
  type MatrixEntry,
  type ResponsibilityRule,
} from '../services/responsibilityService';
import {
  listChangeRequests,
  type ChangeRequest,
  type ChangeRequestStatus,
} from '../services/changeRequestService';

export const governanceKeys = {
  matrix: ['responsibility-matrix'] as const,
  rules: ['responsibility-rules'] as const,
  changeRequests: (status: ChangeRequestStatus | '', proposerUserId?: number) =>
    ['change-requests', { status, proposerUserId: proposerUserId ?? null }] as const,
};

/** The full responsibility (RACI) matrix. */
export function useResponsibilityMatrixQuery() {
  return useQuery({
    queryKey: governanceKeys.matrix,
    queryFn: async (): Promise<MatrixEntry[]> => {
      const res = await getResponsibilityMatrix();
      return res.data?.matrix ?? [];
    },
  });
}

/** Active responsibility rules; only fetched when the matrix tab is open. */
export function useResponsibilityRulesQuery(enabled: boolean) {
  return useQuery({
    queryKey: governanceKeys.rules,
    queryFn: async (): Promise<ResponsibilityRule[]> => {
      const res = await listResponsibilityRules({ isActive: true });
      return res.success ? (res.data as ResponsibilityRule[]) : [];
    },
    enabled,
  });
}

interface ChangeRequestPage {
  items: ChangeRequest[];
  total: number;
}

/** Change requests filtered by status/proposer; only fetched when that tab is open. */
export function useChangeRequestsQuery(
  enabled: boolean,
  status: ChangeRequestStatus | '',
  proposerUserId?: number
) {
  return useQuery({
    queryKey: governanceKeys.changeRequests(status, proposerUserId),
    queryFn: async (): Promise<ChangeRequestPage> => {
      const filters: Parameters<typeof listChangeRequests>[0] = {};
      if (status) filters.status = status;
      if (proposerUserId) filters.proposerUserId = proposerUserId;
      const res = await listChangeRequests(filters);
      if (res.success && res.data) {
        return res.data as ChangeRequestPage;
      }
      return { items: [], total: 0 };
    },
    enabled,
  });
}
