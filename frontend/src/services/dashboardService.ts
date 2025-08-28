/**
 * Dashboard Service for Staff Scheduler Frontend
 * 
 * Handles all dashboard-related API calls including statistics retrieval,
 * analytics data, metrics calculation, and overview information.
 * 
 * Features:
 * - Real-time statistics and metrics
 * - Performance analytics data
 * - Employee and shift summaries
 * - Cost and hour tracking
 * - Coverage and satisfaction metrics
 * - Error handling with custom ApiError
 * 
 * @author Luca Ostinelli
 */

import { ApiResponse, DashboardStats } from '../types';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

/**
 * Custom error class for API-related errors
 */
class ApiError extends Error {
  /**
   * Creates an ApiError instance
   * @param message - Error message
   * @param status - HTTP status code (optional)
   */
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

export const getDashboardStats = async (): Promise<ApiResponse<DashboardStats>> => {
  const response = await fetch(`${API_BASE_URL}/dashboard/stats`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  
  return handleResponse<DashboardStats>(response);
};

export const getRecentActivity = async (): Promise<ApiResponse<any[]>> => {
  const response = await fetch(`${API_BASE_URL}/dashboard/activity`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  
  return handleResponse<any[]>(response);
};

export const getUpcomingShifts = async (): Promise<ApiResponse<any[]>> => {
  const response = await fetch(`${API_BASE_URL}/dashboard/upcoming-shifts`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  
  return handleResponse<any[]>(response);
};
