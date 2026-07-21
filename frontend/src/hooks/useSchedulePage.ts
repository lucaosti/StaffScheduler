/**
 * Aggregate server-state hook for the Schedule page (TanStack Query).
 *
 * WHY ONE COMPOSITE QUERY
 * -----------------------
 * The Schedule page needs four independent lists (schedules, employees, shifts,
 * departments) plus the assignments of the first schedule, and it used to load
 * them with a hand-written `loadData` — a `Promise.all`, a mounted-ref guard
 * against setting state after unmount, and manual `loadData()` re-invocations
 * after every publish/archive/create/generate. Moving that into a single query
 * gives the page caching, request dedup, retry and — crucially — one
 * invalidation key: a mutation calls `invalidate()`/`refetch()` and the whole
 * bundle refreshes, replacing the scattered manual reloads. TanStack Query also
 * discards results from an unmounted observer, so the mounted-ref guard is no
 * longer needed.
 *
 * The four lists are fetched together (they render as one screen and always
 * load as a unit) rather than as four separate queries, so the page has a single
 * loading/error state to reason about, matching its prior behaviour exactly. A
 * failure of the critical `schedules` call throws so the page shows an error;
 * the other lists degrade to empty, as before.
 *
 * @author Luca Ostinelli
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Schedule as ScheduleType, Assignment, Employee, Shift } from '../types';
import * as scheduleService from '../services/scheduleService';
import * as employeeService from '../services/employeeService';
import * as shiftService from '../services/shiftService';
import * as departmentService from '../services/departmentService';
import type { Department } from '../services/departmentService';

interface SchedulePageData {
  schedules: ScheduleType[];
  employees: Employee[];
  shifts: Shift[];
  departments: Department[];
  assignments: Assignment[];
}

const schedulePageKey = ['schedule-page'] as const;

const fetchSchedulePageData = async (): Promise<SchedulePageData> => {
  const [schedulesResponse, employeesResponse, shiftsResponse, departmentsResponse] =
    await Promise.all([
      scheduleService.getSchedules(),
      employeeService.getEmployees({}),
      shiftService.getShifts({}),
      departmentService.getDepartments(),
    ]);

  if (!schedulesResponse.success || !schedulesResponse.data) {
    throw new Error('Failed to load schedules');
  }
  const schedules = schedulesResponse.data;
  const employees = employeesResponse.success && employeesResponse.data ? employeesResponse.data : [];
  const shifts = shiftsResponse.success && shiftsResponse.data ? shiftsResponse.data : [];
  const departments =
    departmentsResponse.success && departmentsResponse.data ? departmentsResponse.data : [];

  // Assignments of the first schedule, flattened from its shifts. Kept as a
  // dependent fetch inside the same query so the page still has one load unit.
  const assignments: Assignment[] = [];
  if (schedules.length > 0) {
    const details = await scheduleService.getScheduleWithShifts(schedules[0].id);
    if (details.success && details.data && Array.isArray(details.data.shifts)) {
      for (const shift of details.data.shifts) {
        if (Array.isArray(shift.assignments)) assignments.push(...shift.assignments);
      }
    }
  }

  return { schedules, employees, shifts, departments, assignments };
};

/** Loads the Schedule page's server state; expose `reload` for post-mutation refresh. */
export function useSchedulePageData() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: schedulePageKey, queryFn: fetchSchedulePageData });

  const reload = async () => {
    await queryClient.invalidateQueries({ queryKey: schedulePageKey });
  };

  return { query, reload };
}
