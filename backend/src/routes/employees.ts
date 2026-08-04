/**
 * Employee routes — `/api/employees`, plus per-employee skill management.
 *
 * WHY THERE IS NO EMPLOYEE ENTITY. `EmployeeService` delegates to
 * `UserService`, and these endpoints return `users` rows. There is no
 * `employees` table and never has been. The distinction is one of PERMISSION
 * and INTENT rather than of storage: `/api/users` is the administrative surface
 * gated on user management, while `/api/employees` is the workforce surface
 * gated on `employee.read` / `employee.manage`, which a scheduling manager
 * holds without being able to administer accounts.
 *
 * This mattered concretely: the OpenAPI spec once published an `Employee`
 * component with an `employeeNumber` field for an entity that does not exist.
 * It was deleted and `/employees` now `$ref`s `User`, which is what the
 * endpoint actually returns.
 *
 * WHY CREATION TAKES `createUserBody`. Creating an employee creates an account,
 * password included — there is no lighter-weight "employee without a login".
 * A UI form that omitted the password field therefore had every submission
 * rejected with a 400, invisibly, because the client-side type omitted it too.
 * The shared schema is the single declaration of what this endpoint accepts,
 * and the frontend now derives its payload type from it rather than mirroring
 * it by hand.
 *
 * @author Luca Ostinelli
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'mysql2/promise';
import { EmployeeService } from '../services/EmployeeService';
import { authenticate, requirePermission } from '../middleware/auth';
import { parsePagination, sendPaginated } from '../middleware/pagination';
import { validateParams, validateBody, validateQuery } from '../middleware/validation';
import { z } from 'zod';
import {
  EmployeeFieldPolicyService,
  assertPolicies,
  checkAgainstPolicies,
} from '../services/EmployeeFieldPolicyService';
import { AuditLogService } from '../services/AuditLogService';
import { ExportService } from '../services/ExportService';
import { employeeColumns } from '../services/exportColumns';
import { idParam, departmentIdParam, idAndSkillIdParam, createUserBody, updateUserBody, addEmployeeSkillBody, employeeListQuery, batchCreateEmployeesBody } from '../schemas';
import { runBatch } from '../utils/batch';

export const createEmployeesRouter = (pool: Pool) => {
  const router = Router();
  const employeeService = new EmployeeService(pool);
  const exporter = new ExportService(new AuditLogService(pool));
  const fieldPolicies = new EmployeeFieldPolicyService(pool);

/**
 * The per-organization field rules, applied AFTER the Zod schema.
 *
 * The two answer different questions and must stay separate: Zod says what the
 * API accepts and is the published contract, while a policy says what this
 * organization requires and is configuration. Folding the second into the first
 * would publish one customer's rules in the OpenAPI document as though they
 * were the API's.
 *
 * The organization is the ACTOR's, not a value from the payload — otherwise a
 * caller could pick which organization's rules to be judged by, which is the
 * whole ruleset defeated by one field.
 */
const enforceFieldPolicy = async (
  req: Request,
  payload: Record<string, unknown>,
  isPartial: boolean
): Promise<void> => {
  const policies = await fieldPolicies.listForOrganization(req.user?.organizationName ?? null);
  if (policies.length === 0) return;
  assertPolicies(
    checkAgainstPolicies(payload, policies, {
      isPartial,
      callerPermissions: req.user?.permissions ?? [],
    })
  );
};


/**
 * The listing filters, including the caller's org-unit scope.
 *
 * Extracted so the export below is filtered IDENTICALLY to the list. Rebuilding
 * this by hand in the export handler would make it a second authorization path
 * — and the one that decides whether someone sees employees outside their own
 * subtree, which is precisely the decision that must not exist twice.
 */
const listFilters = (req: Request, query: z.infer<typeof employeeListQuery>) => {
  const scope = req.user?.allowedOrgUnitIds;
  const { search, department, isActive } = query;
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
  return Object.keys(filters).length > 0 ? filters : undefined;
};

router.get('/', authenticate, requirePermission('employee.read'), validateQuery(employeeListQuery), async (req: Request, res: Response) => {
  const activeFilters = listFilters(req, res.locals.query);
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
});

