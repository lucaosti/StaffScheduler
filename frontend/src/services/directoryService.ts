/**
 * Directory service — wraps `/api/directory`.
 *
 * A DIFFERENT THING FROM THE ACCOUNT. `/users` answers "may this person sign
 * in, with which roles"; the directory answers "who is this person and how do
 * I reach them". Same human, different question, different audience — which is
 * why they are separate services rather than one with more fields.
 *
 * vCard export is intentionally left to the browser rather than fetched here:
 * the endpoints return a file with a content type, and turning that into a
 * blob through the typed client only to hand it back to a download is work
 * that achieves nothing an anchor does not.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import type { paths } from '../api/schema';
import { apiClient } from '../api/client';

interface DirectoryField {
  key: string;
  value: string;
  /** Whether the field is visible beyond the people who administer it. */
  isPublic: boolean;
}

export interface DirectoryProfile {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  employeeId: string | null;
  phone: string | null;
  position: string | null;
  fields: DirectoryField[];
}

type FieldsBody = NonNullable<
  paths['/directory/users/{id}/fields']['put']['requestBody']
>['content']['application/json'];

export const getMyProfile = (): Promise<ApiResponse<DirectoryProfile>> =>
  apiClient.get<DirectoryProfile, '/directory/me'>('/directory/me');

export const getProfile = (id: number): Promise<ApiResponse<DirectoryProfile>> =>
  apiClient.get<DirectoryProfile, '/directory/users/{id}'>('/directory/users/{id}', {
    params: { id },
  });

export const saveProfileFields = (
  id: number,
  fields: Array<{ key: string; value: unknown }>
): Promise<ApiResponse<DirectoryProfile>> =>
  apiClient.put<DirectoryProfile, '/directory/users/{id}/fields'>(
    '/directory/users/{id}/fields',
    { fields } satisfies FieldsBody,
    { params: { id } }
  );

export const removeProfileField = (id: number, key: string): Promise<ApiResponse<void>> =>
  apiClient.delete<void, '/directory/users/{id}/fields/{key}'>(
    '/directory/users/{id}/fields/{key}',
    { params: { id, key } }
  );

/** Where the browser should go to download one person's card. */
export const vcardUrl = (id: number): string => `/api/directory/users/${id}/vcard`;
