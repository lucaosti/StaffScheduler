/**
 * Notifications client — wraps the `/api/notifications` endpoints.
 *
 * Routed through the generated client so path, method and query are checked
 * against the OpenAPI contract at compile time. See `departmentService` for
 * the full rationale.
 *
 * The options type is derived from the contract rather than hand-declared,
 * which also removes the manual `URLSearchParams` assembly. Note `unreadOnly`
 * is the string enum `'0' | '1'`, not a boolean — the historical spelling the
 * endpoint has always parsed. The old code converted a boolean to `'1'` and
 * omitted the parameter entirely when false, which happened to agree with the
 * schema; deriving the type makes that agreement structural instead of
 * coincidental. `limit` here is a genuine documented parameter, unlike the
 * phantom one the spec used to publish through a reusable `$ref`.
 *
 * `AppNotification` stays hand-written: notifications are not among the domain
 * entities declared in `packages/shared/src/domain.ts`, so there is nothing to
 * derive the response shape from yet.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import type { paths } from '../api/schema';
import { apiClient } from '../api/client';

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

export type NotificationFilters = NonNullable<
  paths['/notifications']['get']['parameters']['query']
>;

export const listNotifications = (
  options: NotificationFilters = {}
): Promise<ApiResponse<AppNotification[]>> =>
  apiClient.get<AppNotification[], '/notifications'>('/notifications', { query: options });

export const getUnreadCount = (): Promise<ApiResponse<{ count: number }>> =>
  apiClient.get<{ count: number }, '/notifications/unread-count'>('/notifications/unread-count');

export const markNotificationRead = (id: number): Promise<ApiResponse<void>> =>
  apiClient.patch<void, '/notifications/{id}/read'>('/notifications/{id}/read', undefined, {
    params: { id },
  });

export const markAllNotificationsRead = (): Promise<ApiResponse<{ updated: number }>> =>
  apiClient.patch<{ updated: number }, '/notifications/read-all'>(
    '/notifications/read-all',
    undefined
  );