// `/export` is declared before `/:id` so Express does not read "export" as an id.
router.get('/export', authenticate, requirePermission('employee.read'), validateQuery(employeeListQuery), async (req: Request, res: Response) => {
  const filters = listFilters(req, res.locals.query);
  // Unpaginated on purpose: a file is the one place where "all of it" is the
  // point, and the caller's scope still bounds it.
  const employees = await employeeService.getAllEmployees(filters);
  await exporter.sendCsv(res, {
    actorId: req.user?.id ?? null,
    dataset: 'employees',
    rows: employees,
    columns: employeeColumns,
    filters: filters ?? {},
  });
});

router.get('/:id', authenticate, requirePermission('employee.read'), validateParams(idParam), async (_req: Request, res: Response) => {
  const { id } = res.locals.params;

  const employee = await employeeService.getEmployeeById(id);
  if (!employee) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Employee not found' }
    });
  }

  res.json({ success: true, data: employee });
});

router.post('/', authenticate, requirePermission('employee.manage'), validateBody(createUserBody), async (req: Request, res: Response) => {
  await enforceFieldPolicy(req, res.locals.body, false);
  const employee = await employeeService.createEmployee(res.locals.body);

  res.status(201).json({
    success: true,
    data: employee,
    message: 'Employee created successfully'
  });
});

// One outcome per row (#316) — a high-volume integration needs to know which
// of 200 rows failed and why, not just that the batch as a whole did or didn't
// go through. Field policy is enforced per row too: it depends on the actor,
// not the batch, so one row failing it must not fail its neighbors.
router.post('/batch', authenticate, requirePermission('employee.manage'), validateBody(batchCreateEmployeesBody), async (req: Request, res: Response) => {
  const { employees } = res.locals.body as z.infer<typeof batchCreateEmployeesBody>;
  const result = await runBatch(employees, async (employeeData) => {
    await enforceFieldPolicy(req, employeeData, false);
    return employeeService.createEmployee(employeeData);
  });

  res.status(207).json({
    success: true,
    data: result,
    message: `${result.succeeded} of ${result.succeeded + result.failed} employees created successfully`
  });
});

router.put('/:id', authenticate, requirePermission('employee.manage'), validateParams(idParam), validateBody(updateUserBody), async (req: Request, res: Response) => {
  const { id } = res.locals.params;

  // Partial: a field absent from an update is not being cleared, so a
  // required-field check on it would make every partial update of an incomplete
  // record impossible — and that is the record most in need of updating.
  await enforceFieldPolicy(req, res.locals.body, true);
  const employee = await employeeService.updateEmployee(id, res.locals.body);
  res.json({
    success: true,
    data: employee,
    message: 'Employee updated successfully'
  });
});

router.delete('/:id', authenticate, requirePermission('employee.manage'), validateParams(idParam), async (req: Request, res: Response) => {
  const { id } = res.locals.params;

  await employeeService.deleteEmployee(id, req.user?.id ?? null);
  res.json({
    success: true,
    message: 'Employee deleted successfully'
  });
});

router.get('/department/:departmentId', authenticate, requirePermission('employee.read'), validateParams(departmentIdParam), async (_req: Request, res: Response) => {
  const { departmentId } = res.locals.params;

  const employees = await employeeService.getEmployeesByDepartment(departmentId);
  res.json({ success: true, data: employees });
});

router.get('/:id/skills', authenticate, requirePermission('employee.read'), validateParams(idParam), async (_req: Request, res: Response) => {
  const { id } = res.locals.params;

  const skills = await employeeService.getEmployeeSkills(id);
  res.json({ success: true, data: skills });
});

router.post('/:id/skills', authenticate, requirePermission('employee.manage'), validateParams(idParam), validateBody(addEmployeeSkillBody), async (_req: Request, res: Response) => {
  const { id } = res.locals.params;
  const { skillId, proficiencyLevel } = res.locals.body;

  await employeeService.addEmployeeSkill(id, skillId, proficiencyLevel);

  res.status(201).json({
    success: true,
    message: 'Skill added to employee successfully'
  });
});

router.delete('/:id/skills/:skillId', authenticate, requirePermission('employee.manage'), validateParams(idAndSkillIdParam), async (_req: Request, res: Response) => {
  const { id, skillId } = res.locals.params;

  await employeeService.removeEmployeeSkill(id, skillId);

  res.json({
    success: true,
    message: 'Skill removed from employee successfully'
  });
});

  return router;
};
