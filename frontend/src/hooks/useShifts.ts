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
