import { Router, Request, Response } from 'express';
import { Pool } from 'mysql2/promise';
import { EmployeeService } from '../services/EmployeeService';
import { authenticate, requirePermission } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { parsePagination, sendPaginated } from '../middleware/pagination';
import { validateParams, validateBody, validateQuery } from '../middleware/validation';
import { idParam, departmentIdParam, idAndSkillIdParam, createUserBody, updateUserBody, addEmployeeSkillBody, employeeListQuery } from '../schemas';

export const createEmployeesRouter = (pool: Pool) => {
  const router = Router();
  const employeeService = new EmployeeService(pool);

// Get all employees
router.get('/', authenticate, requirePermission('employee.read'), validateQuery(employeeListQuery), asyncHandler(async (req: Request, res: Response) => {
  const scope = req.user?.allowedOrgUnitIds;
  const { search, department, isActive } = res.locals.query;
  const filters: { orgUnitIds?: number[]; search?: string; departmentId?: number; departmentName?: string; isActive?: boolean } = {};
  if (scope !== null && scope !== undefined) filters.orgUnitIds = scope;
  if (isActive !== undefined) filters.isActive = isActive;
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
}));

// Get employee by ID
router.get('/:id', authenticate, requirePermission('employee.read'), validateParams(idParam), asyncHandler(async (_req: Request, res: Response) => {
  const { id } = res.locals.params;

  const employee = await employeeService.getEmployeeById(id);
  if (!employee) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Employee not found' }
    });
  }

  res.json({ success: true, data: employee });
}));

// Create new employee
router.post('/', authenticate, requirePermission('employee.manage'), validateBody(createUserBody), asyncHandler(async (_req: Request, res: Response) => {
  const employee = await employeeService.createEmployee(res.locals.body);

  res.status(201).json({
    success: true,
    data: employee,
    message: 'Employee created successfully'
  });
}));

// Update employee
router.put('/:id', authenticate, requirePermission('employee.manage'), validateParams(idParam), validateBody(updateUserBody), asyncHandler(async (_req: Request, res: Response) => {
  const { id } = res.locals.params;

  const employee = await employeeService.updateEmployee(id, res.locals.body);
  res.json({
    success: true,
    data: employee,
    message: 'Employee updated successfully'
  });
}));

// Delete employee (soft delete)
router.delete('/:id', authenticate, requirePermission('employee.manage'), validateParams(idParam), asyncHandler(async (req: Request, res: Response) => {
  const { id } = res.locals.params;

  await employeeService.deleteEmployee(id, req.user?.id ?? null);
  res.json({
    success: true,
    message: 'Employee deleted successfully'
  });
}));

// Get employees by department
router.get('/department/:departmentId', authenticate, requirePermission('employee.read'), validateParams(departmentIdParam), asyncHandler(async (_req: Request, res: Response) => {
  const { departmentId } = res.locals.params;

  const employees = await employeeService.getEmployeesByDepartment(departmentId);
  res.json({ success: true, data: employees });
}));

// Get employee skills
router.get('/:id/skills', authenticate, requirePermission('employee.read'), validateParams(idParam), asyncHandler(async (_req: Request, res: Response) => {
  const { id } = res.locals.params;

  const skills = await employeeService.getEmployeeSkills(id);
  res.json({ success: true, data: skills });
}));

// Add skill to employee
router.post('/:id/skills', authenticate, requirePermission('employee.manage'), validateParams(idParam), validateBody(addEmployeeSkillBody), asyncHandler(async (_req: Request, res: Response) => {
  const { id } = res.locals.params;
  const { skillId, proficiencyLevel } = res.locals.body;

  await employeeService.addEmployeeSkill(id, skillId, proficiencyLevel);

  res.status(201).json({
    success: true,
    message: 'Skill added to employee successfully'
  });
}));

// Remove skill from employee
router.delete('/:id/skills/:skillId', authenticate, requirePermission('employee.manage'), validateParams(idAndSkillIdParam), asyncHandler(async (_req: Request, res: Response) => {
  const { id, skillId } = res.locals.params;

  await employeeService.removeEmployeeSkill(id, skillId);

  res.json({
    success: true,
    message: 'Skill removed from employee successfully'
  });
}));

  return router;
};
