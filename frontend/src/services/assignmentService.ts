/**
 * Assignment Service for Staff Scheduler Frontend
 * 
 * Handles all assignment-related API calls including CRUD operations,
 * approval workflows, conflict detection, and assignment management.
 * 
 * Features:
 * - Full CRUD operations for assignment management
 * - Approval and rejection workflows
 * - Conflict detection and resolution
 * - Bulk assignment operations
 * - Status tracking and updates
 * - Error handling with custom ApiError
 * 
 * @author Luca Ostinelli
 */

import { ApiResponse, Assignment } from '../types';

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

export interface AssignmentFilters {
  employeeId?: string;
  shiftId?: string;
  status?: 'pending' | 'approved' | 'rejected' | 'cancelled';
}

export interface CreateAssignmentData {
  employeeId: string;
  shiftId: string;
  role: string;
}

export const getAssignments = async (filters: AssignmentFilters = {}): Promise<ApiResponse<Assignment[]>> => {
  const queryParams = new URLSearchParams();
  
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      queryParams.append(key, value.toString());
    }
  });

  const response = await fetch(`${API_BASE_URL}/assignments?${queryParams}`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  
  return handleResponse<Assignment[]>(response);
};

export const getAssignment = async (assignmentId: string): Promise<ApiResponse<Assignment>> => {
  const response = await fetch(`${API_BASE_URL}/assignments/${assignmentId}`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  
  return handleResponse<Assignment>(response);
};

export const createAssignment = async (assignmentData: CreateAssignmentData): Promise<ApiResponse<Assignment>> => {
  const response = await fetch(`${API_BASE_URL}/assignments`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(assignmentData),
  });
  
  return handleResponse<Assignment>(response);
};

export const cancelAssignment = async (assignmentId: string): Promise<ApiResponse<void>> => {
  const response = await fetch(`${API_BASE_URL}/assignments/${assignmentId}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify({ action: 'cancel' }),
  });
  
  return handleResponse<void>(response);
};

export const deleteAssignment = async (assignmentId: string): Promise<ApiResponse<void>> => {
  const response = await fetch(`${API_BASE_URL}/assignments/${assignmentId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  
  return handleResponse<void>(response);
};

export const approveAssignment = async (assignmentId: string, notes?: string): Promise<ApiResponse<Assignment>> => {
  const response = await fetch(`${API_BASE_URL}/assignments/${assignmentId}/approve`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ notes }),
  });
  
  return handleResponse<Assignment>(response);
};

export const rejectAssignment = async (assignmentId: string, reason: string): Promise<ApiResponse<Assignment>> => {
  const response = await fetch(`${API_BASE_URL}/assignments/${assignmentId}/reject`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ reason }),
  });
  
  return handleResponse<Assignment>(response);
};
