/**
 * Governance / responsibility server-state hooks (TanStack Query).
 *
 * The matrix query is shared by the RaciMatrix page (read-only matrix view)
 * and the Governance page, so both read the same cache entry instead of each
 * fetching independently. The rule and change-request mutations back the
 * Governance page's two tabs; each invalidates the query family its own
 * writes affect rather than the caller managing `queryClient` by hand.
 *
 * @author Luca Ostinelli
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createResponsibilityRule,
  deleteResponsibilityRule,
  getResponsibilityMatrix,
  listResponsibilityRules,
  updateResponsibilityRule,
  type CreateResponsibilityRuleInput,
  type MatrixEntry,
  type ResponsibilityRule,
  type UpdateResponsibilityRuleInput,
} from '../services/responsibilityService';
import {
  applyChangeRequest,
  approveChangeRequest,
  cancelChangeRequest,
  createChangeRequest,
  listChangeRequests,
  rejectChangeRequest,
  type ChangeRequest,
  type ChangeRequestStatus,
  type CreateChangeRequestInput,
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

/** Create / toggle-active / delete a responsibility rule. Each invalidates the rules list. */
export function useResponsibilityRuleMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: governanceKeys.rules });

  return {
    create: useMutation({
      mutationFn: (input: CreateResponsibilityRuleInput) => createResponsibilityRule(input),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, ...patch }: { id: number } & UpdateResponsibilityRuleInput) =>
        updateResponsibilityRule(id, patch),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteResponsibilityRule(id),
      onSuccess: invalidate,
    }),
  };
}

/**
 * Propose / approve / reject / apply / cancel a change request. Each
 * invalidates the whole `change-requests` family (every status/proposer
 * filter variant) rather than one — a decision on one filtered view is
 * exactly what the queue on every other filtered view needs to know about.
 */
export function useChangeRequestMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['change-requests'] });

  return {
    create: useMutation({
      mutationFn: (input: CreateChangeRequestInput) => createChangeRequest(input),
      onSuccess: invalidate,
    }),
    approve: useMutation({
      mutationFn: (id: number) => approveChangeRequest(id),
      onSuccess: invalidate,
    }),
    reject: useMutation({
      mutationFn: ({ id, reason }: { id: number; reason: string }) => rejectChangeRequest(id, reason),
      onSuccess: invalidate,
    }),
    apply: useMutation({
      mutationFn: (id: number) => applyChangeRequest(id),
      onSuccess: invalidate,
    }),
    cancel: useMutation({
      mutationFn: (id: number) => cancelChangeRequest(id),
      onSuccess: invalidate,
    }),
  };
}
