/**
 * Reports client (F08).
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import { getAuthHeaders, handleResponse } from './apiUtils';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

export interface HoursWorkedRow {
  userId: number;
  fullName: string;
  hours: number;
}

export interface CostByDepartmentRow {
  departmentId: number;
  departmentName: string;
  hours: number;
  cost: number;
}

const request = async <T>(path: string, init: RequestInit = {}): Promise<ApiResponse<T>> => {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { ...getAuthHeaders(), ...(init.headers || {}) },
  });
  return handleResponse<T>(res);
};

export const hoursWorked = (start: string, end: string, departmentId?: number) => {
  const qs = new URLSearchParams({ start, end });
  if (departmentId !== undefined) qs.set('departmentId', String(departmentId));
  return request<HoursWorkedRow[]>(`/reports/hours-worked?${qs.toString()}`);
};

export const costByDepartment = (start: string, end: string) =>
  request<CostByDepartmentRow[]>(`/reports/cost-by-department?start=${start}&end=${end}`);
