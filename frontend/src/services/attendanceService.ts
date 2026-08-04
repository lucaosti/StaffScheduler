/**
 * Attendance service — wraps the `/api/attendance` endpoints (clock in/out,
 * the record list, approval decisions and the cost estimate).
 *
 * Routed through the generated client so path, method, body and query are all
 * checked against the OpenAPI contract at compile time; the filter and body
 * types are derived from it rather than retyped. See `departmentService` for
 * the full rationale, and `employeeService` for what hand-mirrored payload
 * types have cost in this codebase.
 *
 * WHY THE `notes ? { notes } : {}` DANCE IS GONE: the four action endpoints
 * take an all-optional body, so `{}` and `{ notes }` are equally valid and the
 * conditional was expressing nothing. Passing the object directly lets the
 * derived body type carry the optionality, and the client omits the field when
 * it is undefined.
 *
 * `AttendanceRecord` and `AttendanceCostEstimate` stay hand-written: neither is
 * declared in `packages/shared/src/domain.ts` yet, so there is nothing to
 * derive the response shapes from.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse, AttendanceRecord, AttendanceCostEstimate } from '../types';
import type { paths } from '../api/schema';
import { apiClient } from '../api/client';

export type AttendanceFilters = NonNullable<paths['/attendance']['get']['parameters']['query']>;
export type CostEstimateParams = NonNullable<
  paths['/attendance/cost-estimate']['get']['parameters']['query']
>;

type NotesBody = NonNullable<
  paths['/attendance/clock-in']['post']['requestBody']
>['content']['application/json'];

export const clockIn = (
  notes?: string,
  location?: { latitude: number; longitude: number }
): Promise<ApiResponse<AttendanceRecord>> =>
  apiClient.post<AttendanceRecord, '/attendance/clock-in'>('/attendance/clock-in', {
    notes,
    latitude: location?.latitude,
    longitude: location?.longitude,
  } satisfies NotesBody);

export const clockOut = (
  id: number | string,
  notes?: string
): Promise<ApiResponse<AttendanceRecord>> =>
  apiClient.post<AttendanceRecord, '/attendance/{id}/clock-out'>(
    '/attendance/{id}/clock-out',
    { notes },
    { params: { id: Number(id) } }
  );

export const getAttendanceRecords = (
  filters: AttendanceFilters = {}
): Promise<ApiResponse<AttendanceRecord[]>> =>
  apiClient.get<AttendanceRecord[], '/attendance'>('/attendance', { query: filters });

export const getPendingApprovals = (): Promise<ApiResponse<AttendanceRecord[]>> =>
  getAttendanceRecords({ status: 'pending' });

export const approveAttendance = (
  id: number | string,
  notes?: string
): Promise<ApiResponse<AttendanceRecord>> =>
  apiClient.post<AttendanceRecord, '/attendance/{id}/approve'>(
    '/attendance/{id}/approve',
    { notes },
    { params: { id: Number(id) } }
  );

export const rejectAttendance = (
  id: number | string,
  notes?: string
): Promise<ApiResponse<AttendanceRecord>> =>
  apiClient.post<AttendanceRecord, '/attendance/{id}/reject'>(
    '/attendance/{id}/reject',
    { notes },
    { params: { id: Number(id) } }
  );

export const getCostEstimate = (
  params: CostEstimateParams
): Promise<ApiResponse<AttendanceCostEstimate>> =>
  apiClient.get<AttendanceCostEstimate, '/attendance/cost-estimate'>(
    '/attendance/cost-estimate',
    { query: params }
  );
