import { Router } from 'express';
import { Pool } from 'mysql2/promise';
import { DepartmentService } from '../services/DepartmentService';
import { UserService } from '../services/UserService';
import { authenticate, userHasPermission } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateParams, validateBody } from '../middleware/validation';
import {
  idParam,
  idAndUserIdParam,
  createDepartmentBody,
  updateDepartmentBody,
  addUserToDepartmentBody,
} from '../schemas';
import { UpdateDepartmentRequest } from '../types';

export const createDepartmentsRouter = (pool: Pool) => {
  const router = Router();
  const departmentService = new DepartmentService(pool);
  const userService = new UserService(pool);

  // Get all departments
  router.get('/', authenticate, asyncHandler(async (req, res) => {
    const user = req.user!;

    let departments;
    if (userHasPermission(user, 'settings.manage')) {
      departments = await departmentService.getAllDepartments();
    } else {
      departments = await departmentService.getDepartmentsForUser(user.id);
    }

    res.json({ success: true, data: departments });
  }));

  // Get single department
  router.get('/:id', authenticate, validateParams(idParam), asyncHandler(async (req, res) => {
    const user = req.user!;
    const departmentId = res.locals.params.id;

    if (!userHasPermission(user, 'settings.manage')) {
      const userDepartments = await departmentService.getDepartmentsForUser(user.id);
      const hasAccess = userDepartments.some((d) => d.id === departmentId);

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Insufficient permissions' }
        });
      }
    }

    const department = await departmentService.getDepartmentById(departmentId);
    if (!department) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Department not found' }
      });
    }

    res.json({ success: true, data: department });
  }));

  // Create new department
  router.post('/', authenticate, validateBody(createDepartmentBody), asyncHandler(async (req, res) => {
    const user = req.user!;

    if (!userHasPermission(user, 'department.manage')) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Insufficient permissions' }
      });
    }

    const departmentData = res.locals.body;

    if (departmentData.managerId) {
      const manager = await userService.getUserById(departmentData.managerId);
      if (!manager) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Specified manager not found' }
        });
      }
    }

    const createdDepartment = await departmentService.createDepartment(departmentData);

    res.status(201).json({ success: true, data: createdDepartment });
  }));

  // Update department
  router.put('/:id', authenticate, validateParams(idParam), validateBody(updateDepartmentBody), asyncHandler(async (req, res) => {
    const user = req.user!;
    const departmentId = res.locals.params.id;
    const departmentData: UpdateDepartmentRequest = res.locals.body;

    if (userHasPermission(user, 'settings.manage')) {
      // Full administrators can update any department
    } else if (userHasPermission(user, 'department.manage')) {
      const userDepartments = await departmentService.getDepartmentsForUser(user.id);
      const canManage = userDepartments.some((d) => d.id === departmentId && d.managerId === user.id);

      if (!canManage) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Insufficient permissions' }
        });
      }
    } else {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Insufficient permissions' }
      });
    }

    if (departmentData.managerId) {
      const manager = await userService.getUserById(departmentData.managerId);
      if (!manager) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Specified manager not found' }
        });
      }
    }

    const updatedDepartment = await departmentService.updateDepartment(departmentId, departmentData);

    res.json({ success: true, data: updatedDepartment });
  }));

  // Delete department
  router.delete('/:id', authenticate, validateParams(idParam), asyncHandler(async (req, res) => {
    const user = req.user!;
    const departmentId = res.locals.params.id;

    if (!userHasPermission(user, 'settings.manage')) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Only administrators can delete departments' }
      });
    }

    await departmentService.deleteDepartment(departmentId);

    res.json({ success: true, data: { message: 'Department deleted successfully' } });
  }));

  // Add user to department
  router.post('/:id/users', authenticate, validateParams(idParam), validateBody(addUserToDepartmentBody), asyncHandler(async (req, res) => {
    const user = req.user!;
    const departmentId = res.locals.params.id;
    const { userId } = res.locals.body;

    if (userHasPermission(user, 'settings.manage')) {
      // Full administrators can add users to any department
    } else if (userHasPermission(user, 'department.manage')) {
      const userDepartments = await departmentService.getDepartmentsForUser(user.id);
      const canManage = userDepartments.some((d) => d.id === departmentId && d.managerId === user.id);

      if (!canManage) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Insufficient permissions' }
        });
      }
    } else {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Insufficient permissions' }
      });
    }

    const targetUser = await userService.getUserById(userId);
    if (!targetUser) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'User not found' }
      });
    }

    const department = await departmentService.getDepartmentById(departmentId);
    if (!department) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Department not found' }
      });
    }

    await departmentService.addUserToDepartment(departmentId, userId);

    res.status(201).json({ success: true, data: { message: 'User added to department successfully' } });
  }));

  // Remove user from department
  router.delete('/:id/users/:userId', authenticate, validateParams(idAndUserIdParam), asyncHandler(async (req, res) => {
    const user = req.user!;
    const departmentId = res.locals.params.id;
    const targetUserId = res.locals.params.userId;

    if (userHasPermission(user, 'settings.manage')) {
      // Full administrators can remove users from any department
    } else if (userHasPermission(user, 'department.manage')) {
      const userDepartments = await departmentService.getDepartmentsForUser(user.id);
      const canManage = userDepartments.some((d) => d.id === departmentId && d.managerId === user.id);

      if (!canManage) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Insufficient permissions' }
        });
      }
    } else {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Insufficient permissions' }
      });
    }

    await departmentService.removeUserFromDepartment(targetUserId, departmentId);

    res.json({ success: true, data: { message: 'User removed from department successfully' } });
  }));

  // Get department statistics
  router.get('/:id/stats', authenticate, validateParams(idParam), asyncHandler(async (req, res) => {
    const user = req.user!;
    const departmentId = res.locals.params.id;

    if (!userHasPermission(user, 'settings.manage')) {
      const userDepartments = await departmentService.getDepartmentsForUser(user.id);
      const hasAccess = userDepartments.some((d) => d.id === departmentId);

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Insufficient permissions' }
        });
      }
    }

    const stats = await departmentService.getDepartmentStatsByDepartment(departmentId);

    res.json({ success: true, data: stats });
  }));

  return router;
};
