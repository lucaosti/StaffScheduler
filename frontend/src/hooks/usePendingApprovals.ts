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

import { useQuery } from '@tanstack/react-query';
import { listPendingApprovals, type PendingApprovalItem } from '../services/pendingApprovalService';

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
