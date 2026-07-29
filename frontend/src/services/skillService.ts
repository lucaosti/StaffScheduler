/**
 * Skills service — wraps `/api/skills`.
 *
 * Routed through the generated client, so path, method, body and query are
 * checked against the OpenAPI contract at compile time.
 *
 * `Skill` is declared here rather than in `packages/shared/src/domain.ts`
 * because the shape the API returns is the row plus two derived usage counts,
 * and those are not a property of a skill — they are a property of how the
 * catalogue is being used at the moment it is read.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import type { paths } from '../api/schema';
import { apiClient } from '../api/client';

export interface Skill {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  /** How many people hold it — the cost of retiring it, made visible. */
  employeeCount: number;
  /** How many shift requirements name it. */
  shiftRequirementCount: number;
}

export type SkillFilters = NonNullable<paths['/skills']['get']['parameters']['query']>;
type CreateSkillBody = NonNullable<
  paths['/skills']['post']['requestBody']
>['content']['application/json'];
type UpdateSkillBody = NonNullable<
  paths['/skills/{id}']['put']['requestBody']
>['content']['application/json'];

export const getSkills = (filters: SkillFilters = {}): Promise<ApiResponse<Skill[]>> =>
  apiClient.get<Skill[], '/skills'>('/skills', { query: filters });

export const createSkill = (body: CreateSkillBody): Promise<ApiResponse<Skill>> =>
  apiClient.post<Skill, '/skills'>('/skills', body);

export const updateSkill = (id: number, body: UpdateSkillBody): Promise<ApiResponse<Skill>> =>
  apiClient.put<Skill, '/skills/{id}'>('/skills/{id}', body, { params: { id } });

export const deleteSkill = (id: number): Promise<ApiResponse<void>> =>
  apiClient.delete<void, '/skills/{id}'>('/skills/{id}', { params: { id } });
