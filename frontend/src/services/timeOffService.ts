/**
 * Time-off service — wraps `/api/time-off`.
 *
 * Routed through the generated client, so path, method, body and query are
 * checked against the OpenAPI contract at compile time.
 *
 * `TimeOffRequest` is re-exported from the shared package through the types
 * barrel rather than restated here: it is a domain entity derived from the
 * same Zod schema that defines the API's response, so a local copy could only
 * ever drift from it — which is what #517 records having already happened to
 * assignments.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse, TimeOffRequest } from '../types';
import type { paths } from '../api/schema';
import { apiClient } from '../api/client';

export type TimeOffFilters = NonNullable<paths['/time-off']['get']['parameters']['query']>;
type CreateTimeOffBody = NonNullable<
  paths['/time-off']['post']['requestBody']
>['content']['application/json'];
type DecisionBody = NonNullable<
  paths['/time-off/{id}/approve']['post']['requestBody']
>['content']['application/json'];

export const getTimeOffRequests = (
  filters: TimeOffFilters = {}
): Promise<ApiResponse<TimeOffRequest[]>> =>
  apiClient.get<TimeOffRequest[], '/time-off'>('/time-off', { query: filters });

export const createTimeOffRequest = (
  body: CreateTimeOffBody
): Promise<ApiResponse<TimeOffRequest>> =>
  apiClient.post<TimeOffRequest, '/time-off'>('/time-off', body);

export const approveTimeOff = (
  id: number,
  notes?: string
): Promise<ApiResponse<TimeOffRequest>> =>
  apiClient.post<TimeOffRequest, '/time-off/{id}/approve'>(
    '/time-off/{id}/approve',
    { notes } satisfies DecisionBody,
    { params: { id } }
  );

export const rejectTimeOff = (id: number, notes?: string): Promise<ApiResponse<TimeOffRequest>> =>
  apiClient.post<TimeOffRequest, '/time-off/{id}/reject'>(
    '/time-off/{id}/reject',
    { notes } satisfies DecisionBody,
    { params: { id } }
  );

export const cancelTimeOff = (id: number): Promise<ApiResponse<TimeOffRequest>> =>
  apiClient.post<TimeOffRequest, '/time-off/{id}/cancel'>(
    '/time-off/{id}/cancel',
    undefined,
    { params: { id } }
  );
