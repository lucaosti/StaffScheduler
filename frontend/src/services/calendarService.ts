import { AUTH_HEADERS, handleResponse, API_BASE_URL } from './apiUtils';

export interface CalendarTokenResponse {
  token: string;
}

const request = async <T>(path: string, init: RequestInit = {}) => {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    ...init,
    headers: { ...AUTH_HEADERS, ...(init.headers as Record<string, string> ?? {}) },
  });
  return handleResponse<T>(res);
};

export async function getOrCreateCalendarToken(): Promise<CalendarTokenResponse> {
  const res = await request<CalendarTokenResponse>('/calendar/token', { method: 'POST' });
  return res.data as CalendarTokenResponse;
}

export async function rotateCalendarToken(): Promise<CalendarTokenResponse> {
  const res = await request<CalendarTokenResponse>('/calendar/token/rotate', { method: 'POST' });
  return res.data as CalendarTokenResponse;
}

export function buildFeedUrl(token: string): string {
  return `${API_BASE_URL}/calendar/feed.ics?token=${encodeURIComponent(token)}`;
}
