/**
 * Department Service
 *
 * API client for department CRUD operations against `/api/departments`.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import { AUTH_HEADERS, handleResponse, API_BASE_URL } from './apiUtils';


export interface Department {
  id: number;
  name: string;
  description?: string | null;
  managerId?: number | null;
  isActive?: boolean;
}

const request = async <T>(path: string, init: RequestInit = {}): Promise<ApiResponse<T>> => {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    ...init,
    headers: { ...AUTH_HEADERS, ...(init.headers as Record<string, string> ?? {}) },
  });
  return handleResponse<T>(res);
};

export const getDepartments = () => request<Department[]>('/departments');

export const getDepartmentById = (id: number | string) =>
  request<Department>(`/departments/${id}`);

export const createDepartment = (data: { name: string; description?: string; managerId?: number }) =>
  request<Department>('/departments', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const updateDepartment = (
  id: number | string,
  data: { name?: string; description?: string; managerId?: number }
) =>
  request<Department>(`/departments/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });

export const deleteDepartment = (id: number | string) =>
  request<unknown>(`/departments/${id}`, { method: 'DELETE' });
