/**
 * Employee Service for Staff Scheduler Frontend
 * 
 * Handles all employee-related API calls including CRUD operations,
 * filtering, pagination, and data management.
 * 
 * Features:
 * - Full CRUD operations for employee management
 * - Advanced filtering and search capabilities
 * - Pagination support for large datasets
 * - Error handling with custom ApiError
 * - Type-safe API responses
 * 
 * @author Luca Ostinelli
 */

import { ApiResponse, Employee } from '../types';
import { handleResponse, getAuthHeaders, API_BASE_URL } from './apiUtils';


/**
 * Interface for employee filtering and pagination options
 */
/**
 * Mirrors the server's `employeeListQuery` schema.
 *
 * It had drifted: `position`, `sortBy` and `sortOrder` were never parameters
 * this endpoint accepts, and the page size is `pageSize`, not `limit`. Since
 * the query contract became schema-validated those keys are stripped outright,
 * so sending them looked like a working sort and a working page cap while
 * neither did anything — `limit: 50` in particular read as a bound on the
 * employees list while the request actually returned every row.
 */
interface EmployeeFilters {
  /** Filter by department id or name. */
  department?: string;
  /** Search term matched against names, email and employee id. */
  search?: string;
  isActive?: boolean;
  /** Page number (1-based). Supplying page or pageSize returns the envelope. */
  page?: number;
  pageSize?: number;
}

/**
 * Interface for creating new employee records
 */
export interface CreateEmployeeData {
  /** Unique employee identifier */
  employeeId: string;
  /** Employee's first name */
  firstName: string;
  /** Employee's last name */
  lastName: string;
  /** Employee's email address */
  email: string;
  /** Employee's phone number (optional) */
  phone?: string;
  /** Employee's address (optional) */
  address?: string;
  /** Department assignment (optional, display name) */
  department?: string;
  /** Department IDs for server-side assignment */
  departmentIds?: number[];
  /** Job position/role (optional) */
  position?: string;
  /** Date of hire in ISO format (optional) */
  hireDate?: string;
  /** Employment type classification */
  employeeType?: 'full-time' | 'part-time' | 'contractor';
  /** Hourly pay rate (optional) */
  hourlyRate?: number;
  /** Maximum weekly hours (optional) */
  maxHoursPerWeek?: number;
  /** List of skills/competencies (optional) */
  skills?: string[];
  /** Professional certifications (optional) */
  certifications?: string[];
  /** Additional notes (optional) */
  notes?: string;
}

export type UpdateEmployeeData = Partial<CreateEmployeeData>;

/**
 * Retrieves a list of employees with optional filtering and pagination
 * @param filters - Optional filtering and pagination parameters
 * @returns Promise resolving to array of employees matching criteria
 * @throws {ApiError} When request fails or user lacks permissions
 * 
 * @example
 * ```typescript
 * // Get all employees
 * const allEmployees = await getEmployees();
 * 
 * // Get filtered employees with pagination
 * const filteredEmployees = await getEmployees({
 *   department: 'IT',
 *   page: 1,
 *   pageSize: 10,
 * });
 * ```
 */
export const getEmployees = async (filters: EmployeeFilters = {}): Promise<ApiResponse<Employee[]>> => {
  const queryParams = new URLSearchParams();
  
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      queryParams.append(key, value.toString());
    }
  });

  const response = await fetch(`${API_BASE_URL}/employees?${queryParams}`, {
    method: 'GET',
    ...getAuthHeaders(),
  });
  
  return handleResponse<Employee[]>(response);
};

/**
 * Retrieves a specific employee by their ID
 * @param employeeId - Unique identifier of the employee
 * @returns Promise resolving to employee data
 * @throws {ApiError} When employee not found or access denied
 * 
 * @example
 * ```typescript
 * const employee = await getEmployee('EMP001');
 * console.log(`Employee: ${employee.data.firstName} ${employee.data.lastName}`);
 * ```
 */
export const getEmployee = async (id: number | string): Promise<ApiResponse<Employee>> => {
  const response = await fetch(`${API_BASE_URL}/employees/${id}`, {
    method: 'GET',
    ...getAuthHeaders(),
  });
  
  return handleResponse<Employee>(response);
};

/**
 * Creates a new employee record
 * @param employeeData - Complete employee information for creation
 * @returns Promise resolving to the newly created employee
 * @throws {ApiError} When validation fails or employee ID conflicts
 * 
 * @example
 * ```typescript
 * const newEmployee = await createEmployee({
 *   employeeId: 'EMP123',
 *   firstName: 'John',
 *   lastName: 'Doe',
 *   email: 'john.doe@company.com',
 *   department: 'IT',
 *   position: 'Developer'
 * });
 * ```
 */
export const createEmployee = async (employeeData: CreateEmployeeData): Promise<ApiResponse<Employee>> => {
  const response = await fetch(`${API_BASE_URL}/employees`, {
    method: 'POST',
    ...getAuthHeaders(),
    body: JSON.stringify(employeeData),
  });
  
  return handleResponse<Employee>(response);
};

/**
 * Updates an existing employee record
 * @param employeeId - ID of the employee to update
 * @param employeeData - Partial employee data with fields to update
 * @returns Promise resolving to the updated employee
 * @throws {ApiError} When employee not found or validation fails
 * 
 * @example
 * ```typescript
 * const updated = await updateEmployee('EMP123', {
 *   position: 'Senior Developer',
 *   hourlyRate: 85.00
 * });
 * ```
 */
export const updateEmployee = async (id: number | string, employeeData: UpdateEmployeeData): Promise<ApiResponse<Employee>> => {
  const response = await fetch(`${API_BASE_URL}/employees/${id}`, {
    method: 'PUT',
    ...getAuthHeaders(),
    body: JSON.stringify(employeeData),
  });
  
  return handleResponse<Employee>(response);
};

/**
 * Deletes an employee record
 * @param employeeId - ID of the employee to delete
 * @returns Promise resolving when deletion is complete
 * @throws {ApiError} When employee not found or deletion fails
 * 
 * @example
 * ```typescript
 * await deleteEmployee('EMP123');
 * console.log('Employee deleted successfully');
 * ```
 */
export const deleteEmployee = async (id: number | string): Promise<ApiResponse<void>> => {
  const response = await fetch(`${API_BASE_URL}/employees/${id}`, {
    method: 'DELETE',
    ...getAuthHeaders(),
  });
  
  return handleResponse<void>(response);
};
