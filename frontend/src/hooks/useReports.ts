/**
 * Reports server-state hooks (TanStack Query).
 *
 * The Reports page reads three independent things: the hours-worked + cost-by-
 * department pair for a date range, the schedules list (to pick one), and a
 * fairness report for the selected schedule. Previously each had its own
 * effect/loading/error triple, with the date range wired through a `reload`
 * callback. As queries keyed by their inputs, the date-range pair refetches when
 * the range changes and the fairness report is gated on a schedule being
 * selected (`enabled`) — no manual effect orchestration.
 *
 * @author Luca Ostinelli
 */

import { useQuery } from '@tanstack/react-query';
import {
  hoursWorked,
  costByDepartment,
  fairnessReport,
  type HoursWorkedRow,
  type CostByDepartmentRow,
  type FairnessReport,
} from '../services/reportsService';
import { getSchedules } from '../services/scheduleService';
import type { Schedule } from '../types';

interface RangeReports {
  hours: HoursWorkedRow[];
  cost: CostByDepartmentRow[];
}

/** Hours-worked + cost-by-department for a date range, refetched when the range changes. */
export function useRangeReportsQuery(start: string, end: string) {
  return useQuery({
    queryKey: ['reports', 'range', start, end],
    queryFn: async (): Promise<RangeReports> => {
      const [hoursRes, costRes] = await Promise.all([
        hoursWorked(start, end),
        costByDepartment(start, end),
      ]);
      return {
        hours: hoursRes.success && hoursRes.data ? hoursRes.data : [],
        cost: costRes.success && costRes.data ? costRes.data : [],
      };
    },
  });
}

/** Schedules to choose from for the fairness report. */
export function useReportSchedulesQuery() {
  return useQuery({
    queryKey: ['reports', 'schedules'],
    queryFn: async (): Promise<Schedule[]> => {
      const res = await getSchedules();
      return res.success && res.data ? res.data : [];
    },
  });
}

/** Fairness report for a selected schedule; only fetched once one is chosen. */
export function useFairnessQuery(scheduleId: number | null) {
  return useQuery({
    queryKey: ['reports', 'fairness', scheduleId],
    queryFn: async (): Promise<FairnessReport | null> => {
      const res = await fairnessReport(scheduleId as number);
      return res.success && res.data ? res.data : null;
    },
    enabled: scheduleId !== null,
  });
}
