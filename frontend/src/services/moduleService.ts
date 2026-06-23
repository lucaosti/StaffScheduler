/**
 * Module service — wraps /api/modules endpoints.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse, Module, ModuleWithOrgOverride } from '../types';
import { getAuthHeaders, handleResponse, API_BASE_URL } from './apiUtils';

export const listModules = async (): Promise<ApiResponse<Module[]>> => {
  const res = await fetch(`${API_BASE_URL}/modules`, { method: 'GET', ...getAuthHeaders() });
  return handleResponse<Module[]>(res);
};

export const listModulesForOrg = async (org: string): Promise<ApiResponse<ModuleWithOrgOverride[]>> => {
  const res = await fetch(`${API_BASE_URL}/modules/org/${encodeURIComponent(org)}`, {
    method: 'GET',
    ...getAuthHeaders(),
  });
  return handleResponse<ModuleWithOrgOverride[]>(res);
};

export const setModuleEnabled = async (
  code: string,
  isEnabled: boolean,
  justification?: string
): Promise<ApiResponse<Module>> => {
  const res = await fetch(`${API_BASE_URL}/modules/${encodeURIComponent(code)}`, {
    method: 'PUT',
    ...getAuthHeaders(),
    body: JSON.stringify({ isEnabled, justification: justification || null }),
  });
  return handleResponse<Module>(res);
};

export const setModuleOrgOverride = async (
  code: string,
  org: string,
  isEnabled: boolean,
  justification?: string
): Promise<ApiResponse<ModuleWithOrgOverride>> => {
  const res = await fetch(
    `${API_BASE_URL}/modules/${encodeURIComponent(code)}/org/${encodeURIComponent(org)}`,
    {
      method: 'PUT',
      ...getAuthHeaders(),
      body: JSON.stringify({ isEnabled, justification: justification || null }),
    }
  );
  return handleResponse<ModuleWithOrgOverride>(res);
};

export const removeModuleOrgOverride = async (
  code: string,
  org: string
): Promise<ApiResponse<void>> => {
  const res = await fetch(
    `${API_BASE_URL}/modules/${encodeURIComponent(code)}/org/${encodeURIComponent(org)}`,
    { method: 'DELETE', ...getAuthHeaders() }
  );
  return handleResponse<void>(res);
};
