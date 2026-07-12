import { ApiResponse, AttendanceRecord, AttendanceCostEstimate } from '../types';
import { handleResponse, getAuthHeaders, API_BASE_URL } from './apiUtils';

interface AttendanceFilters {
  userId?: number;
  status?: 'pending' | 'approved' | 'rejected';
  startDate?: string;
  endDate?: string;
}

interface CostEstimateParams {
  startDate: string;
  endDate: string;
  departmentId?: number;
}

const buildQuery = <T extends object>(params: T): string => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) query.append(key, String(value));
  });
  const qs = query.toString();
  return qs ? `?${qs}` : '';
};

export const clockIn = async (notes?: string): Promise<ApiResponse<AttendanceRecord>> => {
  const response = await fetch(`${API_BASE_URL}/attendance/clock-in`, {
    method: 'POST',
    ...getAuthHeaders(),
    body: JSON.stringify(notes ? { notes } : {}),
  });
  return handleResponse<AttendanceRecord>(response);
};

export const clockOut = async (id: number | string, notes?: string): Promise<ApiResponse<AttendanceRecord>> => {
  const response = await fetch(`${API_BASE_URL}/attendance/${id}/clock-out`, {
    method: 'POST',
    ...getAuthHeaders(),
    body: JSON.stringify(notes ? { notes } : {}),
  });
  return handleResponse<AttendanceRecord>(response);
};

export const getAttendanceRecords = async (filters: AttendanceFilters = {}): Promise<ApiResponse<AttendanceRecord[]>> => {
  const response = await fetch(`${API_BASE_URL}/attendance${buildQuery(filters)}`, {
    method: 'GET',
    ...getAuthHeaders(),
  });
  return handleResponse<AttendanceRecord[]>(response);
};

export const getPendingApprovals = async (): Promise<ApiResponse<AttendanceRecord[]>> =>
  getAttendanceRecords({ status: 'pending' });

export const approveAttendance = async (id: number | string, notes?: string): Promise<ApiResponse<AttendanceRecord>> => {
  const response = await fetch(`${API_BASE_URL}/attendance/${id}/approve`, {
    method: 'POST',
    ...getAuthHeaders(),
    body: JSON.stringify(notes ? { notes } : {}),
  });
  return handleResponse<AttendanceRecord>(response);
};

export const rejectAttendance = async (id: number | string, notes?: string): Promise<ApiResponse<AttendanceRecord>> => {
  const response = await fetch(`${API_BASE_URL}/attendance/${id}/reject`, {
    method: 'POST',
    ...getAuthHeaders(),
    body: JSON.stringify(notes ? { notes } : {}),
  });
  return handleResponse<AttendanceRecord>(response);
};

export const getCostEstimate = async (params: CostEstimateParams): Promise<ApiResponse<AttendanceCostEstimate>> => {
  const response = await fetch(`${API_BASE_URL}/attendance/cost-estimate${buildQuery(params)}`, {
    method: 'GET',
    ...getAuthHeaders(),
  });
  return handleResponse<AttendanceCostEstimate>(response);
};
