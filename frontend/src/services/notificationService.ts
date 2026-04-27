/**
 * Notifications client (F03).
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import { getAuthHeaders, handleResponse } from './apiUtils';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

export interface Notification {
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
    ...init,
    headers: { ...getAuthHeaders(), ...(init.headers || {}) },
  });
  return handleResponse<T>(res);
};

export const listNotifications = (opts: { unreadOnly?: boolean; limit?: number } = {}) => {
  const qs = new URLSearchParams();
  if (opts.unreadOnly) qs.set('unreadOnly', '1');
  if (opts.limit) qs.set('limit', String(opts.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return request<Notification[]>(`/notifications${suffix}`);
};

export const unreadCount = () => request<{ count: number }>(`/notifications/unread-count`);

export const markRead = (id: number) =>
  request<void>(`/notifications/${id}/read`, { method: 'PATCH' });

export const markAllRead = () =>
  request<{ updated: number }>(`/notifications/read-all`, { method: 'PATCH' });
