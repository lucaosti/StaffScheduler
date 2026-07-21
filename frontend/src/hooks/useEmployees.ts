/**
 * Server-state hooks for employees and departments (TanStack Query).
 *
 * WHY THESE LIVE IN A HOOK, NOT IN THE PAGE
 * -----------------------------------------
 * The Employees page previously owned all of this: a loading flag, an error
 * string, a mount effect, a debounce-timer ref, and manual `reload()` calls
 * after every create/update/delete. Extracting it into query/mutation hooks
 * gives one cache keyed by the search+department filter, request deduplication,
 * background refetch, and — the part hand-rolled code kept getting subtly wrong
 * — a single invalidation point: every mutation invalidates the employees key,
 * so the list (and any other observer of the same key) refreshes exactly once,
 * from one place. Other pages that need the same data import the same hooks and
 * share the same cache entry rather than re-fetching.
 *
 * The service layer returns the ApiResponse envelope ({ success, data, error }).
 * The query functions unwrap it and THROW on failure, because TanStack Query's
 * error state is driven by thrown errors — this is what turns a failed request
 * into `isError`/`error` for the UI instead of a silently empty list.
 *
 * @author Luca Ostinelli
 */

import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import * as employeeService from '../services/employeeService';
import type { CreateEmployeeData, UpdateEmployeeData } from '../services/employeeService';
import { getDepartments } from '../services/departmentService';

/**
 * Query-key factory. Centralising the keys means a mutation can invalidate
 * `employeeKeys.all` and hit every list variant (all search/department filters)
 * without any page needing to know which filters are currently cached.
 */
const employeeKeys = {
  all: ['employees'] as const,
  list: (search: string, department: string) =>
    ['employees', 'list', { search, department }] as const,
};

const departmentKeys = {
  all: ['departments'] as const,
};

/** Employees filtered server-side by search/department. */
export function useEmployeesQuery(search: string, department: string) {
  return useQuery({
    queryKey: employeeKeys.list(search, department),
    queryFn: async () => {
      const res = await employeeService.getEmployees({
        search: search || undefined,
        department: department || undefined,
        limit: 50,
      });
      if (!res.success || !res.data) {
        throw new Error(res.error?.message ?? 'Failed to load employees.');
      }
      return res.data;
    },
    // Keep the previous page of results visible while a new filter fetches, so
    // typing in the search box updates smoothly instead of flashing a spinner —
    // this preserves the old "don't show the full-page loader on filter change"
    // behaviour without a manual showLoading flag.
    placeholderData: keepPreviousData,
  });
}

/** Departments for the employee form's dropdown. Non-critical: failure is tolerated by callers. */
export function useDepartmentsQuery() {
  return useQuery({
    queryKey: departmentKeys.all,
    queryFn: async () => {
      const res = await getDepartments();
      if (!res.success || !res.data) {
        throw new Error(res.error?.message ?? 'Failed to load departments.');
      }
      return res.data;
    },
  });
}

/** Delete an employee, then refresh every employees list. */
export function useDeleteEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number | string) => employeeService.deleteEmployee(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: employeeKeys.all }),
  });
}

/**
 * Create or update an employee (one hook, since the form is shared). Passing an
 * `id` updates; omitting it creates. Invalidates the employees list on success.
 */
export function useSaveEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id?: number | string;
      data: CreateEmployeeData | UpdateEmployeeData;
    }) =>
      id !== undefined
        ? employeeService.updateEmployee(id, data as UpdateEmployeeData)
        : employeeService.createEmployee(data as CreateEmployeeData),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: employeeKeys.all }),
  });
}
