/**
 * Shift swap server-state hooks (TanStack Query).
 *
 * The list is not filtered by user here: `GET /shift-swap` is self-scoped
 * server-side, pinning a non-approver to their own requests and ignoring a
 * `userId` filter from one. Passing one anyway would describe a narrowing the
 * server does not perform.
 *
 * Candidates are keyed per assignment and gated with `enabled`: they are only
 * meaningful while someone is choosing, and each lookup runs a conflict check
 * per candidate on the server.
 *
 * @author Luca Ostinelli
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ShiftSwapRequest } from '../types';
import {
  approveSwap,
  cancelSwap,
  createSwapRequest,
  declineSwap,
  getSwapCandidates,
  getSwapRequests,
  respondToSwap,
  SwapCandidates,
  SwapFilters,
} from '../services/shiftSwapService';

const swapKeys = {
  all: ['shift-swap'] as const,
  list: (filters: SwapFilters) => ['shift-swap', filters] as const,
  candidates: (assignmentId: number) => ['shift-swap', 'candidates', assignmentId] as const,
};

export function useSwapRequestsQuery(filters: SwapFilters = {}) {
  return useQuery({
    queryKey: swapKeys.list(filters),
    queryFn: async (): Promise<ShiftSwapRequest[]> => (await getSwapRequests(filters)).data ?? [],
  });
}

export function useSwapCandidatesQuery(assignmentId: number | null) {
  return useQuery({
    queryKey: swapKeys.candidates(assignmentId ?? 0),
    queryFn: async (): Promise<SwapCandidates> =>
      (await getSwapCandidates(assignmentId as number)).data ?? {
        candidates: [],
        truncated: false,
      },
    enabled: assignmentId !== null,
  });
}

export function useSwapMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: swapKeys.all });

  return {
    propose: useMutation({
      mutationFn: (body: {
        requesterAssignmentId: number;
        targetAssignmentId: number;
        notes?: string;
      }) => createSwapRequest(body),
      onSuccess: invalidate,
    }),
    respond: useMutation({
      mutationFn: ({ id, accepted, notes }: { id: number; accepted: boolean; notes?: string }) =>
        respondToSwap(id, accepted, notes),
      onSuccess: invalidate,
    }),
    approve: useMutation({
      mutationFn: ({ id, notes }: { id: number; notes?: string }) => approveSwap(id, notes),
      onSuccess: invalidate,
    }),
    decline: useMutation({
      mutationFn: ({ id, notes }: { id: number; notes?: string }) => declineSwap(id, notes),
      onSuccess: invalidate,
    }),
    cancel: useMutation({ mutationFn: (id: number) => cancelSwap(id), onSuccess: invalidate }),
  };
}
