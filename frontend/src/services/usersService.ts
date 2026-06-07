/**
 * Users service.
 *
 * Wraps the PUT /api/users/:id endpoint for self-service profile updates
 * and password changes.
 *
 * Self-service callers may only update firstName, lastName, and phone.
 * Passing a `password` field triggers a password change (bcrypt-hashed server-side).
 *
 * @author Luca Ostinelli
 */

import { ApiResponse, User } from '../types';
import { getAuthHeaders, handleResponse } from './apiUtils';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

export interface UpdateProfileInput {
  firstName?: string;
  lastName?: string;
  phone?: string;
}

export interface ChangePasswordInput {
  password: string;
}

export const updateUserProfile = async (
  userId: number | string,
  input: UpdateProfileInput
): Promise<ApiResponse<User>> => {
  const response = await fetch(`${API_BASE_URL}/users/${userId}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  return handleResponse<User>(response);
};

export const changeUserPassword = async (
  userId: number | string,
  newPassword: string
): Promise<ApiResponse<User>> => {
  const input: ChangePasswordInput = { password: newPassword };
  const response = await fetch(`${API_BASE_URL}/users/${userId}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  return handleResponse<User>(response);
};
