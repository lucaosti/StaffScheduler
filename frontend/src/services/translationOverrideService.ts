/**
 * Translation override service — wraps `/api/i18n/overrides`.
 *
 * `getMyOverrides` is the caller's-own-organization lookup every signed-in
 * user's frontend calls (see `AuthContext`); the rest is the admin CRUD
 * surface gated on `settings.manage`.
 *
 * @author Luca Ostinelli
 */

import type { ApiResponse } from '../types';
import type { paths } from '../api/schema';
import { apiClient } from '../api/client';

export interface TranslationOverride {
  id: number;
  organizationName: string | null;
  locale: string;
  overrides: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

type CreateBody = NonNullable<
  paths['/i18n/overrides/admin']['post']['requestBody']
>['content']['application/json'];
type UpdateBody = NonNullable<
  paths['/i18n/overrides/admin/{id}']['put']['requestBody']
>['content']['application/json'];

/** The override map for the caller's own organization and the given locale. */
export const getMyOverrides = (locale: string): Promise<ApiResponse<Record<string, string>>> =>
  apiClient.get<Record<string, string>, '/i18n/overrides'>('/i18n/overrides', { query: { locale } });

export const listTranslationOverrides = (): Promise<ApiResponse<TranslationOverride[]>> =>
  apiClient.get<TranslationOverride[], '/i18n/overrides/admin'>('/i18n/overrides/admin');

export const createTranslationOverride = (
  body: CreateBody
): Promise<ApiResponse<TranslationOverride>> =>
  apiClient.post<TranslationOverride, '/i18n/overrides/admin'>('/i18n/overrides/admin', body);

export const updateTranslationOverride = (
  id: number,
  body: UpdateBody
): Promise<ApiResponse<TranslationOverride>> =>
  apiClient.put<TranslationOverride, '/i18n/overrides/admin/{id}'>('/i18n/overrides/admin/{id}', body, {
    params: { id },
  });

export const deleteTranslationOverride = (id: number): Promise<ApiResponse<void>> =>
  apiClient.delete<void, '/i18n/overrides/admin/{id}'>('/i18n/overrides/admin/{id}', { params: { id } });
