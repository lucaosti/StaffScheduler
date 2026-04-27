/**
 * Directory client (F22).
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import { getAuthHeaders, handleResponse } from './apiUtils';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

export interface CustomField {
  key: string;
  value: string;
  isPublic: boolean;
}

export interface DirectoryProfile {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  employeeId: string | null;
  phone: string | null;
  position: string | null;
  fields: CustomField[];
}

const request = async <T>(path: string, init: RequestInit = {}): Promise<ApiResponse<T>> => {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { ...getAuthHeaders(), ...(init.headers || {}) },
  });
  return handleResponse<T>(res);
};

export const getMe = () => request<DirectoryProfile>(`/directory/me`);

export const getUser = (id: number) => request<DirectoryProfile>(`/directory/users/${id}`);

export const setFields = (
  userId: number,
  fields: Array<{ key: string; value: string; isPublic?: boolean }>
) =>
  request<DirectoryProfile>(`/directory/users/${userId}/fields`, {
    method: 'PUT',
    body: JSON.stringify({ fields }),
  });

export const removeField = (userId: number, key: string) =>
  request<unknown>(`/directory/users/${userId}/fields/${encodeURIComponent(key)}`, {
    method: 'DELETE',
  });

/** Builds the absolute vCard download URL for a user. */
export const buildVCardUrl = (userId: number): string => `${API_BASE_URL}/directory/users/${userId}/vcard`;

/** Multi-user vCard archive URL (manager-only on the server). */
export const buildMultiVCardUrl = (userIds: number[]): string =>
  `${API_BASE_URL}/directory/vcard.vcf?ids=${userIds.join(',')}`;

export const importVcf = (vcf: string, defaultPassword?: string) =>
  request<{ inserted: number; skipped: Array<{ email: string; reason: string }> }>(
    `/directory/import-vcard`,
    {
      method: 'POST',
      body: JSON.stringify({ vcf, defaultPassword }),
    }
  );
