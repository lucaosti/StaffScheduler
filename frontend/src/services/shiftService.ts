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
import { handleResponse, getAuthHeaders, API_BASE_URL } from './apiUtils';


/**
 * Mirrors the server's `shiftListQuery` schema.
 *
 * It had drifted: `department` and `limit` do not exist on the endpoint, and
 * `sortBy`/`sortOrder` were never accepted at all — since the query contract
 * became schema-validated they are stripped outright, so sending them looked
 * like a working sort that silently did nothing. The names below are the ones
 * the API actually parses.
 */
interface ShiftFilters {
  scheduleId?: number;
  departmentId?: number;
  /** Single day; equivalent to startDate = endDate = date. */
  date?: string;
  startDate?: string;
  endDate?: string;
  status?: 'open' | 'assigned' | 'confirmed' | 'cancelled';
  page?: number;
  pageSize?: number;
}

/**
 * Mirrors the server's `createShiftBody`.
 *
 * `maxStaff` was optional here while the schema requires it: the Shifts page
 * always sends it (defaulting to `minStaff`), so nothing broke, but a caller
 * trusting the type and omitting it would have got a 400 — the milder form of
 * the defect that made employee creation impossible from the UI.
 */
interface CreateShiftData {
  scheduleId: number;
  departmentId: number;
  templateId?: number;
  date: string;
  startTime: string;
  endTime: string;
  minStaff: number;
  maxStaff: number;
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

  const response = await fetch(`${API_BASE_URL}/shifts?${queryParams}`, {
    method: 'GET',
    ...getAuthHeaders(),
  });
  
  return handleResponse<Shift[]>(response);
};


export const createShift = async (shiftData: CreateShiftData): Promise<ApiResponse<Shift>> => {
  const response = await fetch(`${API_BASE_URL}/shifts`, {
    method: 'POST',
    ...getAuthHeaders(),
    body: JSON.stringify(shiftData),
  });
  
  return handleResponse<Shift>(response);
};

export const updateShift = async (shiftId: string | number, shiftData: UpdateShiftData): Promise<ApiResponse<Shift>> => {
  const response = await fetch(`${API_BASE_URL}/shifts/${shiftId}`, {
    method: 'PUT',
    ...getAuthHeaders(),
    body: JSON.stringify(shiftData),
  });
  
  return handleResponse<Shift>(response);
};

export const deleteShift = async (shiftId: string | number): Promise<ApiResponse<void>> => {
  const response = await fetch(`${API_BASE_URL}/shifts/${shiftId}`, {
    method: 'DELETE',
    ...getAuthHeaders(),
  });
  
  return handleResponse<void>(response);
};

