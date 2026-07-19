/**
 * Test helper: maps the legacy role shorthand used by the test fixtures
 * ('admin' | 'manager' | 'employee') to the effective permission codes the
 * corresponding seeded role grants. Mirrors the grants defined in
 * `database/init.sql` so route tests can exercise permission-based handlers
 * without standing up the real RBAC tables.
 */

export const ALL_PERMISSIONS: string[] = [
  'employee.read', 'employee.manage',
  'schedule.read', 'schedule.manage', 'schedule.publish', 'schedule.optimize',
  'assignment.manage', 'shift.manage',
  'department.read', 'department.manage',
  'org_unit.read', 'org_unit.manage',
  'oncall.manage',
  'policy.read', 'policy.manage', 'policy.approve',
  'approval.manage',
  'loan.request', 'loan.approve',
  'timeoff.approve', 'shiftswap.approve',
  'preferences.manage',
  'report.read', 'audit.read',
  'user.read', 'user.read_all', 'user.manage',
  'settings.manage', 'role.manage',
];

export const MANAGER_PERMISSIONS: string[] = [
  'employee.read', 'employee.manage',
  'schedule.read', 'schedule.manage', 'schedule.publish', 'schedule.optimize',
  'assignment.manage', 'shift.manage',
  'department.read', 'department.manage',
  'org_unit.read',
  'oncall.manage',
  'policy.read', 'policy.manage', 'policy.approve',
  'loan.request', 'loan.approve',
  'timeoff.approve', 'shiftswap.approve',
  'preferences.manage',
  'report.read', 'audit.read',
  'user.read', 'user.manage',
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
