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

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

/**
 * Custom error class for API-related errors
 */
class ApiError extends Error {
  /**
   * Creates an ApiError instance
   * @param message - Error message
   * @param status - HTTP status code (optional)
   */
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Handles API response parsing and error checking
 * @template T - Expected response data type
 * @param response - Fetch API response object
 * @returns Parsed API response or throws ApiError
 * @throws {ApiError} When response is not ok or parsing fails
 */
const handleResponse = async <T>(response: Response): Promise<ApiResponse<T>> => {
  const contentType = response.headers.get('content-type');
  const isJson = contentType && contentType.includes('application/json');
  
  const data = isJson ? await response.json() : await response.text();
  
  if (!response.ok) {
    throw new ApiError(
      data.message || `HTTP error! status: ${response.status}`,
      response.status
    );
  }
  
  return data;
};

/**
 * Gets authentication headers including JWT token if available
 * @returns Headers object with Content-Type and Authorization if token exists
 */
const getAuthHeaders = (): HeadersInit => {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
  };
};

/**
 * Interface for employee filtering and pagination options
 */
export interface EmployeeFilters {
  /** Filter by department name */
  department?: string;
  /** Filter by position/role */
  position?: string;
  /** Search term for names, emails, or other fields */
  search?: string;
  /** Page number for pagination (1-based) */
  page?: number;
  /** Number of items per page */
  limit?: number;
  /** Field to sort by */
  sortBy?: string;
  /** Sort order direction */
  sortOrder?: 'asc' | 'desc';
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
  /** Department assignment (optional) */
  department?: string;
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

/**
 * Interface for updating existing employee records
 * Extends CreateEmployeeData with all fields optional
 */
export interface UpdateEmployeeData extends Partial<CreateEmployeeData> {}

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
 *   limit: 10,
 *   sortBy: 'lastName'
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
    headers: getAuthHeaders(),
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
export const getEmployee = async (employeeId: string): Promise<ApiResponse<Employee>> => {
  const response = await fetch(`${API_BASE_URL}/employees/${employeeId}`, {
    method: 'GET',
    headers: getAuthHeaders(),
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
    headers: getAuthHeaders(),
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
export const updateEmployee = async (employeeId: string, employeeData: UpdateEmployeeData): Promise<ApiResponse<Employee>> => {
  const response = await fetch(`${API_BASE_URL}/employees/${employeeId}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
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
export const deleteEmployee = async (employeeId: string): Promise<ApiResponse<void>> => {
  const response = await fetch(`${API_BASE_URL}/employees/${employeeId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  
  return handleResponse<void>(response);
};
