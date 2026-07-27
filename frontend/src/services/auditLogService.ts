/**
 * Audit log service — wraps the `/api/audit-logs` endpoints.
 *
 * Routed through the generated client so path, method and query are checked
 * against the OpenAPI contract at compile time. See `departmentService` for
 * the full rationale.
 *
 * WHY THE FILTERS ARE DERIVED: the hand-written `AuditLogFilters` omitted
 * `onBehalfOfUserId`, which the endpoint has always accepted — so the audit
 * log could not be filtered by the field that records DELEGATED action, on the
 * one screen where "who really did this" is the entire point. An omission is
 * milder than a phantom parameter (nothing breaks; a capability is simply
 * invisible), but the root cause is identical: a hand-kept copy of a contract
 * nothing compared against it. Deriving from `paths` makes the filter set
 * exactly the documented one, and hands callers `limit`/`offset` — the legacy
 * pairing kept alongside `page`/`pageSize` — at the same time.
 *
 * The manual `URLSearchParams` assembly goes with it: the client serialises
 * the query and skips undefined values, which is all that ladder of
 * `if (x !== undefined)` was doing — and it was the ladder, not the type, that
 * decided which filters actually reached the wire.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse, AuditLogEntry } from '../types';
import type { paths } from '../api/schema';
import { apiClient } from '../api/client';
import { API_BASE_URL } from './apiUtils';

export type AuditLogFilters = NonNullable<paths['/audit-logs']['get']['parameters']['query']>;
export type AuditLogExportFilters = NonNullable<
  paths['/audit-logs/export']['get']['parameters']['query']
>;

type AuditPageResponse = ApiResponse<AuditLogEntry[]> & {
  meta?: { total: number; page: number; pageSize: number; pages: number };
};

export const listAuditLogs = (filters: AuditLogFilters = {}): Promise<AuditPageResponse> =>
  apiClient.get<AuditLogEntry[], '/audit-logs'>('/audit-logs', {
    query: filters,
  }) as Promise<AuditPageResponse>;

/**
 * URL for the export endpoint, for use as an `href`.
 *
 * Deliberately NOT routed through the client: this is a link the browser
 * follows to download a file, not a request this code issues, so there is no
 * response to type. The filter type is still derived, which is what caught
 * that the hand-written version dropped `entityId`, `requestId` and
 * `onBehalfOfUserId` — all accepted by the export endpoint, so an operator who
 * narrowed the on-screen list by one of them exported something wider than
 * what they were looking at, with nothing to indicate the discrepancy.
 */
export const buildExportUrl = (
  filters: Omit<AuditLogExportFilters, 'format'>,
  format: NonNullable<AuditLogExportFilters['format']>
): string => {
  const qs = new URLSearchParams({ format });
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null) qs.set(key, String(value));
  }
  return `${API_BASE_URL}/audit-logs/export?${qs}`;
};
