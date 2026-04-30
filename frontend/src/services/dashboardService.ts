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
import { requestJson } from './apiUtils';

export const getDashboardStats = async (): Promise<ApiResponse<DashboardStats>> => {
  return requestJson<DashboardStats>('/dashboard/stats', { method: 'GET' });
};
