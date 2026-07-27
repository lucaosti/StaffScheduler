/**
 * RBAC service — wraps the `/api/roles` and `/api/permissions` endpoints.
 *
 * Routed through the generated client so path, method, body and query are all
 * checked against the OpenAPI contract at compile time; the request bodies are
 * derived from it rather than retyped. See `departmentService` for the full
 * rationale.
 *
 * WHY THAT MATTERS MORE HERE THAN ELSEWHERE: these calls grant and revoke
 * authority. A body field this module gets wrong is a permission granted with
 * the wrong scope or an expiry silently dropped, and the server-side history
 * of that mistake is an audit row that looks deliberate. `removeRole` is the
 * sharpest case — see its note.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse, Permission, Role, UserRoleAssignment } from '../types';
import type { paths } from '../api/schema';
import { apiClient } from '../api/client';

export type CreateRoleBody = paths['/roles']['post']['requestBody']['content']['application/json'];
export type UpdateRoleBody = NonNullable<
  paths['/roles/{id}']['put']['requestBody']
>['content']['application/json'];
export type AssignRoleBody =
  paths['/roles/users/{userId}']['post']['requestBody']['content']['application/json'];
type RemoveRoleBody = NonNullable<
  paths['/roles/users/{userId}/{roleId}']['delete']['requestBody']
>['content']['application/json'];

export const listPermissions = (): Promise<ApiResponse<Permission[]>> =>
  apiClient.get<Permission[], '/permissions'>('/permissions');

export const listRoles = (): Promise<ApiResponse<Role[]>> =>
  apiClient.get<Role[], '/roles'>('/roles');

export const createRole = (body: CreateRoleBody): Promise<ApiResponse<Role>> =>
  apiClient.post<Role, '/roles'>('/roles', body);

export const updateRole = (id: number, body: UpdateRoleBody): Promise<ApiResponse<Role>> =>
  apiClient.put<Role, '/roles/{id}'>('/roles/{id}', body, { params: { id } });

export const deleteRole = (id: number): Promise<ApiResponse<void>> =>
  apiClient.delete<void, '/roles/{id}'>('/roles/{id}', { params: { id } });

export const getUserRoles = (userId: number): Promise<ApiResponse<UserRoleAssignment[]>> =>
  apiClient.get<UserRoleAssignment[], '/roles/users/{userId}'>('/roles/users/{userId}', {
    params: { userId },
  });

export const assignRole = (userId: number, body: AssignRoleBody): Promise<ApiResponse<void>> =>
  apiClient.post<void, '/roles/users/{userId}'>('/roles/users/{userId}', body, {
    params: { userId },
  });

/**
 * Revokes a role grant.
 *
 * The scope travels in the query and the justification in the body, which is
 * the shape the endpoint declares. Both halves matter:
 *
 *  - `scopeOrgUnitId` identifies WHICH grant to revoke. The same role can be
 *    held several times over different org units, so omitting it means "the
 *    unscoped grant", not "any grant". The server used to coerce a
 *    non-positive value to unscoped, which revoked the WRONG GRANT; it now
 *    rejects it. This module must therefore send the value only when it has
 *    one — `undefined` is skipped by the client's query serialiser, which is
 *    exactly the distinction the old `scopeOrgUnitId != null` string
 *    concatenation was making by hand.
 *  - `justification` is the audit reason, in the body rather than the query so
 *    a free-text explanation does not end up in access logs.
 */
export const removeRole = (
  userId: number,
  roleId: number,
  scopeOrgUnitId?: number | null,
  justification?: string
): Promise<ApiResponse<void>> =>
  apiClient.delete<void, '/roles/users/{userId}/{roleId}'>('/roles/users/{userId}/{roleId}', {
    params: { userId, roleId },
    query: { scopeOrgUnitId: scopeOrgUnitId ?? undefined },
    body: { justification: justification ?? null } satisfies RemoveRoleBody,
  });
