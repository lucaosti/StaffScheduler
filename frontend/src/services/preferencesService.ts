/**
 * User preferences service.
 *
 * Wraps `GET /api/preferences/me` and `PUT /api/preferences/me`.
 *
 * Routed through the generated client so path, method and body are checked
 * against the OpenAPI contract at compile time; the request body is derived
 * from it rather than retyped, for the reasons set out in `employeeService`.
 *
 * `UserPreferences` stays hand-written: preferences are not among the domain
 * entities declared in `packages/shared/src/domain.ts`, so there is nothing to
 * derive the response shape from yet. Worth noting these fields
 * (`maxHoursPerWeek`, `maxConsecutiveDays`, `preferredShifts`, `avoidShifts`)
 * are the scheduling inputs the optimizer reads, so the distinction between a
 * preference and a hard constraint matters more here than the type suggests.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import type { paths } from '../api/schema';
import { apiClient } from '../api/client';

export interface UserPreferences {
  userId: number;
  maxHoursPerWeek: number;
  minHoursPerWeek: number;
  maxConsecutiveDays: number;
  preferredShifts: number[];
  avoidShifts: number[];
  notes: string | null;
  updatedAt: string;
}

export type UpsertPreferencesInput = NonNullable<
  paths['/preferences/me']['put']['requestBody']
>['content']['application/json'];

export const getMyPreferences = (): Promise<ApiResponse<UserPreferences>> =>
  apiClient.get<UserPreferences, '/preferences/me'>('/preferences/me');

export const updateMyPreferences = (
  input: UpsertPreferencesInput
): Promise<ApiResponse<UserPreferences>> =>
  apiClient.put<UserPreferences, '/preferences/me'>('/preferences/me', input);
