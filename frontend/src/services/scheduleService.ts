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
  /** Engine that produced the schedule: 'or-tools' (optimal) or 'greedy' (draft/fallback). */
  engine?: 'or-tools' | 'greedy';
  /** True when the optimum was requested but the run fell back to greedy — the result is a draft. */
  degraded?: boolean;
  /** Why the run degraded, when it did (shown to the user). */
  degradedReason?: string;
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

/**
 * Triggers optimization. When the backend job queue is enabled it returns
 * `202` with `{ jobId }` (poll {@link getOptimizationStatus}); without Redis it
 * runs synchronously and returns the result. The union return type reflects
 * both shapes so callers can branch on the presence of `jobId`.
 */
export const generateSchedule = (id: string | number) =>
  apiClient.post<GenerateScheduleResponse | OptimizationEnqueued, '/schedules/{id}/generate'>(
    '/schedules/{id}/generate',
    undefined,
    { params: { id: Number(id) } }
  );

interface OptimizationEnqueued {
  jobId: string;
  scheduleId: number;
  state: string;
}

export interface OptimizationStatus {
  jobId: string;
  state: 'waiting' | 'active' | 'completed' | 'failed' | 'unknown';
  progress: number;
  result?: GenerateScheduleResponse;
  failedReason?: string;
}

/** Reads the status/progress/result of a schedule's optimization job. */
export const getOptimizationStatus = (id: string | number) =>
  apiClient.get<OptimizationStatus, '/schedules/{id}/optimization'>('/schedules/{id}/optimization', {
    params: { id: Number(id) },
  });

// Note: the backend also exposes DELETE /schedules/:id/optimization to cancel a
// job. The frontend cancel control lands with the Schedule page's server-state
// migration (Phase 5); the client method is added there so it is not dead code
// in the meantime.

export const publishSchedule = (id: string | number) =>
  apiClient.patch<Schedule, '/schedules/{id}/publish'>('/schedules/{id}/publish', undefined, {
    params: { id: Number(id) },
  });

export const archiveSchedule = (id: string | number) =>
  apiClient.patch<Schedule, '/schedules/{id}/archive'>('/schedules/{id}/archive', undefined, {
    params: { id: Number(id) },
  });
