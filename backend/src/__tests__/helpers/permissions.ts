/**
 * Test helper: maps the legacy role shorthand used by the test fixtures
 * ('admin' | 'manager' | 'employee') to the effective permission codes the
 * corresponding seeded role grants. Mirrors the grants seeded by the schema
 * migrations so route tests can exercise permission-based handlers
 * without standing up the real RBAC tables.
 */

// These lists must mirror the role_permissions seeds in the baseline
// migration (db/migrations/*_initial_schema.sql) exactly: route tests use
// them to decide what a given role may do, so a code missing here silently
// weakens every authorization test for that area (this happened with the
// attendance.*, responsibility.* and change_request.* codes). When a
// migration adds a permission or changes a role's grants, update these lists
// in the same PR.
export const ALL_PERMISSIONS: string[] = [
  'employee.read', 'employee.manage',
  'schedule.read', 'schedule.manage', 'schedule.publish', 'schedule.optimize',
  'assignment.manage', 'shift.manage',
  'department.read', 'department.manage',
  'org_unit.read', 'org_unit.manage',
  'oncall.manage',
  'policy.read', 'policy.manage', 'policy.approve',
  'approval.manage', 'delegation.manage',
  'loan.request', 'loan.approve',
  'timeoff.approve', 'shiftswap.approve',
  'preferences.manage',
  'report.read', 'audit.read',
  'user.read', 'user.read_all', 'user.manage',
  'settings.manage', 'role.manage',
  'responsibility.read', 'responsibility.manage',
  'change_request.create', 'change_request.review',
  'attendance.read', 'attendance.approve',
];

export const MANAGER_PERMISSIONS: string[] = [
  'employee.read', 'employee.manage',
  'schedule.read', 'schedule.manage', 'schedule.publish', 'schedule.optimize',
  'assignment.manage', 'shift.manage',
  'department.read', 'department.manage',
  'org_unit.read',
  'oncall.manage',
  'policy.read', 'policy.manage', 'policy.approve',
  'delegation.manage',
  'loan.request', 'loan.approve',
  'timeoff.approve', 'shiftswap.approve',
  'preferences.manage',
  'report.read', 'audit.read',
  'user.read', 'user.manage',
  'responsibility.read', 'responsibility.manage',
  'change_request.create', 'change_request.review',
  'attendance.read', 'attendance.approve',
];

export const EMPLOYEE_PERMISSIONS: string[] = [
  'schedule.read', 'department.read', 'org_unit.read', 'policy.read', 'employee.read',
];

export const permissionsForRole = (role?: string): string[] => {
  if (role === 'admin') return ALL_PERMISSIONS;
  if (role === 'manager') return MANAGER_PERMISSIONS;
  if (role === 'employee') return EMPLOYEE_PERMISSIONS;
  return [];
};
