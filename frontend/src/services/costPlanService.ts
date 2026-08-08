/**
 * Cost plan service — wraps `/api/cost-plans`.
 *
 * A cost plan is the fixed labor-cost target an administrator sets for one
 * department over one period; `/dashboard/stats`' `monthlyCostPlan` is the
 * read-only sum of whichever plans overlap the current month. This is the
 * CRUD side: reading needs `report.read`, writing needs `report.manage`.
 *
 * @author Luca Ostinelli
 */

import type { ApiResponse } from '../types';
import type { paths } from '../api/schema';
import { apiClient } from '../api/client';

export interface CostPlan {
  id: number;
  departmentId: number;
  startDate: string;
  endDate: string;
  targetAmount: number;
  setByUserId: number;
  createdAt: string;
  updatedAt: string;
}

type CreateBody = NonNullable<paths['/cost-plans']['post']['requestBody']>['content']['application/json'];
type UpdateBody = NonNullable<paths['/cost-plans/{id}']['put']['requestBody']>['content']['application/json'];

export const listCostPlans = (departmentId?: number): Promise<ApiResponse<CostPlan[]>> =>
  apiClient.get<CostPlan[], '/cost-plans'>('/cost-plans', {
    ...(departmentId !== undefined ? { query: { departmentId } } : {}),
  });

export const createCostPlan = (body: CreateBody): Promise<ApiResponse<CostPlan>> =>
  apiClient.post<CostPlan, '/cost-plans'>('/cost-plans', body);

export const updateCostPlan = (id: number, body: UpdateBody): Promise<ApiResponse<CostPlan>> =>
  apiClient.put<CostPlan, '/cost-plans/{id}'>('/cost-plans/{id}', body, { params: { id } });

export const deleteCostPlan = (id: number): Promise<ApiResponse<void>> =>
  apiClient.delete<void, '/cost-plans/{id}'>('/cost-plans/{id}', { params: { id } });
