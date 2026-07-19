/**
 * Notifications client — wraps /api/notifications endpoints.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import { AUTH_HEADERS, handleResponse, API_BASE_URL } from './apiUtils';

export interface AppNotification {
  id: number;
  userId: number;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  isRead: boolean;
  createdAt: string;
  readAt: string | null;
}

const request = async <T>(path: string, init: RequestInit = {}): Promise<ApiResponse<T>> => {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    ...init,
    headers: { ...AUTH_HEADERS, ...(init.headers as Record<string, string> ?? {}) },
  });
  return handleResponse<T>(res);
};

export const listNotifications = (
  options: { unreadOnly?: boolean; limit?: number } = {}
): Promise<ApiResponse<AppNotification[]>> => {
  const qs = new URLSearchParams();
  if (options.unreadOnly) qs.set('unreadOnly', '1');
  if (options.limit !== undefined) qs.set('limit', String(options.limit));
  const suffix = qs.toString() ? `?${qs}` : '';
  return request<AppNotification[]>(`/notifications${suffix}`);
};

export const getUnreadCount = (): Promise<ApiResponse<{ count: number }>> =>
  request<{ count: number }>('/notifications/unread-count');

export const markNotificationRead = (id: number): Promise<ApiResponse<void>> =>
  request<void>(`/notifications/${id}/read`, { method: 'PATCH' });

export const markAllNotificationsRead = (): Promise<ApiResponse<{ updated: number }>> =>
  request<{ updated: number }>('/notifications/read-all', { method: 'PATCH' });
