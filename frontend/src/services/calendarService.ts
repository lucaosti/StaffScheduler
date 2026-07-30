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

/**
 * The filters a subscribed aggregate feed carries in its URL.
 *
 * The names are the PUBLISHED parameter names, singular, even though each holds
 * several ids — because the wire form is one comma-joined value per parameter,
 * and the encoding is exactly what the builder below exists to do. Naming them
 * plurally would have read better and made the type impossible to compare
 * against the contract, which is how a filter interface starts drifting from the
 * endpoint it feeds; `apiContract.test.ts` compares this one by name.
 */
export interface AggregateFeedFilters {
  departmentId?: number[];
  roleId?: number[];
  userId?: number[];
  pastDays?: number;
  futureDays?: number;
}

/**
 * The URL for a filtered aggregate feed.
 *
 * Note what is NOT in it: any notion of scope. The server resolves the token
 * owner's org-unit scope on every fetch and intersects it with these filters,
 * so a URL cannot widen its own reach and stops publishing a unit as soon as
 * its owner's authority over that unit ends. Building the scope into the URL
 * here would be the mistake — a feed made while someone managed a ward would
 * keep serving it afterwards.
 *
 * Empty lists are omitted rather than sent as `departmentId=`, which the query
 * schema rejects — and rightly, since it is neither a filter nor the absence of
 * one.
 */
export function buildAggregateFeedUrl(token: string, filters: AggregateFeedFilters = {}): string {
  const query = new URLSearchParams({ token });
  const ids = (values?: number[]) => (values && values.length > 0 ? values.join(',') : undefined);

  const departmentId = ids(filters.departmentId);
  const roleId = ids(filters.roleId);
  const userId = ids(filters.userId);
  if (departmentId) query.set('departmentId', departmentId);
  if (roleId) query.set('roleId', roleId);
  if (userId) query.set('userId', userId);
  if (filters.pastDays !== undefined) query.set('pastDays', String(filters.pastDays));
  if (filters.futureDays !== undefined) query.set('futureDays', String(filters.futureDays));

  return `${API_BASE_URL}/calendar/aggregate.ics?${query.toString()}`;
}
