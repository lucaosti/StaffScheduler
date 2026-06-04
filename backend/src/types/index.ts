/**
 * Type Definitions for Staff Scheduler
 * Simplified and aligned with database schema
 */

// ============================================================================
// USER TYPES
// ============================================================================

export interface User {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  employeeId?: string;
  phone?: string;
  isActive: boolean;
  lastLogin?: Date;
  /** Roles assigned to the user, each optionally scoped to an org unit. */
  roles?: UserRoleAssignment[];
  /** Flattened, de-duplicated effective permission codes (e.g. `schedule.manage`). */
  permissions?: string[];
  departments?: UserDepartment[];
  skills?: Skill[];
  preferences?: UserPreferences;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// RBAC TYPES — configurable roles and permissions (no hardcoded roles)
// ============================================================================

export interface Permission {
  id: number;
  code: string;
  resource: string;
  action: string;
  description?: string;
}

export interface Role {
  id: number;
  name: string;
  description?: string;
  isSystem: boolean;
  permissions?: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UserRoleAssignment {
  roleId: number;
  roleName: string;
  scopeOrgUnitId?: number | null;
  expiresAt?: Date | null;
}

export interface CreateRoleRequest {
  name: string;
  description?: string;
  permissionCodes?: string[];
}

export interface UpdateRoleRequest {
  name?: string;
  description?: string;
  permissionCodes?: string[];
}

export interface AssignRoleRequest {
  roleId: number;
  scopeOrgUnitId?: number | null;
  expiresAt?: string | null;
}

interface UserDepartment {
  id: number;
  name: string;
}

interface UserPreferences {
  maxHoursPerWeek: number;
  minHoursPerWeek: number;
  maxConsecutiveDays: number;
  preferredShifts: number[];
  avoidShifts: number[];
}

export interface CreateUserRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  /** Role ids to grant the new user (unscoped). */
  roleIds?: number[];
  employeeId?: string;
  phone?: string;
  departmentIds?: number[];
  skillIds?: number[];
}

export interface UpdateUserRequest {
  email?: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  /** When provided, replaces the user's unscoped role grants. */
  roleIds?: number[];
  employeeId?: string;
  phone?: string;
  isActive?: boolean;
}

// ============================================================================
// DEPARTMENT TYPES
// ============================================================================

export interface Department {
  id: number;
  name: string;
  description?: string;
  managerId?: number;
  managerName?: string;
  isActive: boolean;
  employeeCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDepartmentRequest {
  name: string;
  description?: string;
  managerId?: number;
}

export interface UpdateDepartmentRequest {
  name?: string;
  description?: string;
  managerId?: number;
  isActive?: boolean;
}

// ============================================================================
// SKILL TYPES
// ============================================================================

export interface Skill {
  id: number;
  name: string;
  description?: string;
  isActive: boolean;
  userCount?: number;
  shiftCount?: number;
  createdAt: Date;
}

export interface CreateSkillRequest {
  name: string;
  description?: string;
}

export interface UpdateSkillRequest {
  name?: string;
  description?: string;
  isActive?: boolean;
}

// ============================================================================
// SCHEDULE TYPES
// ============================================================================

export interface Schedule {
  id: number;
  name: string;
  startDate: string | Date;
  endDate: string | Date;
  status: 'draft' | 'published' | 'archived';
  departmentId?: number;
  departmentName?: string;
  createdBy?: number;
  createdByName?: string;
  publishedBy?: number;
  publishedAt?: Date;
  totalShifts?: number;
  totalAssignments?: number;
  shifts?: Shift[];
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateScheduleRequest {
  name: string;
  startDate: string;
  endDate: string;
  departmentId: number;
  createdBy?: number;
  templateIds?: number[];
  notes?: string;
}

export interface UpdateScheduleRequest {
  name?: string;
  startDate?: string;
  endDate?: string;
  status?: 'draft' | 'published' | 'archived';
  departmentId?: number;
  notes?: string;
}

// ============================================================================
// SHIFT TYPES
// ============================================================================

export interface Shift {
  id: number;
  scheduleId: number;
  scheduleName?: string;
  departmentId: number;
  departmentName?: string;
  templateId?: number;
  date: string | Date;
  startTime: string;
  endTime: string;
  minStaff: number;
  maxStaff: number;
  assignedStaff: number;
  requiredSkills?: Skill[];
  assignments?: ShiftAssignment[];
  status: 'open' | 'assigned' | 'confirmed' | 'cancelled';
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateShiftRequest {
  scheduleId: number;
  departmentId: number;
  templateId?: number;
  date: string;
  startTime: string;
  endTime: string;
  minStaff: number;
  maxStaff: number;
  requiredSkillIds?: number[];
  notes?: string;
}

export interface UpdateShiftRequest {
  date?: string;
  startTime?: string;
  endTime?: string;
  minStaff?: number;
  maxStaff?: number;
  status?: 'open' | 'assigned' | 'confirmed' | 'cancelled';
  requiredSkillIds?: number[];
  notes?: string;
}

// ============================================================================
// ASSIGNMENT TYPES
// ============================================================================

export interface ShiftAssignment {
  id: number;
  shiftId: number;
  userId: number;
  userName?: string;
  userEmail?: string;
  shiftDate?: string | Date;
  startTime?: string;
  endTime?: string;
  departmentId?: number;
  departmentName?: string;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  assignedAt: Date;
  confirmedAt?: Date;
  notes?: string;
}

export interface CreateAssignmentRequest {
  shiftId: number;
  userId: number;
  notes?: string;
}

// System Settings Types
export interface SystemSetting {
  id: number;
  category: string;
  key: string;
  value: string;
  type: 'string' | 'number' | 'boolean' | 'json';
  defaultValue: string;
  description?: string;
  isEditable: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateSystemSettingRequest {
  value: string;
}
