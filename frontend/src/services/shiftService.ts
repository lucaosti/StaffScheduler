import { ApiResponse, Shift } from '../types';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

class ApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

const handleResponse = async <T>(response: Response): Promise<ApiResponse<T>> => {
  const contentType = response.headers.get('content-type');
  const isJson = contentType && contentType.includes('application/json');
  
  const data = isJson ? await response.json() : await response.text();
  
  if (!response.ok) {
    throw new ApiError(
      data.message || `HTTP error! status: ${response.status}`,
      response.status
    );
  }
  
  return data;
};

const getAuthHeaders = (): HeadersInit => {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
  };
};

export interface ShiftFilters {
  department?: string;
  status?: 'draft' | 'published' | 'archived';
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

export const getShift = async (shiftId: string): Promise<ApiResponse<Shift>> => {
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

export const updateShift = async (shiftId: string, shiftData: UpdateShiftData): Promise<ApiResponse<Shift>> => {
  const response = await fetch(`${API_BASE_URL}/shifts/${shiftId}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(shiftData),
  });
  
  return handleResponse<Shift>(response);
};

export const deleteShift = async (shiftId: string): Promise<ApiResponse<void>> => {
  const response = await fetch(`${API_BASE_URL}/shifts/${shiftId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  
  return handleResponse<void>(response);
};

export const publishShift = async (shiftId: string): Promise<ApiResponse<Shift>> => {
  const response = await fetch(`${API_BASE_URL}/shifts/${shiftId}/publish`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  
  return handleResponse<Shift>(response);
};
