/**
 * System settings service.
 *
 * Wraps the GET /api/settings and PUT /api/settings/* endpoints.
 * Only accessible to users with the system.settings permission.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import { getAuthHeaders, handleResponse, API_BASE_URL } from './apiUtils';


interface SystemSetting {
  category: string;
  key: string;
  value: string;
  defaultValue?: string;
  description?: string;
  isSystem?: boolean;
}

export const getSystemSettings = async (): Promise<ApiResponse<SystemSetting[]>> => {
  const response = await fetch(`${API_BASE_URL}/settings`, {
    method: 'GET',
    ...getAuthHeaders(),
  });
  return handleResponse<SystemSetting[]>(response);
};

export const updateCurrency = async (currency: string): Promise<ApiResponse<{ currency: string }>> => {
  const response = await fetch(`${API_BASE_URL}/settings/currency`, {
    method: 'PUT',
    ...getAuthHeaders(),
    body: JSON.stringify({ currency }),
  });
  return handleResponse<{ currency: string }>(response);
};

export const updateTimePeriod = async (
  timePeriod: string
): Promise<ApiResponse<{ timePeriod: string }>> => {
  const response = await fetch(`${API_BASE_URL}/settings/time-period`, {
    method: 'PUT',
    ...getAuthHeaders(),
    body: JSON.stringify({ timePeriod }),
  });
  return handleResponse<{ timePeriod: string }>(response);
};
