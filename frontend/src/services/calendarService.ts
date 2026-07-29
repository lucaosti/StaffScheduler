/**
 * Calendar service — personal iCalendar feed tokens.
 *
 * SEVERAL tokens, each revocable on its own. There used to be one per person,
 * so obtaining a new one overwrote the old and silently broke every device
 * already subscribed — the opposite of what a calendar subscription is for.
 *
 * The list never carries a raw token: only its digest is stored, so the value
 * exists exactly once, in the response that created it. A caller that wanted to
 * show it again would have to keep the secret, which is the whole thing hashing
 * avoids.
 *
 * These go through the generated client so path and method are checked against
 * the OpenAPI contract at compile time. See `departmentService` for the full
 * rationale.
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

/** A token as its owner sees it — never including the raw value. */
export interface CalendarToken {
  id: number;
  label: string;
  createdAt: string;
  /** Non-null once revoked; the row stays so the history is visible. */
  revokedAt: string | null;
}

/** The one response that ever carries the raw token. */
export interface CreatedCalendarToken {
  id: number;
  token: string;
}

export async function listCalendarTokens(): Promise<CalendarToken[]> {
  const res = await apiClient.get<CalendarToken[], '/calendar/tokens'>('/calendar/tokens');
  return res.data ?? [];
}

export async function createCalendarToken(label: string): Promise<CreatedCalendarToken> {
  const res = await apiClient.post<CreatedCalendarToken, '/calendar/tokens'>('/calendar/tokens', {
    label,
  });
  return res.data as CreatedCalendarToken;
}

export async function revokeCalendarToken(id: number): Promise<void> {
  await apiClient.delete<void, '/calendar/tokens/{id}'>('/calendar/tokens/{id}', {
    params: { id },
  });
}

export function buildFeedUrl(token: string): string {
  return `${API_BASE_URL}/calendar/feed.ics?token=${encodeURIComponent(token)}`;
}
