/**
 * System settings service.
 *
 * Wraps the GET /api/settings and PUT /api/settings/* endpoints.
 * Only accessible to users with the system.settings permission.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import { getAuthHeaders, handleResponse } from './apiUtils';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

export interface SystemSetting {
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
    headers: getAuthHeaders(),
  });
  return handleResponse<SystemSetting[]>(response);
};

export const updateCurrency = async (currency: string): Promise<ApiResponse<{ currency: string }>> => {
  const response = await fetch(`${API_BASE_URL}/settings/currency`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify({ currency }),
  });
  return handleResponse<{ currency: string }>(response);
};

export const updateTimePeriod = async (
  timePeriod: string
): Promise<ApiResponse<{ timePeriod: string }>> => {
  const response = await fetch(`${API_BASE_URL}/settings/time-period`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify({ timePeriod }),
  });
  return handleResponse<{ timePeriod: string }>(response);
};

export const updateSystemSetting = async (
  category: string,
  key: string,
  value: string
): Promise<ApiResponse<SystemSetting>> => {
  const response = await fetch(`${API_BASE_URL}/settings/${category}/${key}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify({ value }),
  });
  return handleResponse<SystemSetting>(response);
};
