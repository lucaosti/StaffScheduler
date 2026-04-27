/**
 * Calendar client (F04).
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import { getAuthHeaders, handleResponse } from './apiUtils';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

const request = async <T>(path: string, init: RequestInit = {}): Promise<ApiResponse<T>> => {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { ...getAuthHeaders(), ...(init.headers || {}) },
  });
  return handleResponse<T>(res);
};

export const getOrCreateToken = () =>
  request<{ token: string }>(`/calendar/token`, { method: 'POST' });

export const rotateToken = () =>
  request<{ token: string }>(`/calendar/token/rotate`, { method: 'POST' });

/**
 * Builds the public iCal subscription URL the user copies into their
 * calendar app. Token is the opaque string returned by getOrCreateToken.
 */
export const buildSubscriptionUrl = (token: string): string =>
  `${API_BASE_URL}/calendar/feed.ics?token=${encodeURIComponent(token)}`;

export const buildDepartmentSubscriptionUrl = (departmentId: number, token: string): string =>
  `${API_BASE_URL}/calendar/department/${departmentId}.ics?token=${encodeURIComponent(token)}`;
