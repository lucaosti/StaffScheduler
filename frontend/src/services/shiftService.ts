/**
 * Shift Service for Staff Scheduler Frontend
 *
 * API client for shift CRUD against `/api/shifts`.
 *
 * WHY THE GENERATED CLIENT: every call used to be a hand-built `fetch` with a
 * template-literal path and a manually assembled query string, so a wrong
 * path, a wrong method or a body the contract no longer accepts compiled
 * cleanly and failed at runtime. Routing through `../api/client` checks all
 * three at compile time. Public signatures are unchanged, so call sites and
 * tests are untouched.
 *
 * WHY THE TYPES ARE DERIVED RATHER THAN MIRRORED: these interfaces were
 * hand-written copies of the server's schemas, and every one of them had
 * drifted. `ShiftFilters` declared `department`, `limit`, `sortBy` and
 * `sortOrder` — none of which this endpoint has ever accepted. Since queries
 * are schema-validated the server strips unknown keys, so sending them looked
 * like a working sort and a working page cap while neither did anything.
 * `CreateShiftData` marked `maxStaff` optional where the schema requires it;
 * harmless only because every caller happened to send it.
 *
 * Both were found one at a time, by accident, and each was fixed by re-copying
 * the schema by hand — which just resets the clock on the next drift. Taking
 * the types straight from the generated `paths` removes the copy instead: the
 * filter and payload shapes now cannot disagree with the contract, because
 * they are the contract. `apiContract.test.ts` remains the guard for the
 * services not yet converted.
 *
 * @author Luca Ostinelli
 */

import type { ApiResponse, Shift } from '../types';
import type { paths } from '../api/schema';
import { apiClient } from '../api/client';

export type ShiftFilters = NonNullable<paths['/shifts']['get']['parameters']['query']>;
export type CreateShiftData = paths['/shifts']['post']['requestBody']['content']['application/json'];
export type UpdateShiftData =
  NonNullable<paths['/shifts/{id}']['put']['requestBody']>['content']['application/json'];

export const getShifts = (filters: ShiftFilters = {}): Promise<ApiResponse<Shift[]>> =>
  apiClient.get<Shift[], '/shifts'>('/shifts', { query: filters });

export const createShift = (shiftData: CreateShiftData): Promise<ApiResponse<Shift>> =>
  apiClient.post<Shift, '/shifts'>('/shifts', shiftData);

export const updateShift = (
  shiftId: string | number,
  shiftData: UpdateShiftData
): Promise<ApiResponse<Shift>> =>
  apiClient.put<Shift, '/shifts/{id}'>('/shifts/{id}', shiftData, {
    params: { id: Number(shiftId) },
  });

export const deleteShift = (shiftId: string | number): Promise<ApiResponse<void>> =>
  apiClient.delete<void, '/shifts/{id}'>('/shifts/{id}', { params: { id: Number(shiftId) } });

/**
 * Shift templates — a named pattern of times, staffing and department that
 * shifts are created from.
 *
 * Appended to this service rather than given its own: a template is a shift
 * without a date, the endpoints live under `/shifts/templates`, and splitting
 * them would put two halves of one idea in two files.
 *
 * `ShiftTemplate` is declared here because it is not in `domain.ts` yet.
 * `isActive` is part of it deliberately: retiring a template is a soft delete,
 * so "gone" and "inactive" are the same state and a caller that could not see
 * the flag would be unable to tell a retired template from a missing one.
 */
export interface ShiftTemplate {
  id: number;
  name: string;
  description: string | null;
  departmentId: number;
  departmentName?: string;
  startTime: string;
  endTime: string;
  minStaff: number;
  maxStaff: number;
  isActive?: boolean;
}

type CreateTemplateBody = NonNullable<
  paths['/shifts/templates']['post']['requestBody']
>['content']['application/json'];
type UpdateTemplateBody = NonNullable<
  paths['/shifts/templates/{id}']['put']['requestBody']
>['content']['application/json'];

export const getShiftTemplates = (): Promise<ApiResponse<ShiftTemplate[]>> =>
  apiClient.get<ShiftTemplate[], '/shifts/templates'>('/shifts/templates');

export const createShiftTemplate = (
  body: CreateTemplateBody
): Promise<ApiResponse<ShiftTemplate>> =>
  apiClient.post<ShiftTemplate, '/shifts/templates'>('/shifts/templates', body);

export const updateShiftTemplate = (
  id: number,
  body: UpdateTemplateBody
): Promise<ApiResponse<ShiftTemplate>> =>
  apiClient.put<ShiftTemplate, '/shifts/templates/{id}'>('/shifts/templates/{id}', body, {
    params: { id },
  });

export const deleteShiftTemplate = (id: number): Promise<ApiResponse<void>> =>
  apiClient.delete<void, '/shifts/templates/{id}'>('/shifts/templates/{id}', { params: { id } });

/**
 * Seasonal-baseline staffing suggestion — see `DemandForecastService` on the
 * backend. A hint for the editor, never an auto-fill: the caller decides
 * whether/how to show it next to the `min_staff` input.
 */
export type StaffingSuggestionQuery = NonNullable<
  paths['/shifts/staffing-suggestion']['get']['parameters']['query']
>;
export interface StaffingSuggestion {
  suggestedMinStaff: number;
  basedOnOccurrences: number;
  lookbackWeeks: number;
}

export const getStaffingSuggestion = (
  query: StaffingSuggestionQuery
): Promise<ApiResponse<StaffingSuggestion>> =>
  apiClient.get<StaffingSuggestion, '/shifts/staffing-suggestion'>('/shifts/staffing-suggestion', {
    query,
  });
