/**
 * User preferences service.
 *
 * Wraps the GET /api/preferences/me and PUT /api/preferences/me endpoints.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import { getAuthHeaders, handleResponse, API_BASE_URL } from './apiUtils';


export interface UserPreferences {
  userId: number;
  maxHoursPerWeek: number;
  minHoursPerWeek: number;
  maxConsecutiveDays: number;
  preferredShifts: number[];
  avoidShifts: number[];
  notes: string | null;
  updatedAt: string;
}

interface UpsertPreferencesInput {
  maxHoursPerWeek?: number;
  minHoursPerWeek?: number;
  maxConsecutiveDays?: number;
  preferredShifts?: number[];
  avoidShifts?: number[];
  notes?: string | null;
}

export const getMyPreferences = async (): Promise<ApiResponse<UserPreferences>> => {
  const response = await fetch(`${API_BASE_URL}/preferences/me`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  return handleResponse<UserPreferences>(response);
};

export const updateMyPreferences = async (
  input: UpsertPreferencesInput
): Promise<ApiResponse<UserPreferences>> => {
  const response = await fetch(`${API_BASE_URL}/preferences/me`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  return handleResponse<UserPreferences>(response);
};
