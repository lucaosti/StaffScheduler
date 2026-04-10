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
import { handleResponse, getAuthHeaders } from './apiUtils';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

export const getDashboardStats = async (): Promise<ApiResponse<DashboardStats>> => {
  const response = await fetch(`${API_BASE_URL}/dashboard/stats`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  
  return handleResponse<DashboardStats>(response);
};

export const getRecentActivity = async (): Promise<ApiResponse<any[]>> => {
  const response = await fetch(`${API_BASE_URL}/dashboard/activities`, {
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
