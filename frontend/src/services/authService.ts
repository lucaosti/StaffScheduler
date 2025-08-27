import { ApiResponse, LoginRequest, LoginResponse, User } from '../types';

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

export const login = async (credentials: LoginRequest): Promise<ApiResponse<LoginResponse>> => {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(credentials),
  });
  
  return handleResponse<LoginResponse>(response);
};

export const verifyToken = async (token: string): Promise<ApiResponse<User>> => {
  const response = await fetch(`${API_BASE_URL}/auth/verify`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });
  
  return handleResponse<User>(response);
};

export const refreshToken = async (token: string): Promise<ApiResponse<LoginResponse>> => {
  const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });
  
  return handleResponse<LoginResponse>(response);
};

export const logout = async (): Promise<ApiResponse<void>> => {
  const response = await fetch(`${API_BASE_URL}/auth/logout`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  
  return handleResponse<void>(response);
};
