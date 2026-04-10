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
import { handleResponse, getAuthHeaders } from './apiUtils';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

export interface AssignmentFilters {
  userId?: string;
  shiftId?: string;
  status?: 'pending' | 'confirmed' | 'completed' | 'cancelled';
}

export interface CreateAssignmentData {
  userId: string;
  shiftId: string;
  notes?: string;
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

export const deleteAssignment = async (assignmentId: string): Promise<ApiResponse<void>> => {
  const response = await fetch(`${API_BASE_URL}/assignments/${assignmentId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  
  return handleResponse<void>(response);
};

export const confirmAssignment = async (assignmentId: string): Promise<ApiResponse<Assignment>> => {
  const response = await fetch(`${API_BASE_URL}/assignments/${assignmentId}/confirm`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
  });

  return handleResponse<Assignment>(response);
};

export const declineAssignment = async (assignmentId: string): Promise<ApiResponse<Assignment>> => {
  const response = await fetch(`${API_BASE_URL}/assignments/${assignmentId}/decline`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
  });

  return handleResponse<Assignment>(response);
};
