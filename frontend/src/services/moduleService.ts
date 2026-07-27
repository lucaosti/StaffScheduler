/**
 * Module service — wraps the `/api/modules` endpoints.
 *
 * Routed through the generated client so path, method and body are checked
 * against the OpenAPI contract at compile time. See `departmentService` for
 * the full rationale.
 *
 * WHY THE PATH PARAMETERS ARE NOT COERCED HERE: `code` and `org` are strings
 * in the contract, unlike the numeric `id` parameters elsewhere, so they pass
 * through untouched. The client escapes them, which is what the removed
 * `encodeURIComponent` calls were doing by hand — a module code containing a
 * slash would otherwise have broken the path.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse, Module, ModuleWithOrgOverride } from '../types';
import type { paths } from '../api/schema';
import { apiClient } from '../api/client';

type ModuleToggleBody = paths['/modules/{code}']['put']['requestBody']['content']['application/json'];
type OrgOverrideBody =
  paths['/modules/{code}/org/{org}']['put']['requestBody']['content']['application/json'];

export const listModules = (): Promise<ApiResponse<Module[]>> =>
  apiClient.get<Module[], '/modules'>('/modules');

export const listModulesForOrg = (org: string): Promise<ApiResponse<ModuleWithOrgOverride[]>> =>
  apiClient.get<ModuleWithOrgOverride[], '/modules/org/{org}'>('/modules/org/{org}', {
    params: { org },
  });

export const setModuleEnabled = (
  code: string,
  isEnabled: boolean,
  justification?: string
): Promise<ApiResponse<Module>> =>
  apiClient.put<Module, '/modules/{code}'>(
    '/modules/{code}',
    { isEnabled, justification: justification || null } satisfies ModuleToggleBody,
    { params: { code } }
  );

export const setModuleOrgOverride = (
  code: string,
  org: string,
  isEnabled: boolean,
  justification?: string
): Promise<ApiResponse<ModuleWithOrgOverride>> =>
  apiClient.put<ModuleWithOrgOverride, '/modules/{code}/org/{org}'>(
    '/modules/{code}/org/{org}',
    { isEnabled, justification: justification || null } satisfies OrgOverrideBody,
    { params: { code, org } }
  );

export const removeModuleOrgOverride = (code: string, org: string): Promise<ApiResponse<void>> =>
  apiClient.delete<void, '/modules/{code}/org/{org}'>('/modules/{code}/org/{org}', {
    params: { code, org },
  });
