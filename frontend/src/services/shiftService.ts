/**
 * Shift Service for Staff Scheduler Frontend
 * 
 * Handles all shift-related API calls including CRUD operations,
 * template management, scheduling, and shift status updates.
 * 
 * Features:
 * - Full CRUD operations for shift management
 * - Date-based filtering and querying
 * - Shift template creation and management
 * - Status updates (draft, published, cancelled)
 * - Conflict detection and validation
 * - Error handling with custom ApiError
 * 
 * @author Luca Ostinelli
 */

import { ApiResponse, Shift } from '../types';
import { handleResponse, getAuthHeaders } from './apiUtils';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

export interface ShiftFilters {
  department?: string;
  status?: 'open' | 'assigned' | 'confirmed' | 'cancelled';
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface CreateShiftData {
  name: string;
  description?: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  department?: string;
  location?: string;
  rolesRequired: Array<{
    role: string;
    count: number;
    skills?: string[];
  }>;
  minStaff: number;
  maxStaff?: number;
  notes?: string;
}

export interface UpdateShiftData extends Partial<CreateShiftData> {}

export const getShifts = async (filters: ShiftFilters = {}): Promise<ApiResponse<Shift[]>> => {
  const queryParams = new URLSearchParams();
  
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      queryParams.append(key, value.toString());
    }
  });

  const response = await fetch(`${API_BASE_URL}/shifts?${queryParams}`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  
  return handleResponse<Shift[]>(response);
};

export const getShift = async (shiftId: string | number): Promise<ApiResponse<Shift>> => {
  const response = await fetch(`${API_BASE_URL}/shifts/${shiftId}`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  
  return handleResponse<Shift>(response);
};

export const createShift = async (shiftData: CreateShiftData): Promise<ApiResponse<Shift>> => {
  const response = await fetch(`${API_BASE_URL}/shifts`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(shiftData),
  });
  
  return handleResponse<Shift>(response);
};

export const updateShift = async (shiftId: string | number, shiftData: UpdateShiftData): Promise<ApiResponse<Shift>> => {
  const response = await fetch(`${API_BASE_URL}/shifts/${shiftId}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(shiftData),
  });
  
  return handleResponse<Shift>(response);
};

export const deleteShift = async (shiftId: string | number): Promise<ApiResponse<void>> => {
  const response = await fetch(`${API_BASE_URL}/shifts/${shiftId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  
  return handleResponse<void>(response);
};

