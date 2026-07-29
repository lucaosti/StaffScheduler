/**
 * User account service — wraps `/api/users`.
 *
 * DISTINCT FROM `employeeService`, which is in the UI already. `/employees` is
 * the staff record used for scheduling; `/users` is the ACCOUNT — who can log
 * in, with which roles. They share a person and almost nothing else, and
 * conflating them is how a deactivated account keeps appearing in a roster.
 *
 * `DELETE /users/{id}` is a SOFT delete: it sets `is_active = 0` and the row,
 * its history and its audit trail stay. The function is named `deactivate` to
 * say so, because a caller reading `deleteUser` would reasonably assume the
 * account is gone.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import type { paths } from '../api/schema';
import { apiClient } from '../api/client';

export interface UserAccount {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  position?: string | null;
  roles?: Array<{ id: number; name: string }>;
}

export type UserFilters = NonNullable<paths['/users']['get']['parameters']['query']>;
type CreateUserBody = NonNullable<
  paths['/users']['post']['requestBody']
>['content']['application/json'];
type UpdateUserBody = NonNullable<
  paths['/users/{id}']['put']['requestBody']
>['content']['application/json'];

export const getUserAccounts = (
  filters: UserFilters = {}
): Promise<ApiResponse<UserAccount[]>> =>
  apiClient.get<UserAccount[], '/users'>('/users', { query: filters });

export const createUserAccount = (body: CreateUserBody): Promise<ApiResponse<UserAccount>> =>
  apiClient.post<UserAccount, '/users'>('/users', body);

export const updateUserAccount = (
  id: number,
  body: UpdateUserBody
): Promise<ApiResponse<UserAccount>> =>
  apiClient.put<UserAccount, '/users/{id}'>('/users/{id}', body, { params: { id } });

/**
 * Deactivates an account. The endpoint is `DELETE`, the effect is not: the row
 * stays, with everything attached to it.
 */
export const deactivateUserAccount = (id: number): Promise<ApiResponse<void>> =>
  apiClient.delete<void, '/users/{id}'>('/users/{id}', { params: { id } });
