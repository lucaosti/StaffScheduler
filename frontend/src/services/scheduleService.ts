/**
 * Schedule Service
 *
 * API client for schedule management operations:
 *   - list/get schedules
 *   - create / update / delete a schedule
 *   - generate / publish / archive a schedule
 *
 * This service is a pilot for the generated typed client (`../api/client`):
 * every call is checked at compile time against the OpenAPI contract, so a
 * wrong path, method or request body no longer compiles. The public function
 * signatures are unchanged, so existing call sites and tests keep working —
 * the typing lives inside the module.
 *
 * One real contract drift was fixed in the process: the create/update form
 * collected a `description` field, but the backend `createScheduleBody`
 * schema only accepts `notes`, so the value was silently dropped. The
 * `description` argument is now mapped to `notes` here, which is what the API
 * actually persists.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse, Schedule, Shift, Assignment } from '../types';
import { apiClient } from '../api/client';

interface ShiftWithAssignments extends Shift {
  assignments?: Assignment[];
}

interface ScheduleWithShifts extends Schedule {
  shifts?: ShiftWithAssignments[];
}

interface CreateScheduleParams {
  name: string;
  /** Free-text note; persisted to the backend `notes` field (see module note). */
  description?: string;
  startDate: string;
  endDate: string;
  departmentId: number | string;
  notes?: string;
}

interface GenerateScheduleResponse {
  scheduleId: string;
  totalAssignments: number;
  coverage: string;
  fairnessScore: string;
  message: string;
}

/**
 * The `notes` value the contract persists: `notes` if given, else the legacy
 * `description` (see module note). Undefined when neither is present, so the
 * optional field is simply omitted.
 */
const resolveNotes = (params: Partial<CreateScheduleParams>): string | undefined =>
  params.notes ?? params.description;

export const getSchedules = (params?: Record<string, string>) =>
  apiClient.get<Schedule[], '/schedules'>('/schedules', { query: params });

export const getScheduleWithShifts = (id: string | number) =>
  apiClient.get<ScheduleWithShifts, '/schedules/{id}/shifts'>('/schedules/{id}/shifts', {
    params: { id: Number(id) },
  });

export const createSchedule = (params: CreateScheduleParams): Promise<ApiResponse<Schedule>> =>
  apiClient.post<Schedule, '/schedules'>('/schedules', {
    name: params.name,
    startDate: params.startDate,
    endDate: params.endDate,
    departmentId: Number(params.departmentId),
    notes: resolveNotes(params),
  });

export const updateSchedule = (
  id: string | number,
  params: Partial<CreateScheduleParams>
): Promise<ApiResponse<Schedule>> =>
  apiClient.put<Schedule, '/schedules/{id}'>(
    '/schedules/{id}',
    {
      name: params.name,
      startDate: params.startDate,
      endDate: params.endDate,
      departmentId: params.departmentId !== undefined ? Number(params.departmentId) : undefined,
      notes: resolveNotes(params),
    },
    { params: { id: Number(id) } }
  );

export const deleteSchedule = (id: string | number) =>
  apiClient.delete<{ message: string }, '/schedules/{id}'>('/schedules/{id}', {
    params: { id: Number(id) },
  });

export const generateSchedule = (id: string | number) =>
  apiClient.post<GenerateScheduleResponse, '/schedules/{id}/generate'>(
    '/schedules/{id}/generate',
    undefined,
    { params: { id: Number(id) } }
  );

export const publishSchedule = (id: string | number) =>
  apiClient.patch<Schedule, '/schedules/{id}/publish'>('/schedules/{id}/publish', undefined, {
    params: { id: Number(id) },
  });

export const archiveSchedule = (id: string | number) =>
  apiClient.patch<Schedule, '/schedules/{id}/archive'>('/schedules/{id}/archive', undefined, {
    params: { id: Number(id) },
  });
