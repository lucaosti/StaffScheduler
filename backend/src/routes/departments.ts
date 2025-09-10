import { Router } from 'express';
import { Pool } from 'mysql2/promise';
import { DepartmentService } from '../services/DepartmentService';
import { UserService } from '../services/UserService';
import { authenticate } from '../middleware/auth';
import { CreateDepartmentRequest, UpdateDepartmentRequest } from '../types';

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
        // Admin sees all departments
        departments = await departmentService.getAllDepartments();
      } else {
        // Managers see only their departments
        departments = await departmentService.getDepartmentsForUser(user.id);
      }

      res.json({
        success: true,
        data: departments
      });
    } catch (error) {
      console.error('Get departments error:', error);
      res.status(500).json({
        success: false,
        error: { message: 'Failed to retrieve departments' }
      });
    }
  });

  // Get single department
  router.get('/:id', authenticate, async (req, res) => {
    try {
      const user = (req as any).user;
      const departmentId = parseInt(req.params.id);

      // Check permissions
      if (user.role !== 'admin') {
        const userDepartments = await departmentService.getDepartmentsForUser(user.id);
        const hasAccess = userDepartments.some(d => d.id === departmentId);
        
        if (!hasAccess) {
          return res.status(403).json({
            success: false,
            error: { message: 'Insufficient permissions' }
          });
        }
      }

      const department = await departmentService.getDepartmentById(departmentId);
      if (!department) {
        return res.status(404).json({
          success: false,
          error: { message: 'Department not found' }
        });
      }

      res.json({
        success: true,
        data: department
      });
    } catch (error) {
      console.error('Get department error:', error);
      res.status(500).json({
        success: false,
        error: { message: 'Failed to retrieve department' }
      });
    }
  });

  // Create new department
  router.post('/', authenticate, async (req, res) => {
    try {
      const user = (req as any).user;
      
      // Only admin and managers can create departments
      if (!['admin', 'manager'].includes(user.role)) {
        return res.status(403).json({
          success: false,
          error: { message: 'Insufficient permissions' }
        });
      }

      const departmentData: CreateDepartmentRequest = req.body;

      // Validate required fields
      if (!departmentData.name) {
        return res.status(400).json({
          success: false,
          error: { message: 'Department name is required' }
        });
      }

      // Validate manager exists if specified
      if (departmentData.managerId) {
        const manager = await userService.getUserById(departmentData.managerId);
        if (!manager) {
          return res.status(400).json({
            success: false,
            error: { message: 'Specified manager not found' }
          });
        }

        if (!['manager', 'department_manager'].includes(manager.role)) {
          return res.status(400).json({
            success: false,
            error: { message: 'Specified user cannot be a department manager' }
          });
        }
      }

      const createdDepartment = await departmentService.createDepartment(departmentData);

      res.status(201).json({
        success: true,
        data: createdDepartment
      });
    } catch (error) {
      console.error('Create department error:', error);
      res.status(500).json({
        success: false,
        error: { message: 'Failed to create department' }
      });
    }
  });

  // Update department
  router.put('/:id', authenticate, async (req, res) => {
    try {
      const user = (req as any).user;
      const departmentId = parseInt(req.params.id);
      const departmentData: UpdateDepartmentRequest = req.body;

      // Check permissions
      if (user.role === 'admin') {
        // Admin can update any department
      } else if (user.role === 'manager') {
        // Managers can update departments they manage
        const userDepartments = await departmentService.getDepartmentsForUser(user.id);
        const canManage = userDepartments.some(d => d.id === departmentId && d.isManager);
        
        if (!canManage) {
          return res.status(403).json({
            success: false,
            error: { message: 'Insufficient permissions' }
          });
        }
      } else {
        return res.status(403).json({
          success: false,
          error: { message: 'Insufficient permissions' }
        });
      }

      // Validate manager exists if specified
      if (departmentData.managerId) {
        const manager = await userService.getUserById(departmentData.managerId);
        if (!manager) {
          return res.status(400).json({
            success: false,
            error: { message: 'Specified manager not found' }
          });
        }

        if (!['manager', 'department_manager'].includes(manager.role)) {
          return res.status(400).json({
            success: false,
            error: { message: 'Specified user cannot be a department manager' }
          });
        }
      }

      const updatedDepartment = await departmentService.updateDepartment(departmentId, departmentData);

      res.json({
        success: true,
        data: updatedDepartment
      });
    } catch (error) {
      console.error('Update department error:', error);
      res.status(500).json({
        success: false,
        error: { message: 'Failed to update department' }
      });
    }
  });

  // Delete department
  router.delete('/:id', authenticate, async (req, res) => {
    try {
      const user = (req as any).user;
      const departmentId = parseInt(req.params.id);

      // Only admin can delete departments
      if (user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: { message: 'Only administrators can delete departments' }
        });
      }

      await departmentService.deleteDepartment(departmentId);

      res.json({
        success: true,
        data: { message: 'Department deleted successfully' }
      });
    } catch (error) {
      console.error('Delete department error:', error);
      
      if ((error as Error).message.includes('Cannot delete department with active users')) {
        return res.status(400).json({
          success: false,
          error: { message: (error as Error).message }
        });
      }

      res.status(500).json({
        success: false,
        error: { message: 'Failed to delete department' }
      });
    }
  });

  // Add user to department
  router.post('/:id/users', authenticate, async (req, res) => {
    try {
      const user = (req as any).user;
      const departmentId = parseInt(req.params.id);
      const { userId, isManager } = req.body;

      // Check permissions
      if (user.role === 'admin') {
        // Admin can add users to any department
      } else if (['manager', 'department_manager'].includes(user.role)) {
        // Managers can add users to departments they manage
        const userDepartments = await departmentService.getDepartmentsForUser(user.id);
        const canManage = userDepartments.some(d => d.id === departmentId && d.isManager);
        
        if (!canManage) {
          return res.status(403).json({
            success: false,
            error: { message: 'Insufficient permissions' }
          });
        }
      } else {
        return res.status(403).json({
          success: false,
          error: { message: 'Insufficient permissions' }
        });
      }

      // Validate user exists
      const targetUser = await userService.getUserById(userId);
      if (!targetUser) {
        return res.status(400).json({
          success: false,
          error: { message: 'User not found' }
        });
      }

      // Validate department exists
      const department = await departmentService.getDepartmentById(departmentId);
      if (!department) {
        return res.status(404).json({
          success: false,
          error: { message: 'Department not found' }
        });
      }

      await departmentService.addUserToDepartment(userId, departmentId, isManager);

      res.json({
        success: true,
        data: { message: 'User added to department successfully' }
      });
    } catch (error) {
      console.error('Add user to department error:', error);
      res.status(500).json({
        success: false,
        error: { message: 'Failed to add user to department' }
      });
    }
  });

  // Remove user from department
  router.delete('/:id/users/:userId', authenticate, async (req, res) => {
    try {
      const user = (req as any).user;
      const departmentId = parseInt(req.params.id);
      const targetUserId = parseInt(req.params.userId);

      // Check permissions
      if (user.role === 'admin') {
        // Admin can remove users from any department
      } else if (['manager', 'department_manager'].includes(user.role)) {
        // Managers can remove users from departments they manage
        const userDepartments = await departmentService.getDepartmentsForUser(user.id);
        const canManage = userDepartments.some(d => d.id === departmentId && d.isManager);
        
        if (!canManage) {
          return res.status(403).json({
            success: false,
            error: { message: 'Insufficient permissions' }
          });
        }
      } else {
        return res.status(403).json({
          success: false,
          error: { message: 'Insufficient permissions' }
        });
      }

      await departmentService.removeUserFromDepartment(targetUserId, departmentId);

      res.json({
        success: true,
        data: { message: 'User removed from department successfully' }
      });
    } catch (error) {
      console.error('Remove user from department error:', error);
      res.status(500).json({
        success: false,
        error: { message: 'Failed to remove user from department' }
      });
    }
  });

  // Get department statistics
  router.get('/:id/stats', authenticate, async (req, res) => {
    try {
      const user = (req as any).user;
      const departmentId = parseInt(req.params.id);

      // Check permissions
      if (user.role !== 'admin') {
        const userDepartments = await departmentService.getDepartmentsForUser(user.id);
        const hasAccess = userDepartments.some(d => d.id === departmentId);
        
        if (!hasAccess) {
          return res.status(403).json({
            success: false,
            error: { message: 'Insufficient permissions' }
          });
        }
      }

      const stats = await departmentService.getDepartmentStats(departmentId);

      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      console.error('Get department stats error:', error);
      res.status(500).json({
        success: false,
        error: { message: 'Failed to retrieve department statistics' }
      });
    }
  });

  return router;
};
