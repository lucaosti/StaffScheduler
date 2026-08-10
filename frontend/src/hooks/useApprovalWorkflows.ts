/**
 * Approval-workflows server-state hooks (TanStack Query).
 *
 * The admin page lists configurable approval workflows and mutates them
 * (create / update / delete); each mutation invalidates the list on success.
 *
 * @author Luca Ostinelli
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createWorkflow,
  deleteWorkflow,
  listWorkflows,
  updateWorkflow,
  type ApprovalWorkflow,
  type CreateWorkflowBody,
  type UpdateWorkflowBody,
} from '../services/approvalWorkflowService';

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

/** Create / update / delete a workflow. Each invalidates the whole list. */
export function useApprovalWorkflowMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: approvalWorkflowsKey });

  return {
    create: useMutation({
      mutationFn: (body: CreateWorkflowBody) => createWorkflow(body),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: { id: number } & UpdateWorkflowBody) => updateWorkflow(id, body),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteWorkflow(id),
      onSuccess: invalidate,
    }),
  };
}
