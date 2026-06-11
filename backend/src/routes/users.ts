import { Router } from 'express';
import { Pool } from 'mysql2/promise';
import { UserService } from '../services/UserService';
import { RbacService } from '../services/RbacService';
import { authenticate, userHasPermission } from '../middleware/auth';
import { parsePagination, sendPaginated } from '../middleware/pagination';
import { validateParams, validateBody } from '../middleware/validation';
import { idParam, createUserBody, updateUserBody } from '../schemas';
import { UpdateUserRequest, User } from '../types';
import { logger } from '../config/logger';

export const createUsersRouter = (pool: Pool) => {
  const router = Router();
  const userService = new UserService(pool);
  const rbacService = new RbacService(pool);

  /**
   * Anti-privilege-escalation guard. An actor may only grant a role whose
   * permissions are a subset of their own — unless they hold `role.manage`,
   * which authorizes assigning any role. Returns an error message, or null
   * when the assignment is allowed.
   */
  const validateRoleAssignment = async (actor: User, roleIds?: number[]): Promise<string | null> => {
    if (!roleIds || roleIds.length === 0) return null;
    if (userHasPermission(actor, 'role.manage')) return null;
    const actorPerms = new Set(actor.permissions ?? []);
    for (const roleId of roleIds) {
      const role = await rbacService.getRoleById(roleId);
      if (!role) return `Role ${roleId} not found`;
      const escalates = (role.permissions ?? []).some((p) => !actorPerms.has(p));
      if (escalates) return 'You cannot assign a role with permissions you do not hold';
    }
    return null;
  };

  // Get all users (scoped by the caller's permissions)
  router.get('/', authenticate, async (req, res) => {
    try {
      const user = req.user as User;
      const { search, department, roleId } = req.query;

      const filters = {
        search: search as string | undefined,
        departmentId: department ? parseInt(department as string) : undefined,
        roleId: roleId ? parseInt(roleId as string) : undefined,
      };
      const pagination = parsePagination(req);

      if (userHasPermission(user, 'settings.manage')) {
        if (pagination) {
          const [total, users] = await Promise.all([
            userService.countUsers(filters),
            userService.getAllUsers(filters, { limit: pagination.pageSize, offset: pagination.offset }),
          ]);
          return sendPaginated(res, users, total, pagination);
        }
        const users = await userService.getAllUsers(filters);
        return res.json({ success: true, data: users });
      }

      // Manager path — scoped to departments managed by this user.
      const managerFilters = { search: filters.search, departmentId: filters.departmentId };
      if (pagination) {
        const [total, users] = await Promise.all([
          userService.countUsersForManager(user, managerFilters),
          userService.getUsersForManager(user, managerFilters, { limit: pagination.pageSize, offset: pagination.offset }),
        ]);
        return sendPaginated(res, users, total, pagination);
      }
      const users = await userService.getUsersForManager(user, managerFilters);
      res.json({ success: true, data: users });
    } catch (error) {
      logger.error('Get users error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve users' }
      });
    }
  });

  // Create new user
  router.post('/', authenticate, validateBody(createUserBody), async (req, res) => {
    try {
      const user = req.user as User;

      if (!userHasPermission(user, 'user.manage')) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Insufficient permissions' }
        });
      }

      const userData = res.locals.body;

      // Prevent privilege escalation through role assignment.
      const roleError = await validateRoleAssignment(user, userData.roleIds);
      if (roleError) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: roleError }
        });
      }

      const createdUser = await userService.createUser(userData, user.id);

      res.status(201).json({ success: true, data: createdUser });
    } catch (error) {
      logger.error('Create user error:', error);

      if ((error as any).code === 'ER_DUP_ENTRY') {
        return res.status(409).json({
          success: false,
          error: { code: 'CONFLICT', message: 'Email or employee ID already exists' }
        });
      }

      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to create user' }
      });
    }
  });

  // Get user by ID
  router.get('/:id', authenticate, validateParams(idParam), async (req, res) => {
    try {
      const user = req.user as User;
      const userId = res.locals.params.id;

      const targetUser = await userService.getUserById(userId);

      if (!targetUser) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'User not found' }
        });
      }

      // Users without directory read access may only view their own record.
      if (!userHasPermission(user, 'user.read') && user.id !== userId) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Insufficient permissions' }
        });
      }

      res.json({ success: true, data: targetUser });
    } catch (error) {
      logger.error('Get user error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve user' }
      });
    }
  });

  // Update user
  router.put('/:id', authenticate, validateParams(idParam), validateBody(updateUserBody), async (req, res) => {
    try {
      const user = req.user as User;
      const userId = res.locals.params.id;

      const canManageUsers = userHasPermission(user, 'user.manage');

      // Users without user management may only edit their own record.
      if (!canManageUsers && user.id !== userId) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Insufficient permissions' }
        });
      }

      const updateData: UpdateUserRequest = req.body;

      // Self-service editors are limited to a small set of profile fields.
      if (!canManageUsers) {
        const allowedFields = ['firstName', 'lastName', 'phone'];
        const submittedFields = Object.keys(updateData);
        const invalidFields = submittedFields.filter(field => !allowedFields.includes(field));

        if (invalidFields.length > 0) {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: `You cannot update: ${invalidFields.join(', ')}` }
          });
        }
      }

      // Role changes require user management, are subject to the
      // anti-escalation rule, and may never target one's own account.
      if (updateData.roleIds !== undefined) {
        if (user.id === userId) {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: 'You cannot change your own roles' }
          });
        }
        const roleError = await validateRoleAssignment(user, updateData.roleIds);
        if (roleError) {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: roleError }
          });
        }
      }

      const updatedUser = await userService.updateUser(userId, updateData, user.id);

      if (!updatedUser) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'User not found' }
        });
      }

      res.json({ success: true, data: updatedUser });
    } catch (error) {
      logger.error('Update user error:', error);

      if ((error as any).code === 'ER_DUP_ENTRY') {
        return res.status(409).json({
          success: false,
          error: { code: 'CONFLICT', message: 'Email or employee ID already exists' }
        });
      }

      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to update user' }
      });
    }
  });

  // Delete user
  router.delete('/:id', authenticate, validateParams(idParam), async (req, res) => {
    try {
      const user = req.user as User;
      const userId = res.locals.params.id;

      if (!userHasPermission(user, 'user.manage')) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Insufficient permissions' }
        });
      }

      if (user.id === userId) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Cannot delete yourself' }
        });
      }

      try {
        await userService.deleteUser(userId, user.id);

        res.json({ success: true, message: 'User deleted successfully' });
      } catch (deleteError: any) {
        if (deleteError.message === 'User not found') {
          return res.status(404).json({
            success: false,
            error: { code: 'NOT_FOUND', message: 'User not found' }
          });
        }
        throw deleteError;
      }
    } catch (error) {
      logger.error('Delete user error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to delete user' }
      });
    }
  });

  return router;
};
