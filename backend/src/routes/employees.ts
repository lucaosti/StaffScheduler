import { Router, Request, Response } from 'express';
import { Pool } from 'mysql2/promise';
import { EmployeeService } from '../services/EmployeeService';
import { authenticate, requirePermission } from '../middleware/auth';
import { parsePagination, sendPaginated } from '../middleware/pagination';
import { validateParams } from '../middleware/validation';
import { idParam, departmentIdParam, idAndSkillIdParam } from '../schemas';
import { logger } from '../config/logger';

export const createEmployeesRouter = (pool: Pool) => {
  const router = Router();
  const employeeService = new EmployeeService(pool);

// Get all employees
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const scope = req.user?.allowedOrgUnitIds;
    const { search, department } = req.query;
    const filters: { orgUnitIds?: number[]; search?: string; departmentId?: number; departmentName?: string } = {};
    if (scope !== null && scope !== undefined) filters.orgUnitIds = scope;
    if (typeof search === 'string' && search.length > 0) filters.search = search;
    if (typeof department === 'string' && department.length > 0) {
      const deptId = parseInt(department, 10);
      if (!isNaN(deptId) && deptId > 0) {
        filters.departmentId = deptId;
      } else {
        filters.departmentName = department;
      }
    }
    const activeFilters = Object.keys(filters).length > 0 ? filters : undefined;
    const pagination = parsePagination(req);
    if (pagination) {
      const [total, employees] = await Promise.all([
        employeeService.countEmployees(activeFilters),
        employeeService.getAllEmployees(activeFilters, { limit: pagination.pageSize, offset: pagination.offset }),
      ]);
      return sendPaginated(res, employees, total, pagination);
    }
    const employees = await employeeService.getAllEmployees(activeFilters);
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
router.get('/:id', authenticate, validateParams(idParam), async (_req: Request, res: Response) => {
  try {
    const { id } = res.locals.params;

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
router.post('/', authenticate, requirePermission('employee.manage'), async (req: Request, res: Response) => {
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
router.put('/:id', authenticate, requirePermission('employee.manage'), validateParams(idParam), async (req: Request, res: Response) => {
  try {
    const { id } = res.locals.params;

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
router.delete('/:id', authenticate, requirePermission('employee.manage'), validateParams(idParam), async (req: Request, res: Response) => {
  try {
    const { id } = res.locals.params;

    await employeeService.deleteEmployee(id, req.user?.id ?? null);
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
router.get('/department/:departmentId', authenticate, validateParams(departmentIdParam), async (_req: Request, res: Response) => {
  try {
    const { departmentId } = res.locals.params;

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
router.get('/:id/skills', authenticate, validateParams(idParam), async (_req: Request, res: Response) => {
  try {
    const { id } = res.locals.params;

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
router.post('/:id/skills', authenticate, requirePermission('employee.manage'), validateParams(idParam), async (req: Request, res: Response) => {
  try {
    const { id } = res.locals.params;
    const { skillId, proficiencyLevel } = req.body;

    if (!skillId || proficiencyLevel === undefined) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'skillId and proficiencyLevel are required' }
      });
    }

    await employeeService.addEmployeeSkill(id, skillId, proficiencyLevel);

    res.status(201).json({
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
router.delete('/:id/skills/:skillId', authenticate, requirePermission('employee.manage'), validateParams(idAndSkillIdParam), async (_req: Request, res: Response) => {
  try {
    const { id, skillId } = res.locals.params;

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
