/**
 * On-call server-state hooks (TanStack Query).
 *
 * "When am I on call" and "who is on call" are separate queries with separate
 * keys: the first is gated only on being signed in, the second on
 * `schedule.read`, and a person may hold the first without the second. Folding
 * them together would make one query's permission decide the other's.
 *
 * A period's assignments are keyed per period and gated with `enabled`,
 * because they are only fetched while someone has that period open.
 *
 * @author Luca Ostinelli
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  assignToPeriod,
  createOnCallPeriod,
  deleteOnCallPeriod,
  getMyOnCall,
  getOnCallPeriods,
  getPeriodAssignments,
  MineFilters,
  OnCallAssignment,
  OnCallPeriod,
  PeriodFilters,
  removeFromPeriod,
  updateOnCallPeriod,
} from '../services/onCallService';

const onCallKeys = {
  all: ['on-call'] as const,
  mine: (filters: MineFilters) => ['on-call', 'mine', filters] as const,
  periods: (filters: PeriodFilters) => ['on-call', 'periods', filters] as const,
  assignments: (periodId: number) => ['on-call', 'assignments', periodId] as const,
};

export function useMyOnCallQuery(filters: MineFilters = {}) {
  return useQuery({
    queryKey: onCallKeys.mine(filters),
    queryFn: async (): Promise<OnCallPeriod[]> => (await getMyOnCall(filters)).data ?? [],
  });
}

export function useOnCallPeriodsQuery(filters: PeriodFilters = {}, enabled = true) {
  return useQuery({
    queryKey: onCallKeys.periods(filters),
    queryFn: async (): Promise<OnCallPeriod[]> => (await getOnCallPeriods(filters)).data ?? [],
    enabled,
  });
}

export function usePeriodAssignmentsQuery(periodId: number | null) {
  return useQuery({
    queryKey: onCallKeys.assignments(periodId ?? 0),
    queryFn: async (): Promise<OnCallAssignment[]> =>
      (await getPeriodAssignments(periodId as number)).data ?? [],
    enabled: periodId !== null,
  });
}

export function useOnCallMutations() {
  const queryClient = useQueryClient();
  // Everything under one key: assigning someone changes the period's
  // `assignedCount`, so refreshing only the assignment list would leave the
  // period saying it is short-staffed when it no longer is.
  const invalidate = () => queryClient.invalidateQueries({ queryKey: onCallKeys.all });

  return {
    create: useMutation({
      mutationFn: (body: {
        departmentId: number;
        date: string;
        startTime: string;
        endTime: string;
        minStaff?: number;
        maxStaff?: number;
      }) => createOnCallPeriod(body),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: { id: number } & Record<string, unknown>) =>
        updateOnCallPeriod(id, body as never),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteOnCallPeriod(id),
      onSuccess: invalidate,
    }),
    assign: useMutation({
      mutationFn: ({ id, userId }: { id: number; userId: number }) => assignToPeriod(id, userId),
      onSuccess: invalidate,
    }),
    unassign: useMutation({
      mutationFn: ({ id, userId }: { id: number; userId: number }) =>
        removeFromPeriod(id, userId),
      onSuccess: invalidate,
    }),
  };
}
