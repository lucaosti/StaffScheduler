import { Router } from 'express';
import { Pool } from 'mysql2/promise';
import { DepartmentService } from '../services/DepartmentService';
import { UserService } from '../services/UserService';
import { authenticate } from '../middleware/auth';
import { CreateDepartmentRequest, UpdateDepartmentRequest } from '../types';
import { logger } from '../config/logger';

export const createDepartmentsRouter = (pool: Pool) => {
  const router = Router();
  const departmentService = new DepartmentService(pool);
  const userService = new UserService(pool);

  // Get all departments
  router.get('/', authenticate, async (req, res) => {
    try {
      const user = (req as any).user;

      let departments;
      if (user.role === 'admin') {
        departments = await departmentService.getAllDepartments();
      } else {
        departments = await departmentService.getDepartmentsForUser(user.id);
      }

      res.json({ success: true, data: departments });
    } catch (error) {
      logger.error('Get departments error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve departments' }
      });
    }
  });

  // Get single department
  router.get('/:id', authenticate, async (req, res) => {
    try {
      const user = (req as any).user;
      const departmentId = parseInt(req.params.id);

      if (user.role !== 'admin') {
        const userDepartments = await departmentService.getDepartmentsForUser(user.id);
        const hasAccess = userDepartments.some((d: any) => d.id === departmentId);

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
    } catch (error) {
      logger.error('Get department error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve department' }
      });
    }
  });

  // Create new department
  router.post('/', authenticate, async (req, res) => {
    try {
      const user = (req as any).user;

      if (!['admin', 'manager'].includes(user.role)) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Insufficient permissions' }
        });
      }

      const departmentData: CreateDepartmentRequest = req.body;

      if (!departmentData.name) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Department name is required' }
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

        if (!['admin', 'manager'].includes(manager.role)) {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_INPUT', message: 'Specified user cannot be a department manager' }
          });
        }
      }

      const createdDepartment = await departmentService.createDepartment(departmentData);

      res.status(201).json({ success: true, data: createdDepartment });
    } catch (error) {
      logger.error('Create department error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to create department' }
      });
    }
  });

  // Update department
  router.put('/:id', authenticate, async (req, res) => {
    try {
      const user = (req as any).user;
      const departmentId = parseInt(req.params.id);
      const departmentData: UpdateDepartmentRequest = req.body;

      if (user.role === 'admin') {
        // Admin can update any department
      } else if (user.role === 'manager') {
        const userDepartments = await departmentService.getDepartmentsForUser(user.id);
        const canManage = userDepartments.some((d: any) => d.id === departmentId && d.managerId === user.id);

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

        if (!['admin', 'manager'].includes(manager.role)) {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_INPUT', message: 'Specified user cannot be a department manager' }
          });
        }
      }

      const updatedDepartment = await departmentService.updateDepartment(departmentId, departmentData);

      res.json({ success: true, data: updatedDepartment });
    } catch (error) {
      logger.error('Update department error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to update department' }
      });
    }
  });

  // Delete department
  router.delete('/:id', authenticate, async (req, res) => {
    try {
      const user = (req as any).user;
      const departmentId = parseInt(req.params.id);

      if (user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Only administrators can delete departments' }
        });
      }

      await departmentService.deleteDepartment(departmentId);

      res.json({ success: true, data: { message: 'Department deleted successfully' } });
    } catch (error) {
      logger.error('Delete department error:', error);

      if ((error as Error).message.includes('Cannot delete department with active users')) {
        return res.status(409).json({
          success: false,
          error: { code: 'CONFLICT', message: (error as Error).message }
        });
      }

      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to delete department' }
      });
    }
  });

  // Add user to department
  router.post('/:id/users', authenticate, async (req, res) => {
    try {
      const user = (req as any).user;
      const departmentId = parseInt(req.params.id);
      const { userId } = req.body;

      if (user.role === 'admin') {
        // Admin can add users to any department
      } else if (['admin', 'manager'].includes(user.role)) {
        const userDepartments = await departmentService.getDepartmentsForUser(user.id);
        const canManage = userDepartments.some((d: any) => d.id === departmentId && d.managerId === user.id);

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

      res.json({ success: true, data: { message: 'User added to department successfully' } });
    } catch (error) {
      logger.error('Add user to department error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to add user to department' }
      });
    }
  });

  // Remove user from department
  router.delete('/:id/users/:userId', authenticate, async (req, res) => {
    try {
      const user = (req as any).user;
      const departmentId = parseInt(req.params.id);
      const targetUserId = parseInt(req.params.userId);

      if (user.role === 'admin') {
        // Admin can remove users from any department
      } else if (['admin', 'manager'].includes(user.role)) {
        const userDepartments = await departmentService.getDepartmentsForUser(user.id);
        const canManage = userDepartments.some((d: any) => d.id === departmentId && d.managerId === user.id);

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
    } catch (error) {
      logger.error('Remove user from department error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to remove user from department' }
      });
    }
  });

  // Get department statistics
  router.get('/:id/stats', authenticate, async (req, res) => {
    try {
      const user = (req as any).user;
      const departmentId = parseInt(req.params.id);

      if (user.role !== 'admin') {
        const userDepartments = await departmentService.getDepartmentsForUser(user.id);
        const hasAccess = userDepartments.some((d: any) => d.id === departmentId);

        if (!hasAccess) {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Insufficient permissions' }
          });
        }
      }

      const stats = await departmentService.getDepartmentStatsByDepartment(departmentId);

      res.json({ success: true, data: stats });
    } catch (error) {
      logger.error('Get department stats error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve department statistics' }
      });
    }
  });

  return router;
};
