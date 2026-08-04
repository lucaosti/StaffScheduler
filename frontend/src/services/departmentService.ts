/**
 * Department Service
 *
 * API client for department CRUD against `/api/departments`.
 *
 * WHY THE GENERATED CLIENT: this module used to rebuild the fetch call by
 * hand — a local `request` helper wrapping `fetch` with `AUTH_HEADERS` and
 * template-literal paths. A wrong path, a wrong method or a body the backend
 * no longer accepts compiled cleanly and failed at runtime. Going through
 * `../api/client` checks all three against the OpenAPI contract at compile
 * time. Public function signatures are unchanged, so call sites and tests are
 * untouched; the typing lives inside the module.
 *
 * WHY THE LOCAL `Department` INTERFACE IS GONE: it declared five fields
 * (`id`, `name`, `description`, `managerId`, `isActive`) where the contract
 * has ten — missing `managerName`, `orgUnitId`, `employeeCount`, `createdAt`
 * and `updatedAt`, and marking `isActive` optional where the schema requires
 * it. A second hand-written copy of a shared type is the exact shape that made
 * the audit log's actor column render an em-dash on every row: the data was in
 * the response and the type said it was not there. The entity is declared once
 * in `@staff-scheduler/shared` (`departmentSchema`, from which the OpenAPI
 * component is generated) and re-exported by the type barrel, so importers keep
 * the same `Department` name and cannot drift from the wire shape again.
 *
 * @author Luca Ostinelli
 */

import type { ApiResponse, Department, Geofence } from '../types';
import type { paths } from '../api/schema';
import { apiClient } from '../api/client';

export type { Department };

/**
 * Request bodies and query filters taken from the generated contract rather
 * than retyped. Hand-mirrored payload types are what let `CreateEmployeeData`
 * omit the required `password` — describing a request the server would never
 * accept, so every employee creation from the UI was rejected — and what let
 * `EmployeeFilters` send a `limit` the endpoint has never had. Deriving them
 * removes the copy that drifts rather than adding another test to compare it.
 */
export type CreateDepartmentData =
  paths['/departments']['post']['requestBody']['content']['application/json'];
export type UpdateDepartmentData =
  NonNullable<paths['/departments/{id}']['put']['requestBody']>['content']['application/json'];
export type DepartmentFilters = NonNullable<paths['/departments']['get']['parameters']['query']>;

export const getDepartments = (filters: DepartmentFilters = {}) =>
  apiClient.get<Department[], '/departments'>('/departments', { query: filters });

export const getDepartmentById = (id: number | string) =>
  apiClient.get<Department, '/departments/{id}'>('/departments/{id}', {
    params: { id: Number(id) },
  });

export const createDepartment = (data: CreateDepartmentData): Promise<ApiResponse<Department>> =>
  apiClient.post<Department, '/departments'>('/departments', data);

export const updateDepartment = (
  id: number | string,
  data: UpdateDepartmentData
): Promise<ApiResponse<Department>> =>
  apiClient.put<Department, '/departments/{id}'>('/departments/{id}', data, {
    params: { id: Number(id) },
  });

export const deleteDepartment = (id: number | string) =>
  apiClient.delete<unknown, '/departments/{id}'>('/departments/{id}', {
    params: { id: Number(id) },
  });

// ── Geofences ──────────────────────────────────────────────────────────────

export type CreateGeofenceData =
  paths['/departments/{id}/geofences']['post']['requestBody']['content']['application/json'];
export type UpdateGeofenceData =
  NonNullable<paths['/departments/{id}/geofences/{geofenceId}']['put']['requestBody']>['content']['application/json'];

export const getGeofences = (departmentId: number | string) =>
  apiClient.get<Geofence[], '/departments/{id}/geofences'>('/departments/{id}/geofences', {
    params: { id: Number(departmentId) },
  });

export const createGeofence = (departmentId: number | string, data: CreateGeofenceData) =>
  apiClient.post<Geofence, '/departments/{id}/geofences'>('/departments/{id}/geofences', data, {
    params: { id: Number(departmentId) },
  });

export const updateGeofence = (
  departmentId: number | string,
  geofenceId: number | string,
  data: UpdateGeofenceData
) =>
  apiClient.put<Geofence, '/departments/{id}/geofences/{geofenceId}'>(
    '/departments/{id}/geofences/{geofenceId}',
    data,
    { params: { id: Number(departmentId), geofenceId: Number(geofenceId) } }
  );

export const deleteGeofence = (departmentId: number | string, geofenceId: number | string) =>
  apiClient.delete<unknown, '/departments/{id}/geofences/{geofenceId}'>(
    '/departments/{id}/geofences/{geofenceId}',
    { params: { id: Number(departmentId), geofenceId: Number(geofenceId) } }
  );
