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
import { requestJson } from './apiUtils';

interface ShiftFilters {
  department?: string;
  status?: 'open' | 'assigned' | 'confirmed' | 'cancelled';
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

interface CreateShiftData {
  scheduleId: number;
  departmentId: number;
  templateId?: number;
  date: string;
  startTime: string;
  endTime: string;
  minStaff: number;
  maxStaff?: number;
  requiredSkillIds?: number[];
  notes?: string;
}

interface UpdateShiftData {
  date?: string;
  startTime?: string;
  endTime?: string;
  minStaff?: number;
  maxStaff?: number;
  status?: 'open' | 'assigned' | 'confirmed' | 'cancelled';
  requiredSkillIds?: number[];
  notes?: string;
}

export const getShifts = async (filters: ShiftFilters = {}): Promise<ApiResponse<Shift[]>> => {
  const queryParams = new URLSearchParams();
  
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      queryParams.append(key, value.toString());
    }
  });

  return requestJson<Shift[]>(`/shifts?${queryParams}`, { method: 'GET' });
};


export const createShift = async (shiftData: CreateShiftData): Promise<ApiResponse<Shift>> => {
  return requestJson<Shift>('/shifts', { method: 'POST', body: JSON.stringify(shiftData) });
};

export const updateShift = async (shiftId: string | number, shiftData: UpdateShiftData): Promise<ApiResponse<Shift>> => {
  return requestJson<Shift>(`/shifts/${shiftId}`, { method: 'PUT', body: JSON.stringify(shiftData) });
};

export const deleteShift = async (shiftId: string | number): Promise<ApiResponse<void>> => {
  return requestJson<void>(`/shifts/${shiftId}`, { method: 'DELETE' });
};

