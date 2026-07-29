/**
 * Departments as server state on their own.
 *
 * WHY SEPARATE FROM `useShiftsPageData`. That hook fetches shifts, schedules
 * and departments together because the shifts page needs all three at once. A
 * page that needs only the department list would pay for the other two, and
 * one of them — every shift in the system — is the expensive one.
 *
 * @author Luca Ostinelli
 */

import { useQuery } from '@tanstack/react-query';
import { getDepartments } from '../services/departmentService';
import type { Department } from '../types';

export function useDepartmentsQuery(enabled = true) {
  return useQuery({
    queryKey: ['departments'],
    queryFn: async (): Promise<Department[]> => (await getDepartments()).data ?? [],
    enabled,
  });
}
