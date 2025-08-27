import { Router, Request, Response } from 'express';
import { employeeService } from '../services/EmployeeService';
import { authenticate } from '../middleware/auth';

const router = Router();

// Get all employees
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

// Get employee by ID
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

// Create new employee
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

// Update employee
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

// Delete employee
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

export default router;
