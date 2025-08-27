import { ApiResponse, Employee } from '../types';

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

export interface EmployeeFilters {
  department?: string;
  position?: string;
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface CreateEmployeeData {
  employeeId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  address?: string;
  department?: string;
  position?: string;
  hireDate?: string;
  employeeType?: 'full-time' | 'part-time' | 'contractor';
  hourlyRate?: number;
  maxHoursPerWeek?: number;
  skills?: string[];
  certifications?: string[];
  notes?: string;
}

export interface UpdateEmployeeData extends Partial<CreateEmployeeData> {}

export const getEmployees = async (filters: EmployeeFilters = {}): Promise<ApiResponse<Employee[]>> => {
  const queryParams = new URLSearchParams();
  
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      queryParams.append(key, value.toString());
    }
  });

  const response = await fetch(`${API_BASE_URL}/employees?${queryParams}`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  
  return handleResponse<Employee[]>(response);
};

export const getEmployee = async (employeeId: string): Promise<ApiResponse<Employee>> => {
  const response = await fetch(`${API_BASE_URL}/employees/${employeeId}`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  
  return handleResponse<Employee>(response);
};

export const createEmployee = async (employeeData: CreateEmployeeData): Promise<ApiResponse<Employee>> => {
  const response = await fetch(`${API_BASE_URL}/employees`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(employeeData),
  });
  
  return handleResponse<Employee>(response);
};

export const updateEmployee = async (employeeId: string, employeeData: UpdateEmployeeData): Promise<ApiResponse<Employee>> => {
  const response = await fetch(`${API_BASE_URL}/employees/${employeeId}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(employeeData),
  });
  
  return handleResponse<Employee>(response);
};

export const deleteEmployee = async (employeeId: string): Promise<ApiResponse<void>> => {
  const response = await fetch(`${API_BASE_URL}/employees/${employeeId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  
  return handleResponse<void>(response);
};
