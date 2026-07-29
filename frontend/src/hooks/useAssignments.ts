/**
 * Assignment server-state hooks (TanStack Query).
 *
 * Every mutation invalidates the whole assignment key rather than patching one
 * cached row. An assignment changing status changes what the OTHER rows on the
 * same shift mean — a shift one person declines may now be short-staffed — and
 * a surgical cache update would leave the screen internally consistent and
 * wrong.
 *
 * @author Luca Ostinelli
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Assignment } from '../types';
import {
  AssignmentFilters,
  AvailableEmployee,
  completeAssignment,
  confirmAssignment,
  createAssignment,
  declineAssignment,
  deleteAssignment,
  getAssignments,
  getAvailableEmployees,
  getMyAssignments,
} from '../services/assignmentService';

const assignmentKeys = {
  all: ['assignments'] as const,
  mine: (userId: number) => ['assignments', 'mine', userId] as const,
  list: (filters: AssignmentFilters) => ['assignments', filters] as const,
  available: (shiftId: number) => ['assignments', 'available', shiftId] as const,
};

export function useAssignmentsQuery(filters: AssignmentFilters = {}) {
  return useQuery({
    queryKey: assignmentKeys.list(filters),
    queryFn: async (): Promise<Assignment[]> => (await getAssignments(filters)).data ?? [],
  });
}

/**
 * The caller's own assignments.
 *
 * A different endpoint from the planner's listing, not a filtered form of it:
 * `GET /assignments` is gated on `assignment.manage`, which an ordinary
 * employee does not hold, while `GET /assignments/user/{id}` lets someone read
 * their own. Reaching for the collection with a `userId` filter looks
 * equivalent and fails for precisely the audience this serves.
 */
export function useMyAssignmentsQuery(userId: number | null) {
  return useQuery({
    queryKey: assignmentKeys.mine(userId ?? 0),
    queryFn: async (): Promise<Assignment[]> =>
      (await getMyAssignments(userId as number)).data ?? [],
    enabled: userId !== null,
  });
}

/**
 * Who may still be put on this shift.
 *
 * Gated with `enabled` rather than a conditional effect: the picker is only
 * open some of the time, and asking the server who is available for a shift
 * nobody is looking at is work for an answer nobody reads.
 */
export function useAvailableEmployeesQuery(shiftId: number | null) {
  return useQuery({
    queryKey: assignmentKeys.available(shiftId ?? 0),
    queryFn: async (): Promise<AvailableEmployee[]> =>
      (await getAvailableEmployees(shiftId as number)).data ?? [],
    enabled: shiftId !== null,
  });
}

export function useAssignmentMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: assignmentKeys.all });

  return {
    create: useMutation({
      mutationFn: (body: { shiftId: number; userId: number; notes?: string }) =>
        createAssignment(body),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: (id: number) => deleteAssignment(id), onSuccess: invalidate }),
    confirm: useMutation({
      mutationFn: (id: number) => confirmAssignment(id),
      onSuccess: invalidate,
    }),
    decline: useMutation({
      mutationFn: (id: number) => declineAssignment(id),
      onSuccess: invalidate,
    }),
    complete: useMutation({
      mutationFn: (id: number) => completeAssignment(id),
      onSuccess: invalidate,
    }),
  };
}
