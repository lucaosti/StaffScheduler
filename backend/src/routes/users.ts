/**
 * User routes — `/api/users`, the administrative account surface.
 *
 * WHY THIS EXISTS ALONGSIDE `/api/employees`, WHICH RETURNS THE SAME ROWS. The
 * two are the same data behind different authority. `/api/employees` is the
 * workforce view a scheduling manager reaches with `employee.read`. This router
 * is the administrative view: account lifecycle, activation, role assignment.
 * Merging them would mean one permission gate for two genuinely different
 * capabilities, and the narrower one would have to become the wider one.
 * `/api/employees` can still create accounts and set roles (`employee.manage`),
 * so both routers hold every account write to `UserAuthorityService` — an
 * earlier version of this comment claimed it could not, and the rule guarding
 * only this router was bypassed through the other one (#809).
 *
 * WHY THE PASSWORD COLUMN IS NEVER SELECTED INTO A RESPONSE. The column is
 * `password_hash` (never `password`), and the shared `User` type deliberately
 * declares no credential fields at all. It used to declare `passwordHash`,
 * `salt`, `resetToken`, `resetTokenExpiry` and `notificationToken` on a type
 * the browser consumes — inert only because nothing read them, which is not a
 * safety property. Removing them from the type is what makes an accidental
 * `SELECT *` reaching the client a compile error rather than a leak.
 *
 * @author Luca Ostinelli
 */

import { Router } from 'express';
import { Pool } from 'mysql2/promise';
import { UserService } from '../services/UserService';
import { UserAuthorityService } from '../services/access/UserAuthorityService';
import { authenticate, userHasPermission, invalidateAuthContext } from '../middleware/auth';
import { parsePagination, sendPaginated } from '../middleware/pagination';
import { validateParams, validateBody, validateQuery } from '../middleware/validation';
import { idParam, createUserBody, updateUserBody, userListQuery } from '../schemas';
import { UpdateUserRequest, User } from '../types';

export const createUsersRouter = (pool: Pool) => {
  const router = Router();
  const userService = new UserService(pool);
  // Who may write which account and grant which role is decided in one place
  // for every surface that writes accounts — see UserAuthorityService.
  const authority = new UserAuthorityService(pool, 'user.manage');

  // Get all users (scoped by the caller's permissions)
  router.get('/', authenticate, validateQuery(userListQuery), async (req, res) => {
    const user = req.user as User;
    const { search, department, roleId, isActive } = res.locals.query;

    const filters = {
      search,
      departmentId: department ? parseInt(department, 10) : undefined,
      roleId,
      isActive,
    };
    const pagination = parsePagination(req);

    // The unscoped directory requires the dedicated user.read_all grant
    // (Administrator by default). Everyone else — including managers with
    // user.read — falls through to the department-scoped listing below.
    if (userHasPermission(user, 'user.read_all')) {
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
  });

  // Create new user
  router.post('/', authenticate, validateBody(createUserBody), async (req, res) => {
    const user = req.user as User;

    if (!userHasPermission(user, 'user.manage')) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Insufficient permissions' }
      });
    }

    const userData = res.locals.body;

    await authority.assertCanAssignRoles(user, userData.roleIds);

    const createdUser = await userService.createUser(userData, user.id);

    res.status(201).json({ success: true, data: createdUser });
  });

  // Get user by ID
  router.get('/:id', authenticate, validateParams(idParam), async (req, res) => {
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
  });

  // Update user
  router.put('/:id', authenticate, validateParams(idParam), validateBody(updateUserBody), async (req, res) => {
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

    const updateData: UpdateUserRequest = res.locals.body;

    // Self-service editors are limited to a small set of profile fields.
    // Check raw req.body keys so Zod-stripped unknown fields are still caught.
    if (!canManageUsers) {
      const allowedFields = ['firstName', 'lastName', 'phone'];
      const submittedFields = Object.keys(req.body ?? {});
      const invalidFields = submittedFields.filter(field => !allowedFields.includes(field));

      if (invalidFields.length > 0) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: `You cannot update: ${invalidFields.join(', ')}` }
        });
      }
    }

    // A manager may only write accounts within their own authority, and role
    // changes are subject to the anti-escalation rule (never one's own roles).
    if (canManageUsers) await authority.assertCanManageUser(user, userId, { deactivate: updateData.isActive === false });
    await authority.assertCanAssignRoles(user, updateData.roleIds, userId);

    const updatedUser = await userService.updateUser(userId, updateData, user.id);

    // Role changes must not linger in the auth-context cache.
    if (updateData.roleIds !== undefined) await invalidateAuthContext(userId);

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'User not found' }
      });
    }

    res.json({ success: true, data: updatedUser });
  });

  // Delete user
  router.delete('/:id', authenticate, validateParams(idParam), async (req, res) => {
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

    await authority.assertCanManageUser(user, userId);

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
  });

  return router;
};
