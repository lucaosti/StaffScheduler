/**
 * Department routes — CRUD plus membership management for `/api/departments`.
 *
 * Follows the standard route shape: validate with a Zod schema from
 * `@staff-scheduler/shared`, construct the service, call one method, return the
 * envelope. Errors are never caught here — a rejected handler's promise
 * reaches the central `errorHandler` on its own, which is what keeps the
 * error contract in one place instead of re-derived per route.
 *
 * WHY THIS IS A FACTORY (`createDepartmentsRouter(pool)`) RATHER THAN A
 * MODULE-LEVEL ROUTER. The pool is created once in `index.ts` and injected.
 * The alternative — a singleton the router imports — makes the router
 * impossible to mount against a different database, which is exactly what the
 * real-MySQL integration suite does when it points the app at a throwaway
 * schema. Every router that touches data follows this shape; the exceptions
 * take no pool because they need none (`metrics`, `openapi`, `events`) or,
 * in `health`'s case, deliberately use the shared `database` singleton, since
 * a liveness probe must report on the connection the application actually
 * holds rather than one handed to it.
 *
 * NOTE ON DEPARTMENTS VS ORG UNITS. Both exist and they are not the same axis:
 * a department is the SCHEDULING unit that owns schedules and shifts, while an
 * org unit is the hierarchical node that owns responsibility, approvals and
 * management chains. A department may reference an org unit (`orgUnitId`) but
 * neither contains the other. Conflating them is the most common misreading of
 * this domain, which is why the two have separate routers.
 *
 * @author Luca Ostinelli
 */

import { Router } from 'express';
import { Pool } from 'mysql2/promise';
import { DepartmentService } from '../services/DepartmentService';
import { UserService } from '../services/UserService';
import { GeofenceService } from '../services/GeofenceService';
import { KioskService } from '../services/KioskService';
import { authenticate, userHasPermission } from '../middleware/auth';
import { validateParams, validateBody, validateQuery } from '../middleware/validation';
import {
  idParam,
  idAndUserIdParam,
  idAndGeofenceIdParam,
  idAndKioskIdParam,
  createDepartmentBody,
  updateDepartmentBody,
  addUserToDepartmentBody,
  departmentListQuery,
  createGeofenceBody,
  updateGeofenceBody,
  createKioskDeviceBody,
} from '../schemas';
import { UpdateDepartmentRequest, User } from '../types';

export const createDepartmentsRouter = (pool: Pool) => {
  const router = Router();
  const departmentService = new DepartmentService(pool);
  const geofenceService = new GeofenceService(pool);
  const userService = new UserService(pool);
  const kioskService = new KioskService(pool);

  // The isActive/orgUnitId filters were documented but never read; they now
  // apply to the unrestricted listing. The scoped listing stays unfiltered:
  // it already returns only the caller's own departments.
  router.get('/', authenticate, validateQuery(departmentListQuery), async (req, res) => {
    const user = req.user!;

    let departments;
    if (userHasPermission(user, 'settings.manage')) {
      departments = await departmentService.getAllDepartments(res.locals.query);
    } else {
      departments = await departmentService.getDepartmentsForUser(user.id);
    }

    res.json({ success: true, data: departments });
  });

  router.get('/:id', authenticate, validateParams(idParam), async (req, res) => {
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
  });

  router.post('/', authenticate, validateBody(createDepartmentBody), async (req, res) => {
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
  });

  router.put('/:id', authenticate, validateParams(idParam), validateBody(updateDepartmentBody), async (req, res) => {
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
  });

  router.delete('/:id', authenticate, validateParams(idParam), async (req, res) => {
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
  });

  router.post('/:id/users', authenticate, validateParams(idParam), validateBody(addUserToDepartmentBody), async (req, res) => {
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
  });

  router.delete('/:id/users/:userId', authenticate, validateParams(idAndUserIdParam), async (req, res) => {
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

    await departmentService.removeUserFromDepartment(departmentId, targetUserId);

    res.json({ success: true, data: { message: 'User removed from department successfully' } });
  });

  router.get('/:id/stats', authenticate, validateParams(idParam), async (req, res) => {
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
  });

  /**
   * Same access rule as every other department sub-resource in this file:
   * a full administrator (`settings.manage`) manages any department's fences
   * or kiosk devices; a department manager (`department.manage`) only their own.
   */
  const canManageDepartment = async (actor: User, departmentId: number): Promise<boolean> => {
    if (userHasPermission(actor, 'settings.manage')) return true;
    if (!userHasPermission(actor, 'department.manage')) return false;
    const managed = await departmentService.getDepartmentsForUser(actor.id);
    return managed.some((d) => d.id === departmentId && d.managerId === actor.id);
  };

  router.get('/:id/geofences', authenticate, validateParams(idParam), async (req, res) => {
    const departmentId = res.locals.params.id;
    if (!(await canManageDepartment(req.user!, departmentId))) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
    }
    const geofences = await geofenceService.listForDepartment(departmentId);
    res.json({ success: true, data: geofences });
  });

  router.post('/:id/geofences', authenticate, validateParams(idParam), validateBody(createGeofenceBody), async (req, res) => {
    const departmentId = res.locals.params.id;
    if (!(await canManageDepartment(req.user!, departmentId))) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
    }
    const geofence = await geofenceService.create(departmentId, res.locals.body);
    res.status(201).json({ success: true, data: geofence });
  });

  router.put('/:id/geofences/:geofenceId', authenticate, validateParams(idAndGeofenceIdParam), validateBody(updateGeofenceBody), async (req, res) => {
    const departmentId = res.locals.params.id;
    if (!(await canManageDepartment(req.user!, departmentId))) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
    }
    const geofence = await geofenceService.update(res.locals.params.geofenceId, res.locals.body);
    res.json({ success: true, data: geofence });
  });

  router.delete('/:id/geofences/:geofenceId', authenticate, validateParams(idAndGeofenceIdParam), async (req, res) => {
    const departmentId = res.locals.params.id;
    if (!(await canManageDepartment(req.user!, departmentId))) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
    }
    await geofenceService.delete(res.locals.params.geofenceId);
    res.json({ success: true, data: { message: 'Geofence deleted successfully' } });
  });

  router.get('/:id/kiosks', authenticate, validateParams(idParam), async (req, res) => {
    const departmentId = res.locals.params.id;
    if (!(await canManageDepartment(req.user!, departmentId))) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
    }
    const devices = await kioskService.listForDepartment(departmentId);
    res.json({ success: true, data: devices });
  });

  // Response carries `token` in plaintext — the ONLY time it exists outside
  // the hash in kiosk_devices; the admin UI must show it once and not offer
  // to display it again, since it genuinely cannot be recovered afterward.
  router.post('/:id/kiosks', authenticate, validateParams(idParam), validateBody(createKioskDeviceBody), async (req, res) => {
    const departmentId = res.locals.params.id;
    if (!(await canManageDepartment(req.user!, departmentId))) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
    }
    const { device, token } = await kioskService.create(departmentId, res.locals.body.name, req.user!.id);
    res.status(201).json({ success: true, data: { ...device, token } });
  });

  router.delete('/:id/kiosks/:kioskId', authenticate, validateParams(idAndKioskIdParam), async (req, res) => {
    const departmentId = res.locals.params.id;
    if (!(await canManageDepartment(req.user!, departmentId))) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
    }
    await kioskService.revoke(res.locals.params.kioskId);
    res.json({ success: true, data: { message: 'Kiosk device revoked successfully' } });
  });

  return router;
};
