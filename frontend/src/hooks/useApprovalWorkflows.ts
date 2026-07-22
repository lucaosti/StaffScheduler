/**
 * Approval-workflows list hook (TanStack Query).
 *
 * The admin page lists configurable approval workflows and mutates them
 * (create / update / delete). As a cached query the list dedupes/retries; the
 * page's mutation handlers call `reload()` which invalidates this key.
 *
 * @author Luca Ostinelli
 */

import { useQuery } from '@tanstack/react-query';
import { listWorkflows, type ApprovalWorkflow } from '../services/approvalWorkflowService';

export const approvalWorkflowsKey = ['approval-workflows'] as const;

/** All configured approval workflows. */
export function useApprovalWorkflowsQuery() {
  return useQuery({
    queryKey: approvalWorkflowsKey,
    queryFn: async (): Promise<ApprovalWorkflow[]> => {
      const res = await listWorkflows();
      return res.data ?? [];
    },
  });
}
