/**
 * Shifts server-state hooks (TanStack Query).
 *
 * The Shifts page reads three lists together (shifts, schedules, departments —
 * the last two feed the create/edit form's dropdowns) and mutates shifts via a
 * shared create/update form plus delete. As with the Schedule page, one
 * composite query is the right unit because the three load as a single screen;
 * the create/update/delete mutations invalidate that one key so the table
 * refreshes itself instead of a hand-written `loadShifts()` after each action.
 *
 * @author Luca Ostinelli
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Shift, Schedule } from '../types';
import * as shiftService from '../services/shiftService';
import { getSchedules } from '../services/scheduleService';
import { getDepartments, type Department } from '../services/departmentService';
import { ApiError } from '../services/apiUtils';

interface ShiftsPageData {
  shifts: Shift[];
  schedules: Schedule[];
  departments: Department[];
}

const shiftsPageKey = ['shifts-page'] as const;

/**
 * Shifts for an explicit date range, optionally narrowed to one department.
 *
 * The Schedule page's month grid used to load this with a hand-rolled effect
 * (`setMonthLoading`, a `cancelled` flag, an exhaustive-deps suppression) —
 * the one page left outside the convention the rest of the frontend follows,
 * and therefore the one view with no caching or deduplication. `enabled` gates
 * it so nothing is fetched until the month view is actually shown.
 *
 * The department filter is pushed into the query rather than applied to the
 * response: the endpoint has accepted `departmentId` since its query contract
 * was declared as a schema, so filtering client-side would fetch rows only to
 * discard them.
 */
export function useShiftsInRange(
  range: { startDate: string; endDate: string; departmentId?: number },
  options: { enabled?: boolean } = {}
) {
  return useQuery({
    queryKey: ['shifts-range', range.startDate, range.endDate, range.departmentId ?? null] as const,
    enabled: options.enabled ?? true,
    queryFn: async (): Promise<Shift[]> => {
      const response = await shiftService.getShifts(range);
      if (!response.success || !response.data) {
        throw new ApiError(response.error?.message ?? 'Failed to load shifts', 500);
      }
      return response.data;
    },
  });
}

/** The Shifts page's three lists as one cached unit. */
export function useShiftsPageData() {
  return useQuery({
    queryKey: shiftsPageKey,
    queryFn: async (): Promise<ShiftsPageData> => {
      const [shiftsResponse, schedulesResponse, departmentsResponse] = await Promise.all([
        shiftService.getShifts({}),
        getSchedules(),
        getDepartments(),
      ]);
      if (!shiftsResponse.success || !shiftsResponse.data) {
        throw new ApiError(
          'Failed to load shifts. Please ensure the backend is running and database is populated.'
        );
      }
      return {
        shifts: shiftsResponse.data,
        schedules: schedulesResponse.success && schedulesResponse.data ? schedulesResponse.data : [],
        departments:
          departmentsResponse.success && departmentsResponse.data ? departmentsResponse.data : [],
      };
    },
  });
}

/** Payload accepted by both create and update. */
type ShiftPayload = Parameters<typeof shiftService.createShift>[0];

export function useDeleteShift() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string | number) => shiftService.deleteShift(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: shiftsPageKey }),
  });
}

/** Create (no id) or update (with id) a shift; invalidates the page data on success. */
export function useSaveShift() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id?: string | number; data: ShiftPayload }) =>
      id !== undefined ? shiftService.updateShift(id, data) : shiftService.createShift(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: shiftsPageKey }),
  });
}
