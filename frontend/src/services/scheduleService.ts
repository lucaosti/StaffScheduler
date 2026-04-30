/**
 * Schedule Service
 *
 * API client for schedule management operations:
 *   - list/get schedules
 *   - create / update / delete a schedule
 *   - generate / publish / archive a schedule
 *
 * All HTTP responses flow through `handleResponse` from `apiUtils` so that
 * error shapes are consistent with the rest of the frontend.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse, Schedule, Shift, Assignment } from '../types';
import { requestJson } from './apiUtils';

interface CreateScheduleParams {
  name: string;
  description?: string;
  startDate: string;
  endDate: string;
  departmentId: number | string;
  notes?: string;
}

type ShiftWithAssignments = Shift & { assignments?: Assignment[] };
type ScheduleWithShifts = Schedule & { shifts: ShiftWithAssignments[] };

interface GenerateScheduleResponse {
  scheduleId: number;
  assignmentsCreated: number;
  totalShifts: number;
  coveragePercentage: number;
  status: string;
}

const request = async <T>(
  path: string,
  init: RequestInit = {}
): Promise<ApiResponse<T>> => {
  return requestJson<T>(path, init);
};

export const getSchedules = (params?: Record<string, string>) => {
  const query = new URLSearchParams(params || {}).toString();
  const suffix = query ? `?${query}` : '';
  return request<Schedule[]>(`/schedules${suffix}`);
};

export const getScheduleWithShifts = (id: string | number) =>
  request<ScheduleWithShifts>(`/schedules/${id}/shifts`);

export const createSchedule = (params: CreateScheduleParams) =>
  request<Schedule>('/schedules', {
    method: 'POST',
    body: JSON.stringify(params),
  });

export const updateSchedule = (id: string | number, params: Partial<CreateScheduleParams>) =>
  request<Schedule>(`/schedules/${id}`, {
    method: 'PUT',
    body: JSON.stringify(params),
  });

export const deleteSchedule = (id: string | number) =>
  request<null>(`/schedules/${id}`, { method: 'DELETE' });

export const generateSchedule = (id: string | number) =>
  request<GenerateScheduleResponse>(`/schedules/${id}/generate`, { method: 'POST' });

export const publishSchedule = (id: string | number) =>
  request<Schedule>(`/schedules/${id}/publish`, { method: 'PATCH' });

export const archiveSchedule = (id: string | number) =>
  request<Schedule>(`/schedules/${id}/archive`, { method: 'PATCH' });
