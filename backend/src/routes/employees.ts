import { Router, Request, Response } from 'express';
import { Pool } from 'mysql2/promise';
import { EmployeeService } from '../services/EmployeeService';
import { authenticate, requireRole } from '../middleware/auth';
import { logger } from '../config/logger';

export const createEmployeesRouter = (pool: Pool) => {
  const router = Router();
  const employeeService = new EmployeeService(pool);

// Get all employees
router.get('/', authenticate, async (_req: Request, res: Response) => {
  try {
    const employees = await employeeService.getAllEmployees();
    res.json({ success: true, data: employees });
  } catch (error) {
    logger.error('Error fetching employees:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch employees' }
    });
  }
});

// Get employee by ID
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Invalid employee ID' }
      });
    }

    const employee = await employeeService.getEmployeeById(id);
    if (!employee) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Employee not found' }
      });
    }

    res.json({ success: true, data: employee });
  } catch (error) {
    logger.error('Error fetching employee:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch employee' }
    });
  }
});

// Create new employee
router.post('/', authenticate, requireRole(['admin', 'manager']), async (req: Request, res: Response) => {
  try {
    const employee = await employeeService.createEmployee(req.body);

    res.status(201).json({
      success: true,
      data: employee,
      message: 'Employee created successfully'
    });
  } catch (error) {
    logger.error('Error creating employee:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to create employee' }
    });
  }
});

// Update employee
router.put('/:id', authenticate, requireRole(['admin', 'manager']), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Invalid employee ID' }
      });
    }

    const employee = await employeeService.updateEmployee(id, req.body);
    res.json({
      success: true,
      data: employee,
      message: 'Employee updated successfully'
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update employee';
    if (message.toLowerCase().includes('not found')) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message } });
    }
    logger.error('Error updating employee:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to update employee' }
    });
  }
});

// Delete employee (soft delete)
router.delete('/:id', authenticate, requireRole(['admin', 'manager']), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Invalid employee ID' }
      });
    }

    await employeeService.deleteEmployee(id);
    res.json({
      success: true,
      message: 'Employee deleted successfully'
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete employee';
    if (message.toLowerCase().includes('not found')) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message } });
    }
    logger.error('Error deleting employee:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to delete employee' }
    });
  }
});

// Get employees by department
router.get('/department/:departmentId', authenticate, async (req: Request, res: Response) => {
  try {
    const departmentId = parseInt(req.params.departmentId);
    if (isNaN(departmentId)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Invalid department ID' }
      });
    }

    const employees = await employeeService.getEmployeesByDepartment(departmentId);
    res.json({ success: true, data: employees });
  } catch (error) {
    logger.error('Error fetching employees by department:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch employees by department' }
    });
  }
});

// Get employee skills
router.get('/:id/skills', authenticate, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Invalid employee ID' }
      });
    }

    const skills = await employeeService.getEmployeeSkills(id);
    res.json({ success: true, data: skills });
  } catch (error) {
    logger.error('Error fetching employee skills:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch employee skills' }
    });
  }
});

// Add skill to employee
router.post('/:id/skills', authenticate, requireRole(['admin', 'manager']), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { skillId, proficiencyLevel } = req.body;

    if (isNaN(id) || !skillId || proficiencyLevel === undefined) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Invalid parameters' }
      });
    }

    await employeeService.addEmployeeSkill(id, skillId, proficiencyLevel);

    res.json({
      success: true,
      message: 'Skill added to employee successfully'
    });
  } catch (error) {
    logger.error('Error adding employee skill:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to add skill to employee' }
    });
  }
});

// Remove skill from employee
router.delete('/:id/skills/:skillId', authenticate, requireRole(['admin', 'manager']), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const skillId = parseInt(req.params.skillId);

    if (isNaN(id) || isNaN(skillId)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Invalid parameters' }
      });
    }

    await employeeService.removeEmployeeSkill(id, skillId);

    res.json({
      success: true,
      message: 'Skill removed from employee successfully'
    });
  } catch (error) {
    logger.error('Error removing employee skill:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to remove skill from employee' }
    });
  }
});

  return router;
};

