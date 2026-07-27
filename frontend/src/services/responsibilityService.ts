/**
 * Responsibility rules API client.
 *
 * Routed through the generated client so path, method, body and query are all
 * checked against the OpenAPI contract at compile time; filters and request
 * bodies are derived from it rather than retyped. See `departmentService` for
 * the full rationale.
 *
 * WHY `subjectType` IS NOW THE CONTRACT'S ENUM: the filter object typed it as
 * a bare `string` while the rule types used a four-member union. The endpoint
 * validates against the enum, so a filter value outside it was accepted by
 * TypeScript and stripped by the server — the caller saw an unfiltered list
 * and no error. Deriving both from `paths` makes the two agree by
 * construction, which matters here because a responsibility rule decides WHO
 * is accountable for a permission over a subject group; querying the wrong
 * slice silently is a worse failure than an error.
 *
 * `ResponsibilityRule` and `MatrixEntry` stay hand-written: neither is
 * declared in `packages/shared/src/domain.ts`, so there is nothing to derive
 * the response shapes from yet.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import type { paths } from '../api/schema';
import { apiClient } from '../api/client';

export type CreateResponsibilityRuleInput =
  paths['/responsibility-rules']['post']['requestBody']['content']['application/json'];
export type UpdateResponsibilityRuleInput = NonNullable<
  paths['/responsibility-rules/{id}']['put']['requestBody']
>['content']['application/json'];
export type ResponsibilityRuleFilters = NonNullable<
  paths['/responsibility-rules']['get']['parameters']['query']
>;

export type ResponsibilitySubjectType = CreateResponsibilityRuleInput['subjectType'];

export interface ResponsibilityRule {
  id: number;
  subjectType: ResponsibilitySubjectType;
  subjectId: number | null;
  permissionCode: string;
  responsibleOrgUnitId: number;
  delegatedToRoleId: number | null;
  description: string | null;
  isActive: boolean;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface MatrixEntry {
  subjectType: ResponsibilitySubjectType;
  subjectId: number | null;
  permissionCode: string;
  rules: ResponsibilityRule[];
}

export const listResponsibilityRules = (
  filters: ResponsibilityRuleFilters = {}
): Promise<ApiResponse<ResponsibilityRule[]>> =>
  apiClient.get<ResponsibilityRule[], '/responsibility-rules'>('/responsibility-rules', {
    query: filters,
  });

export const createResponsibilityRule = (
  input: CreateResponsibilityRuleInput
): Promise<ApiResponse<ResponsibilityRule>> =>
  apiClient.post<ResponsibilityRule, '/responsibility-rules'>('/responsibility-rules', input);

export const updateResponsibilityRule = (
  id: number,
  patch: UpdateResponsibilityRuleInput
): Promise<ApiResponse<ResponsibilityRule>> =>
  apiClient.put<ResponsibilityRule, '/responsibility-rules/{id}'>(
    '/responsibility-rules/{id}',
    patch,
    { params: { id } }
  );

export const deleteResponsibilityRule = (id: number): Promise<ApiResponse<void>> =>
  apiClient.delete<void, '/responsibility-rules/{id}'>('/responsibility-rules/{id}', {
    params: { id },
  });

export const getResponsibilityMatrix = (): Promise<ApiResponse<{ matrix: MatrixEntry[] }>> =>
  apiClient.get<{ matrix: MatrixEntry[] }, '/responsibility-rules/matrix'>(
    '/responsibility-rules/matrix'
  );
