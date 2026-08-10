/**
 * Pending-approvals list hook (TanStack Query).
 *
 * Covers the page's main queue, keyed by the pending/all filter so switching it
 * refetches. The per-row chain-of-command panel stays imperative in the page —
 * it is genuinely on-demand detail loaded on expand, not the mount-load-refetch
 * boilerplate this migration targets. Decision mutations invalidate this key so
 * the queue refreshes from one place.
 *
 * @author Luca Ostinelli
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  approvePendingItem,
  delegatePendingItem,
  keepPendingItem,
  listPendingApprovals,
  openPendingItemToStructure,
  rejectPendingItem,
  type PendingApprovalItem,
} from '../services/pendingApprovalService';

export const pendingApprovalsKey = ['pending-approvals'] as const;

/** The pending-approval queue, filtered to pending-only or all. */
export function usePendingApprovalsQuery(filter: 'pending' | 'all') {
  return useQuery({
    queryKey: [...pendingApprovalsKey, filter],
    queryFn: async (): Promise<PendingApprovalItem[]> => {
      const status = filter === 'pending' ? 'pending' : undefined;
      const res = await listPendingApprovals(status as string);
      return res.data?.items ?? [];
    },
  });
}

/**
 * Approve / reject / keep / delegate / open-to-structure a queue item. Each
 * invalidates the whole `pending-approvals` family (both the pending-only
 * and all filter variants), since a decision on one filtered view is exactly
 * what every other filtered view needs to know about.
 */
export function usePendingApprovalMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: pendingApprovalsKey });

  return {
    approve: useMutation({
      mutationFn: ({ id, note }: { id: number; note?: string }) => approvePendingItem(id, note),
      onSuccess: invalidate,
    }),
    reject: useMutation({
      mutationFn: ({ id, note }: { id: number; note?: string }) => rejectPendingItem(id, note),
      onSuccess: invalidate,
    }),
    keep: useMutation({
      mutationFn: (id: number) => keepPendingItem(id),
      onSuccess: invalidate,
    }),
    delegate: useMutation({
      mutationFn: ({ id, targetUserId }: { id: number; targetUserId: number }) =>
        delegatePendingItem(id, targetUserId),
      onSuccess: invalidate,
    }),
    openToStructure: useMutation({
      mutationFn: (id: number) => openPendingItemToStructure(id),
      onSuccess: invalidate,
    }),
  };
}
