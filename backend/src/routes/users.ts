import { Router } from 'express';
import { Pool } from 'mysql2/promise';
import { UserService } from '../services/UserService';
import { authenticate } from '../middleware/auth';
import { CreateUserRequest, UpdateUserRequest, User } from '../types';

export const createUsersRouter = (pool: Pool) => {
  const router = Router();
  const userService = new UserService(pool);

  // Get all users (with role-based filtering)
  router.get('/', authenticate, async (req, res) => {
    try {
      const user = (req as any).user;
      const { search, department, role } = req.query;

      let users;
      if (user.role === 'admin') {
        // Admin sees all users
        users = await userService.getAllUsers({
          search: search as string,
          departmentId: department ? parseInt(department as string) : undefined,
          role: role as string
        });
      } else {
        // Managers see only their department users
        users = await userService.getUsersForManager(user.id, user.role);
        
        // Apply filters
        if (search) {
          const searchTerm = (search as string).toLowerCase();
          users = users.filter((u: User) => 
            u.firstName.toLowerCase().includes(searchTerm) ||
            u.lastName.toLowerCase().includes(searchTerm) ||
            u.email.toLowerCase().includes(searchTerm) ||
            (u.employeeId && u.employeeId.toLowerCase().includes(searchTerm))
          );
        }
        
        if (department) {
          users = users.filter((u: User) => 
            u.departments?.some((d: any) => d.departmentId === parseInt(department as string))
          );
        }
        
        if (role) {
          users = users.filter((u: User) => u.role === role);
        }
      }

      res.json({
        success: true,
        data: users
      });
    } catch (error) {
      console.error('Get users error:', error);
      res.status(500).json({
        success: false,
        error: { message: 'Failed to retrieve users' }
      });
    }
  });

  // Create new user
  router.post('/', authenticate, async (req, res) => {
    try {
      const user = (req as any).user;
      
      // Check permissions - only admin and managers can create users
      if (!['admin', 'manager'].includes(user.role)) {
        return res.status(403).json({
          success: false,
          error: { message: 'Insufficient permissions' }
        });
      }

      const userData: CreateUserRequest = req.body;

      // Validate required fields
      if (!userData.email || !userData.password || !userData.firstName || !userData.lastName || !userData.role) {
        return res.status(400).json({
          success: false,
          error: { message: 'Missing required fields' }
        });
      }

      const createdUser = await userService.createUser(userData);

      res.status(201).json({
        success: true,
        data: createdUser
      });
    } catch (error) {
      console.error('Create user error:', error);
      
      if ((error as any).code === 'ER_DUP_ENTRY') {
        return res.status(400).json({
          success: false,
          error: { message: 'Email or employee ID already exists' }
        });
      }

      res.status(500).json({
        success: false,
        error: { message: 'Failed to create user' }
      });
    }
  });

  // Get user by ID
  router.get('/:id', authenticate, async (req, res) => {
    try {
      const user = (req as any).user;
      const userId = parseInt(req.params.id);

      if (!userId) {
        return res.status(400).json({
          success: false,
          error: { message: 'Invalid user ID' }
        });
      }

      const targetUser = await userService.getUserById(userId);
      
      if (!targetUser) {
        return res.status(404).json({
          success: false,
          error: { message: 'User not found' }
        });
      }

      // Check permissions - users can only see themselves unless they're admin/manager
      if (user.role === 'employee' && user.id !== userId) {
        return res.status(403).json({
          success: false,
          error: { message: 'Insufficient permissions' }
        });
      }

      res.json({
        success: true,
        data: targetUser
      });
    } catch (error) {
      console.error('Get user error:', error);
      res.status(500).json({
        success: false,
        error: { message: 'Failed to retrieve user' }
      });
    }
  });

  // Update user
  router.put('/:id', authenticate, async (req, res) => {
    try {
      const user = (req as any).user;
      const userId = parseInt(req.params.id);

      if (!userId) {
        return res.status(400).json({
          success: false,
          error: { message: 'Invalid user ID' }
        });
      }

      // Check permissions
      if (user.role === 'employee' && user.id !== userId) {
        return res.status(403).json({
          success: false,
          error: { message: 'Insufficient permissions' }
        });
      }

      const updateData: UpdateUserRequest = req.body;
      
      // Employees can only update certain fields
      if (user.role === 'employee') {
        const allowedFields = ['firstName', 'lastName', 'phone'];
        const submittedFields = Object.keys(updateData);
        const invalidFields = submittedFields.filter(field => !allowedFields.includes(field));
        
        if (invalidFields.length > 0) {
          return res.status(403).json({
            success: false,
            error: { message: `Employees cannot update: ${invalidFields.join(', ')}` }
          });
        }
      }

      const updatedUser = await userService.updateUser(userId, updateData);
      
      if (!updatedUser) {
        return res.status(404).json({
          success: false,
          error: { message: 'User not found' }
        });
      }

      res.json({
        success: true,
        data: updatedUser
      });
    } catch (error) {
      console.error('Update user error:', error);
      
      if ((error as any).code === 'ER_DUP_ENTRY') {
        return res.status(400).json({
          success: false,
          error: { message: 'Email or employee ID already exists' }
        });
      }

      res.status(500).json({
        success: false,
        error: { message: 'Failed to update user' }
      });
    }
  });

  // Delete user
  router.delete('/:id', authenticate, async (req, res) => {
    try {
      const user = (req as any).user;
      const userId = parseInt(req.params.id);

      if (!userId) {
        return res.status(400).json({
          success: false,
          error: { message: 'Invalid user ID' }
        });
      }

      // Check permissions - only admin and managers can delete users
      if (!['admin', 'manager'].includes(user.role)) {
        return res.status(403).json({
          success: false,
          error: { message: 'Insufficient permissions' }
        });
      }

      // Users cannot delete themselves
      if (user.id === userId) {
        return res.status(400).json({
          success: false,
          error: { message: 'Cannot delete yourself' }
        });
      }

      try {
        await userService.deleteUser(userId);
        
        res.json({
          success: true,
          message: 'User deleted successfully'
        });
      } catch (deleteError: any) {
        if (deleteError.message === 'User not found') {
          return res.status(404).json({
            success: false,
            error: { message: 'User not found' }
          });
        }
        throw deleteError;
      }
    } catch (error) {
      console.error('Delete user error:', error);
      res.status(500).json({
        success: false,
        error: { message: 'Failed to delete user' }
      });
    }
  });

  return router;
};
