/**
 * Employee Service for Staff Scheduler Frontend
 *
 * API client for employee CRUD, filtering and pagination against
 * `/api/employees`.
 *
 * WHY THE GENERATED CLIENT: every call was a hand-built `fetch` with a
 * template-literal path and a manually assembled `URLSearchParams`, so a wrong
 * path, method or body compiled cleanly and failed at runtime. Routing through
 * `../api/client` checks all three against the OpenAPI contract at compile
 * time. Public signatures are unchanged, so call sites and tests are untouched.
 *
 * WHY THE TYPES ARE DERIVED RATHER THAN MIRRORED: the hand-written copies here
 * caused the two worst frontend defects found in this codebase.
 *
 *   - `CreateEmployeeData` omitted `password`, which `createUserBody`
 *     requires, so EVERY employee creation from the UI was rejected with a
 *     400. The type hid it: it described a request the server would never
 *     accept. It also declared eight fields the endpoint does not have
 *     (`address`, `certifications`, `department`, `employeeType`, `hireDate`,
 *     `maxHoursPerWeek`, `notes`, `skills`), which the server strips — so a
 *     caller sending them got a 201 and silently lost the data.
 *   - `EmployeeFilters` declared `position`, `sortBy`, `sortOrder` and
 *     `limit`, none of which this endpoint accepts, and omitted `pageSize`.
 *     `useEmployeesQuery` sent `limit: 50` believing it capped the list; the
 *     endpoint's key is `pageSize`, so the cap did nothing and the request
 *     fetched every row.
 *
 * Both were fixed by re-copying the schema by hand, which only resets the
 * clock on the next drift. Taking the types from the generated `paths` removes
 * the copy: they cannot disagree with the contract, because they are the
 * contract. Note this was only safe once the spec stopped publishing a phantom
 * `limit` through a reusable `$ref` — deriving from a lying contract would
 * have re-imported the very parameter the fix above removed.
 *
 * @author Luca Ostinelli
 */

import type { ApiResponse, Employee } from '../types';
import type { paths } from '../api/schema';
import { apiClient } from '../api/client';

export type EmployeeFilters = NonNullable<paths['/employees']['get']['parameters']['query']>;
export type CreateEmployeeData =
  paths['/employees']['post']['requestBody']['content']['application/json'];
export type UpdateEmployeeData =
  NonNullable<paths['/employees/{id}']['put']['requestBody']>['content']['application/json'];

/**
 * Employees matching the filters.
 *
 * Supplying `page` or `pageSize` makes the API return the paginated envelope
 * (`{ data, meta }`); without them it returns the plain list.
 *
 * @example
 * ```typescript
 * const all = await getEmployees();
 * const page = await getEmployees({ department: 'IT', page: 1, pageSize: 10 });
 * ```
 */
export const getEmployees = (filters: EmployeeFilters = {}): Promise<ApiResponse<Employee[]>> =>
  apiClient.get<Employee[], '/employees'>('/employees', { query: filters });

export const getEmployee = (id: number | string): Promise<ApiResponse<Employee>> =>
  apiClient.get<Employee, '/employees/{id}'>('/employees/{id}', { params: { id: Number(id) } });

export const createEmployee = (
  employeeData: CreateEmployeeData
): Promise<ApiResponse<Employee>> => apiClient.post<Employee, '/employees'>('/employees', employeeData);

export const updateEmployee = (
  id: number | string,
  employeeData: UpdateEmployeeData
): Promise<ApiResponse<Employee>> =>
  apiClient.put<Employee, '/employees/{id}'>('/employees/{id}', employeeData, {
    params: { id: Number(id) },
  });

export const deleteEmployee = (id: number | string): Promise<ApiResponse<void>> =>
  apiClient.delete<void, '/employees/{id}'>('/employees/{id}', { params: { id: Number(id) } });
