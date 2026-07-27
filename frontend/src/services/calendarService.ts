/**
 * Calendar service — personal iCalendar feed token.
 *
 * `getOrCreateCalendarToken` and `rotateCalendarToken` go through the
 * generated client so path and method are checked against the OpenAPI
 * contract at compile time. See `departmentService` for the full rationale.
 *
 * `buildFeedUrl` deliberately does NOT: the feed URL is handed to an external
 * calendar client (Google Calendar, Outlook, Apple Calendar) to poll on its
 * own, so it is a string this app produces, not a request it issues. The token
 * is the credential, which is why it is query-borne here and why the endpoint
 * answers a missing one with a `401 text/plain` rather than the JSON envelope
 * — iCal clients expect auth semantics, not an API error body. That is also
 * why the token is optional to the query schema.
 *
 * @author Luca Ostinelli
 */

import { API_BASE_URL } from './apiUtils';
import { apiClient } from '../api/client';

export interface CalendarTokenResponse {
  token: string;
}

export async function getOrCreateCalendarToken(): Promise<CalendarTokenResponse> {
  const res = await apiClient.post<CalendarTokenResponse, '/calendar/token'>(
    '/calendar/token',
    undefined
  );
  return res.data as CalendarTokenResponse;
}

export async function rotateCalendarToken(): Promise<CalendarTokenResponse> {
  const res = await apiClient.post<CalendarTokenResponse, '/calendar/token/rotate'>(
    '/calendar/token/rotate',
    undefined
  );
  return res.data as CalendarTokenResponse;
}

export function buildFeedUrl(token: string): string {
  return `${API_BASE_URL}/calendar/feed.ics?token=${encodeURIComponent(token)}`;
}
