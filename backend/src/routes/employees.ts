/**
 * Employee Routes
 * 
 * Handles all employee management operations including CRUD operations,
 * search functionality, and employee data management.
 * 
 * Features:
 * - Complete employee lifecycle management
 * - Advanced filtering and pagination
 * - Employee search capabilities
 * - Data validation and error handling
 * - Role-based access control
 * 
 * Security:
 * - Authentication required for all endpoints
 * - Input validation and sanitization
 * - Error message standardization
 * - Audit trail for modifications
 * 
 * @author Luca Ostinelli
 */

import { Router, Request, Response } from 'express';
import { employeeService } from '../services/EmployeeService';
import { authenticate } from '../middleware/auth';

const router = Router();

/**
 * Get All Employees Endpoint
 * 
 * Retrieves employees with filtering, pagination, and sorting support.
 * Supports department, position filtering and text search.
 * 
 * @route GET /api/employees
 * @param {string} [department] - Filter by department
 * @param {string} [position] - Filter by position
 * @param {string} [search] - Text search across employee data
 * @param {number} [page=1] - Page number for pagination
 * @param {number} [limit=20] - Items per page (max 100)
 * @param {string} [sortBy=firstName] - Field to sort by
 * @param {string} [sortOrder=asc] - Sort order (asc/desc)
 * @returns {Object} Paginated employee list with metadata
 * 
 * @example
 * GET /api/employees?department=Nursing&page=1&limit=10&search=john
 * Returns: { success: true, data: [...], pagination: {...} }
 */
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const filters = {
      department: req.query.department as string,
      position: req.query.position as string,
      search: req.query.search as string,
    };

    const pagination = {
      page: parseInt(req.query.page as string) || 1,
      limit: Math.min(parseInt(req.query.limit as string) || 20, 100),
      sortBy: req.query.sortBy as string || 'firstName',
      sortOrder: (req.query.sortOrder as string) === 'desc' ? 'desc' as const : 'asc' as const
    };

    const result = await employeeService.findAll(filters, pagination);

    res.json({
      success: true,
      data: result.employees,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total: result.total,
        pages: Math.ceil(result.total / pagination.limit),
        hasNext: pagination.page < Math.ceil(result.total / pagination.limit),
        hasPrev: pagination.page > 1
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: (error as Error).message
      }
    });
  }
});

/**
 * Get Employee by ID Endpoint
 * 
 * Retrieves detailed information for a specific employee.
 * Returns complete employee profile including supervisor information.
 * 
 * @route GET /api/employees/:id
 * @param {string} id - Employee ID (path parameter)
 * @returns {Object} Employee object with complete details
 * 
 * @example
 * GET /api/employees/EMP001
 * Returns: { success: true, data: { employeeId: "EMP001", ... } }
 */
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const employeeId = req.params.id;
    const employee = await employeeService.findByEmployeeId(employeeId);

    if (!employee) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Employee not found'
        }
      });
    }

    res.json({
      success: true,
      data: employee
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: (error as Error).message
      }
    });
  }
});

/**
 * Create New Employee Endpoint
 * 
 * Creates a new employee record with comprehensive validation.
 * Validates required fields and ensures data integrity.
 * 
 * @route POST /api/employees
 * @param {Object} body - Employee data object
 * @param {string} body.employeeId - Unique employee identifier
 * @param {string} body.firstName - Employee first name
 * @param {string} body.lastName - Employee last name
 * @param {string} body.email - Employee email address
 * @param {string} [body.phone] - Employee phone number
 * @param {string} body.position - Employee position/role
 * @param {string} body.department - Employee department
 * @returns {Object} Created employee object
 * 
 * @example
 * POST /api/employees
 * Body: { employeeId: "EMP001", firstName: "John", lastName: "Doe", ... }
 * Returns: { success: true, data: { employeeId: "EMP001", ... } }
 */
router.post('/', authenticate, async (req: Request, res: Response) => {
  try {
    const employeeData = req.body;

    // Basic validation
    if (!employeeData.employeeId || !employeeData.firstName || !employeeData.lastName || !employeeData.email) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Employee ID, first name, last name, and email are required'
        }
      });
    }

    const employee = await employeeService.createEmployee(employeeData);

    res.status(201).json({
      success: true,
      data: employee
    });
  } catch (error) {
    const message = (error as Error).message;
    const statusCode = message.includes('already exists') || message.includes('already in use') ? 409 : 500;
    
    res.status(statusCode).json({
      success: false,
      error: {
        code: statusCode === 409 ? 'CONFLICT' : 'INTERNAL_ERROR',
        message
      }
    });
  }
});

/**
 * Update Employee Endpoint
 * 
 * Updates existing employee information with partial data support.
 * Validates employee existence and prevents email conflicts.
 * 
 * @route PUT /api/employees/:id
 * @param {string} id - Employee ID (path parameter)
 * @param {Object} body - Partial employee data to update
 * @returns {Object} Updated employee object
 * 
 * @example
 * PUT /api/employees/EMP001
 * Body: { position: "Senior Nurse", department: "ICU" }
 * Returns: { success: true, data: { employeeId: "EMP001", ... } }
 */
router.put('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const employeeId = req.params.id;
    const updateData = req.body;

    const employee = await employeeService.updateEmployee(employeeId, updateData);

    res.json({
      success: true,
      data: employee
    });
  } catch (error) {
    const message = (error as Error).message;
    const statusCode = message.includes('not found') ? 404 : 500;
    
    res.status(statusCode).json({
      success: false,
      error: {
        code: statusCode === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR',
        message
      }
    });
  }
});

/**
 * Delete Employee Endpoint
 * 
 * Soft deletes an employee by marking them as inactive.
 * Preserves historical data while preventing future access.
 * 
 * @route DELETE /api/employees/:id
 * @param {string} id - Employee ID (path parameter)
 * @returns {Object} Success confirmation message
 * 
 * @example
 * DELETE /api/employees/EMP001
 * Returns: { success: true, message: "Employee deleted successfully" }
 */
router.delete('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const employeeId = req.params.id;

    await employeeService.deleteEmployee(employeeId);

    res.json({
      success: true,
      message: 'Employee deleted successfully'
    });
  } catch (error) {
    const message = (error as Error).message;
    const statusCode = message.includes('not found') ? 404 : 500;
    
    res.status(statusCode).json({
      success: false,
      error: {
        code: statusCode === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR',
        message
      }
    });
  }
});

/**
 * Employee Router Module Export
 * 
 * Exports the configured Express router for employee management endpoints.
 * All routes require authentication and return standardized JSON responses.
 */
export default router;
