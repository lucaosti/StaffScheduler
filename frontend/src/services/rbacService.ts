/**
 * RBAC service — wraps /api/roles and /api/permissions endpoints.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse, Permission, Role, UserRoleAssignment } from '../types';
import { getAuthHeaders, handleResponse, API_BASE_URL } from './apiUtils';

const ROLES = `${API_BASE_URL}/roles`;
const PERMS = `${API_BASE_URL}/permissions`;

export const listPermissions = (): Promise<ApiResponse<Permission[]>> =>
  fetch(PERMS, { method: 'GET', ...getAuthHeaders() }).then(handleResponse<Permission[]>);

export const listRoles = (): Promise<ApiResponse<Role[]>> =>
  fetch(ROLES, { method: 'GET', ...getAuthHeaders() }).then(handleResponse<Role[]>);

export const createRole = (body: {
  name: string;
  description?: string;
  permissionCodes?: string[];
}): Promise<ApiResponse<Role>> =>
  fetch(ROLES, {
    method: 'POST',
    ...getAuthHeaders(),
    body: JSON.stringify(body),
  }).then(handleResponse<Role>);

export const updateRole = (
  id: number,
  body: { name?: string; description?: string; permissionCodes?: string[] }
): Promise<ApiResponse<Role>> =>
  fetch(`${ROLES}/${id}`, {
    method: 'PUT',
    ...getAuthHeaders(),
    body: JSON.stringify(body),
  }).then(handleResponse<Role>);

export const deleteRole = (id: number): Promise<ApiResponse<void>> =>
  fetch(`${ROLES}/${id}`, { method: 'DELETE', ...getAuthHeaders() }).then(handleResponse<void>);

export const getUserRoles = (userId: number): Promise<ApiResponse<UserRoleAssignment[]>> =>
  fetch(`${ROLES}/users/${userId}`, { method: 'GET', ...getAuthHeaders() }).then(
    handleResponse<UserRoleAssignment[]>
  );

export const assignRole = (
  userId: number,
  body: {
    roleId: number;
    scopeOrgUnitId?: number | null;
    expiresAt?: string | null;
    justification?: string;
  }
): Promise<ApiResponse<void>> =>
  fetch(`${ROLES}/users/${userId}`, {
    method: 'POST',
    ...getAuthHeaders(),
    body: JSON.stringify(body),
  }).then(handleResponse<void>);

export const removeRole = (
  userId: number,
  roleId: number,
  scopeOrgUnitId?: number | null,
  justification?: string
): Promise<ApiResponse<void>> => {
  const qs = scopeOrgUnitId != null ? `?scopeOrgUnitId=${scopeOrgUnitId}` : '';
  return fetch(`${ROLES}/users/${userId}/${roleId}${qs}`, {
    method: 'DELETE',
    ...getAuthHeaders(),
    body: JSON.stringify({ justification: justification ?? null }),
  }).then(handleResponse<void>);
};
