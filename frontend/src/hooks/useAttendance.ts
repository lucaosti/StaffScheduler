/**
 * Attendance server-state hooks (TanStack Query).
 *
 * The Attendance page reads three things — the current user's records, the
 * approval queue (only for approvers), and a cost estimate (only for cost
 * readers) — and mutates them via clock-in/out and approve/reject. Previously
 * each was a hand-written load with its own flags and every action re-invoked
 * `load()`/`loadCost()` by hand. These hooks turn that into queries gated by
 * permission (`enabled`) plus mutations that invalidate the attendance keys, so
 * one action refreshes exactly the affected data.
 *
 * The cost query tolerates failure (a 404 means the payroll module is off): the
 * caller shows "panel not available" from the query's error, not a global banner.
 *
 * @author Luca Ostinelli
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AttendanceRecord, AttendanceCostEstimate } from '../types';
import {
  clockIn,
  clockOut,
  getAttendanceRecords,
  getPendingApprovals,
  approveAttendance,
  rejectAttendance,
  getCostEstimate,
} from '../services/attendanceService';

const attendanceKeys = {
  all: ['attendance'] as const,
  records: (userId?: number) => ['attendance', 'records', userId ?? null] as const,
  pending: ['attendance', 'pending'] as const,
  cost: (startDate: string, endDate: string) => ['attendance', 'cost', startDate, endDate] as const,
};

/** The current user's attendance records. */
export function useMyAttendanceQuery(userId?: number) {
  return useQuery({
    queryKey: attendanceKeys.records(userId),
    queryFn: async (): Promise<AttendanceRecord[]> => {
      const res = await getAttendanceRecords({ userId });
      return res.data ?? [];
    },
  });
}

/** The pending-approval queue; only fetched for approvers. */
export function usePendingAttendanceQuery(enabled: boolean) {
  return useQuery({
    queryKey: attendanceKeys.pending,
    queryFn: async (): Promise<AttendanceRecord[]> => {
      const res = await getPendingApprovals();
      return res.data ?? [];
    },
    enabled,
  });
}

/** Cost estimate over a window; only fetched for cost readers. Failure = panel off. */
export function useAttendanceCostQuery(enabled: boolean, startDate: string, endDate: string) {
  return useQuery({
    queryKey: attendanceKeys.cost(startDate, endDate),
    queryFn: async (): Promise<AttendanceCostEstimate | null> => {
      const res = await getCostEstimate({ startDate, endDate });
      return res.data ?? null;
    },
    enabled,
  });
}

/** Clock-in / clock-out / approve / reject — each invalidates attendance data. */
export function useAttendanceMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: attendanceKeys.all });

  const clockInMutation = useMutation({ mutationFn: () => clockIn(), onSuccess: invalidate });
  const clockOutMutation = useMutation({
    mutationFn: (id: number | string) => clockOut(id),
    onSuccess: invalidate,
  });
  const decisionMutation = useMutation({
    mutationFn: ({ id, decision }: { id: number | string; decision: 'approve' | 'reject' }) =>
      decision === 'approve' ? approveAttendance(id) : rejectAttendance(id),
    onSuccess: invalidate,
  });

  return { clockInMutation, clockOutMutation, decisionMutation };
}
