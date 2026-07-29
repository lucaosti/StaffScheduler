/**
 * Assignment service — wraps `/api/assignments`.
 *
 * Routed through the generated client, so path, method, body and query are all
 * checked against the OpenAPI contract at compile time.
 *
 * `Assignment` comes from the types barrel rather than being re-declared here,
 * per the no-local-duplicates rule. That barrel entry is itself a hand-written
 * copy of the shared package's derived `Assignment`, which is a real
 * duplication — filed separately rather than fixed here, because unpicking it
 * touches every consumer and would bury this change.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse, ShiftAssignment } from '../types';
import type { paths } from '../api/schema';
import { apiClient } from '../api/client';

export type AssignmentFilters = NonNullable<paths['/assignments']['get']['parameters']['query']>;
type CreateAssignmentBody = NonNullable<
  paths['/assignments']['post']['requestBody']
>['content']['application/json'];

/** Someone the server considers eligible for a shift, with why they are not. */
export interface AvailableEmployee {
  id: number;
  firstName?: string;
  lastName?: string;
  email?: string;
}

/**
 * The planner's listing. Requires `assignment.manage`.
 *
 * NOT the way to read one's own shifts — see `getMyAssignments`. Using this
 * with a `userId` filter looks equivalent and 403s for exactly the audience
 * self-service is for.
 */
export const getAssignments = (
  filters: AssignmentFilters = {}
): Promise<ApiResponse<ShiftAssignment[]>> =>
  apiClient.get<ShiftAssignment[], '/assignments'>('/assignments', { query: filters });

/**
 * One person's assignments, readable by that person.
 *
 * The route allows the caller through when the id is their own, which is what
 * makes a self-service view possible at all: the collection endpoint is gated
 * on `assignment.manage`, a permission the default Employee role does not
 * hold.
 */
export const getMyAssignments = (userId: number): Promise<ApiResponse<ShiftAssignment[]>> =>
  apiClient.get<ShiftAssignment[], '/assignments/user/{userId}'>('/assignments/user/{userId}', {
    params: { userId },
  });

export const createAssignment = (
  body: CreateAssignmentBody
): Promise<ApiResponse<ShiftAssignment>> =>
  apiClient.post<ShiftAssignment, '/assignments'>('/assignments', body);

export const deleteAssignment = (id: number): Promise<ApiResponse<void>> =>
  apiClient.delete<void, '/assignments/{id}'>('/assignments/{id}', { params: { id } });

export const confirmAssignment = (id: number): Promise<ApiResponse<ShiftAssignment>> =>
  apiClient.patch<ShiftAssignment, '/assignments/{id}/confirm'>(
    '/assignments/{id}/confirm',
    undefined,
    { params: { id } }
  );

export const declineAssignment = (id: number): Promise<ApiResponse<ShiftAssignment>> =>
  apiClient.patch<ShiftAssignment, '/assignments/{id}/decline'>(
    '/assignments/{id}/decline',
    undefined,
    { params: { id } }
  );

export const completeAssignment = (id: number): Promise<ApiResponse<ShiftAssignment>> =>
  apiClient.patch<ShiftAssignment, '/assignments/{id}/complete'>(
    '/assignments/{id}/complete',
    undefined,
    { params: { id } }
  );

export const getAvailableEmployees = (
  shiftId: number
): Promise<ApiResponse<AvailableEmployee[]>> =>
  apiClient.get<AvailableEmployee[], '/assignments/shift/{shiftId}/available-employees'>(
    '/assignments/shift/{shiftId}/available-employees',
    { params: { shiftId } }
  );
