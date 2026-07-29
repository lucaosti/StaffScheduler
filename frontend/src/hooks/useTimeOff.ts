/**
 * Time-off server-state hooks (TanStack Query).
 *
 * The approver's queue and the caller's own requests are separate queries with
 * separate keys, because they answer different questions and a manager sees
 * both at once — folding them together would mean one refetch could not
 * distinguish "my request changed" from "someone else's did".
 *
 * Every mutation invalidates both. A decision changes a row in the queue AND,
 * when a manager decides their own request, in their own list; invalidating
 * only the one the click came from would leave the other stale on screen.
 *
 * @author Luca Ostinelli
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TimeOffRequest } from '../types';
import {
  approveTimeOff,
  cancelTimeOff,
  createTimeOffRequest,
  getTimeOffRequests,
  rejectTimeOff,
  TimeOffFilters,
} from '../services/timeOffService';

const timeOffKeys = {
  all: ['time-off'] as const,
  list: (filters: TimeOffFilters) => ['time-off', filters] as const,
};

export function useTimeOffQuery(filters: TimeOffFilters = {}, enabled = true) {
  return useQuery({
    queryKey: timeOffKeys.list(filters),
    queryFn: async (): Promise<TimeOffRequest[]> =>
      (await getTimeOffRequests(filters)).data ?? [],
    enabled,
  });
}

export function useTimeOffMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: timeOffKeys.all });

  return {
    request: useMutation({
      mutationFn: (body: { startDate: string; endDate: string; type: string; reason?: string }) =>
        createTimeOffRequest(body as never),
      onSuccess: invalidate,
    }),
    approve: useMutation({
      mutationFn: ({ id, notes }: { id: number; notes?: string }) => approveTimeOff(id, notes),
      onSuccess: invalidate,
    }),
    reject: useMutation({
      mutationFn: ({ id, notes }: { id: number; notes?: string }) => rejectTimeOff(id, notes),
      onSuccess: invalidate,
    }),
    cancel: useMutation({ mutationFn: (id: number) => cancelTimeOff(id), onSuccess: invalidate }),
  };
}
