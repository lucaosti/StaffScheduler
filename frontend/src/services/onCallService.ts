/**
 * On-call service — wraps `/api/on-call`.
 *
 * `OnCallPeriod` and `OnCallAssignment` are declared here rather than in the
 * shared package: neither is in `domain.ts` yet, so there is nothing to derive
 * from. Written to match the service's own interfaces exactly, and kept
 * minimal so the drift a hand-written type invites has as little surface as
 * possible — the same drift #517 records having happened to assignments.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import type { paths } from '../api/schema';
import { apiClient } from '../api/client';

export interface OnCallPeriod {
  id: number;
  scheduleId: number | null;
  departmentId: number;
  departmentName?: string;
  date: string;
  startTime: string;
  endTime: string;
  minStaff: number;
  maxStaff: number;
  notes: string | null;
  status: 'open' | 'assigned' | 'cancelled';
  /** How many people are on it — the reason a period can look understaffed. */
  assignedCount: number;
}

export interface OnCallAssignment {
  id: number;
  periodId: number;
  userId: number;
  userName?: string;
  status: 'pending' | 'confirmed' | 'cancelled';
  notes: string | null;
}

export type PeriodFilters = NonNullable<paths['/on-call/periods']['get']['parameters']['query']>;
export type MineFilters = NonNullable<paths['/on-call/me']['get']['parameters']['query']>;
type CreatePeriodBody = NonNullable<
  paths['/on-call/periods']['post']['requestBody']
>['content']['application/json'];
type UpdatePeriodBody = NonNullable<
  paths['/on-call/periods/{id}']['put']['requestBody']
>['content']['application/json'];
type AssignBody = NonNullable<
  paths['/on-call/periods/{id}/assign']['post']['requestBody']
>['content']['application/json'];

export const getMyOnCall = (filters: MineFilters = {}): Promise<ApiResponse<OnCallPeriod[]>> =>
  apiClient.get<OnCallPeriod[], '/on-call/me'>('/on-call/me', { query: filters });

export const getOnCallPeriods = (
  filters: PeriodFilters = {}
): Promise<ApiResponse<OnCallPeriod[]>> =>
  apiClient.get<OnCallPeriod[], '/on-call/periods'>('/on-call/periods', { query: filters });

export const createOnCallPeriod = (body: CreatePeriodBody): Promise<ApiResponse<OnCallPeriod>> =>
  apiClient.post<OnCallPeriod, '/on-call/periods'>('/on-call/periods', body);

export const updateOnCallPeriod = (
  id: number,
  body: UpdatePeriodBody
): Promise<ApiResponse<OnCallPeriod>> =>
  apiClient.put<OnCallPeriod, '/on-call/periods/{id}'>('/on-call/periods/{id}', body, {
    params: { id },
  });

export const deleteOnCallPeriod = (id: number): Promise<ApiResponse<void>> =>
  apiClient.delete<void, '/on-call/periods/{id}'>('/on-call/periods/{id}', { params: { id } });

export const getPeriodAssignments = (
  id: number
): Promise<ApiResponse<OnCallAssignment[]>> =>
  apiClient.get<OnCallAssignment[], '/on-call/periods/{id}/assignments'>(
    '/on-call/periods/{id}/assignments',
    { params: { id } }
  );

export const assignToPeriod = (
  id: number,
  userId: number
): Promise<ApiResponse<OnCallAssignment>> =>
  apiClient.post<OnCallAssignment, '/on-call/periods/{id}/assign'>(
    '/on-call/periods/{id}/assign',
    { userId } satisfies AssignBody,
    { params: { id } }
  );

export const removeFromPeriod = (id: number, userId: number): Promise<ApiResponse<void>> =>
  apiClient.delete<void, '/on-call/periods/{id}/assign/{userId}'>(
    '/on-call/periods/{id}/assign/{userId}',
    { params: { id, userId } }
  );
