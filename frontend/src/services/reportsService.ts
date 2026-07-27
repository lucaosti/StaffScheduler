/**
 * Reports client.
 *
 * Routed through the generated client so path, method and query are checked
 * against the OpenAPI contract at compile time. See `departmentService` for
 * the full rationale.
 *
 * WHY THE RANGE PARAMETERS ARE DERIVED RATHER THAN SPELLED OUT: these two
 * endpoints accept `startDate`/`endDate` AND the legacy `start`/`end`. That
 * pair exists because the spec once published `startDate`/`endDate` while the
 * handlers read `start`/`end`, so a caller following the documentation got a
 * 400; the documented names won and the old ones stayed as aliases so no
 * existing caller broke. This service is one of those callers — it still sends
 * `start`/`end`. Deriving the type keeps both spellings visible rather than
 * baking the legacy one into a hand-written signature, so the eventual
 * migration is a rename here instead of an archaeology exercise.
 *
 * The response row types stay hand-written: report projections are computed
 * shapes, not domain entities in `packages/shared/src/domain.ts`, so there is
 * nothing to derive them from.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import type { paths } from '../api/schema';
import { apiClient } from '../api/client';

export interface HoursWorkedRow {
  userId: number;
  fullName: string;
  hours: number;
}

export interface CostByDepartmentRow {
  departmentId: number;
  departmentName: string;
  hours: number;
  cost: number;
}

export interface FairnessReport {
  scheduleId: number;
  perUser: HoursWorkedRow[];
  stats: { count: number; min: number; max: number; mean: number; stddev: number };
}

type ReportRange = NonNullable<paths['/reports/hours-worked']['get']['parameters']['query']>;

/**
 * Builds the range query, annotated with the derived type so the legacy
 * spelling this service still sends is checked against the contract rather
 * than assumed. Changing to `startDate`/`endDate` is a two-line edit here.
 */
const range = (start: string, end: string, departmentId?: number): ReportRange => ({
  start,
  end,
  departmentId,
});

export const hoursWorked = (
  start: string,
  end: string,
  departmentId?: number
): Promise<ApiResponse<HoursWorkedRow[]>> =>
  apiClient.get<HoursWorkedRow[], '/reports/hours-worked'>('/reports/hours-worked', {
    query: range(start, end, departmentId),
  });

export const costByDepartment = (
  start: string,
  end: string
): Promise<ApiResponse<CostByDepartmentRow[]>> =>
  apiClient.get<CostByDepartmentRow[], '/reports/cost-by-department'>(
    '/reports/cost-by-department',
    { query: range(start, end) }
  );

export const fairnessReport = (scheduleId: number): Promise<ApiResponse<FairnessReport>> =>
  apiClient.get<FairnessReport, '/reports/fairness/{scheduleId}'>('/reports/fairness/{scheduleId}', {
    params: { scheduleId },
  });
