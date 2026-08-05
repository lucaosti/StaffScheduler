/**
 * Seasonal-baseline staffing suggestion (TanStack Query).
 *
 * Gated with `enabled` rather than a mount-fetch effect: the query only makes
 * sense once the caller has picked a department, date and time window, and
 * firing it eagerly on every keystroke would spam the endpoint while the form
 * is still being filled in.
 *
 * @author Luca Ostinelli
 */

import { useQuery } from '@tanstack/react-query';
import {
  getStaffingSuggestion,
  StaffingSuggestion,
  StaffingSuggestionQuery,
} from '../services/shiftService';

export function useStaffingSuggestion(
  query: Partial<StaffingSuggestionQuery>,
  enabled = true
) {
  const { departmentId, date, startTime, endTime } = query;
  const ready = Boolean(departmentId && date && startTime && endTime);

  return useQuery({
    queryKey: ['staffing-suggestion', departmentId, date, startTime, endTime],
    queryFn: async (): Promise<StaffingSuggestion> => {
      const response = await getStaffingSuggestion({
        departmentId: departmentId as number,
        date: date as string,
        startTime: startTime as string,
        endTime: endTime as string,
      });
      if (!response.success || !response.data) {
        throw new Error('Failed to load staffing suggestion');
      }
      return response.data;
    },
    enabled: enabled && ready,
  });
}
