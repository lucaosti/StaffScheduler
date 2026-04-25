/**
 * Schedule Service
 *
 * API client for schedule management operations including:
 * - CRUD operations for schedules
 * - Schedule generation and optimization
 * - Schedule publishing and archiving
 *
 * All HTTP responses flow through `handleResponse` from `apiUtils` so that
 * error shapes are consistent with the rest of the frontend.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import { getAuthHeaders, handleResponse } from './apiUtils';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

export interface CreateScheduleParams {
  name: string;
  startDate: string;
  endDate: string;
  departmentId: string;
}

export interface GenerateScheduleResponse {
  scheduleId: string;
  totalAssignments: number;
  coverage: string;
  fairnessScore: string;
  message: string;
}

const request = async <T>(
  path: string,
  init: RequestInit = {}
): Promise<ApiResponse<T>> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { ...getAuthHeaders(), ...(init.headers || {}) },
  });
  return handleResponse<T>(response);
};

export const getSchedules = (params?: Record<string, string>) => {
  const query = new URLSearchParams(params || {}).toString();
  const suffix = query ? `?${query}` : '';
  return request<any[]>(`/schedules${suffix}`);
};

export const getScheduleById = (id: string | number) =>
  request<any>(`/schedules/${id}`);

export const getScheduleWithShifts = (id: string | number) =>
  request<any>(`/schedules/${id}/shifts`);

export const createSchedule = (params: CreateScheduleParams) =>
  request<any>('/schedules', {
    method: 'POST',
    body: JSON.stringify(params),
  });

export const updateSchedule = (id: string | number, params: Partial<CreateScheduleParams>) =>
  request<any>(`/schedules/${id}`, {
    method: 'PUT',
    body: JSON.stringify(params),
  });

export const deleteSchedule = (id: string | number) =>
  request<any>(`/schedules/${id}`, { method: 'DELETE' });

export const generateSchedule = (id: string | number) =>
  request<GenerateScheduleResponse>(`/schedules/${id}/generate`, { method: 'POST' });

export const publishSchedule = (id: string | number) =>
  request<any>(`/schedules/${id}/publish`, { method: 'PATCH' });

export const archiveSchedule = (id: string | number) =>
  request<any>(`/schedules/${id}/archive`, { method: 'PATCH' });

export const duplicateSchedule = (id: string | number, params: CreateScheduleParams) =>
  request<any>(`/schedules/${id}/duplicate`, {
    method: 'POST',
    body: JSON.stringify(params),
  });

export const getSchedulesByDepartment = (departmentId: string) =>
  request<any[]>(`/schedules/department/${departmentId}`);

const scheduleService = {
  getSchedules,
  getScheduleById,
  getScheduleWithShifts,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  generateSchedule,
  publishSchedule,
  archiveSchedule,
  duplicateSchedule,
  getSchedulesByDepartment,
};

export default scheduleService;
