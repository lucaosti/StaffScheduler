/**
 * Delegation service — wraps the `/api/delegations` endpoints.
 *
 * Routed through the generated client so path, method and body are checked
 * against the OpenAPI contract at compile time; the request bodies are derived
 * from it rather than retyped. See `departmentService` for the full rationale.
 *
 * `Delegation` stays hand-written: it is not among the domain entities
 * declared in `packages/shared/src/domain.ts`, so there is nothing to derive
 * the response shape from yet. Worth flagging rather than leaving implicit —
 * a delegation is a temporary transfer of authority, so a field this type gets
 * wrong is a field the UI can get wrong about who currently holds a
 * permission.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import type { paths } from '../api/schema';
import { apiClient } from '../api/client';

export interface Delegation {
  id: number;
  delegatorId: number;
  delegateeId: number;
  permissionCodes: string[];
  scopeOrgUnitId: number | null;
  startsAt: string;
  expiresAt: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CreateDelegationBody =
  paths['/delegations']['post']['requestBody']['content']['application/json'];
type RevokeBody = NonNullable<
  paths['/delegations/{id}']['delete']['requestBody']
>['content']['application/json'];

export const listDelegations = (): Promise<ApiResponse<Delegation[]>> =>
  apiClient.get<Delegation[], '/delegations'>('/delegations');

export const createDelegation = (
  body: CreateDelegationBody
): Promise<ApiResponse<Delegation>> => apiClient.post<Delegation, '/delegations'>('/delegations', body);

/**
 * Revokes a delegation.
 *
 * The justification travels in the body of a DELETE, which is unusual but
 * deliberate: revoking someone's delegated authority is an audited action, and
 * the reason belongs with the request rather than in a query string that ends
 * up in access logs. The schema bounds it (it was previously read straight off
 * `req.body` behind a bare `typeof === 'string'` guard).
 */
export const revokeDelegation = (
  id: number,
  justification?: string | null
): Promise<ApiResponse<void>> =>
  apiClient.delete<void, '/delegations/{id}'>('/delegations/{id}', {
    params: { id },
    body: { justification: justification ?? null } satisfies RevokeBody,
  });
