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
  position?: string;
  hourlyRate?: number;
  isActive: boolean;
  lastLogin?: Date;
  /** Roles assigned to the user, each optionally scoped to an org unit. */
  roles?: UserRoleAssignment[];
  /** Flattened, de-duplicated effective permission codes (e.g. `schedule.manage`). */
  permissions?: string[];
  /**
   * Org-unit IDs the user may access (union of all scoped-role subtrees).
   * `null` means no scoping — the user has full access across all org units.
   * An empty array means the user has scoped roles but none resolve to any
   * valid org unit, so they can access nothing.
   */
  allowedOrgUnitIds?: number[] | null;
  departments?: UserDepartment[];
  /** Convenience field: name of the user's primary department (populated by list queries). */
  department?: string;
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

export interface Delegation {
  id: number;
  delegatorId: number;
  delegateeId: number;
  permissionCodes: string[];
  scopeOrgUnitId?: number | null;
  startsAt: Date;
  expiresAt: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDelegationRequest {
  delegateeId: number;
  permissionCodes: string[];
  expiresAt: string;
  scopeOrgUnitId?: number | null;
}

export type ApproverScope =
  | 'policy_owner'
  | 'unit_manager'
  | 'unit_manager_chain'
  | 'company_role'
  | 'company_user';

export interface ApprovalStep {
  id: number;
  workflowId: number;
  stepOrder: number;
  approverScope: ApproverScope;
  approverRoleId: number | null;
  approverUserId: number | null;
  autoApproveForOwner: boolean;
  escalateAfterHours: number | null;
}

export interface ApprovalWorkflow {
  id: number;
  changeType: string;
  requireAll: boolean;
  description: string | null;
  steps: ApprovalStep[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateApprovalWorkflowRequest {
  changeType: string;
  requireAll?: boolean;
  description?: string;
  steps: Array<{
    stepOrder: number;
    approverScope: ApproverScope;
    approverRoleId?: number | null;
    approverUserId?: number | null;
    autoApproveForOwner?: boolean;
    escalateAfterHours?: number | null;
  }>;
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
  position?: string;
  hourlyRate?: number;
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
  position?: string;
  hourlyRate?: number;
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
  orgUnitId?: number;
  isActive: boolean;
  employeeCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDepartmentRequest {
  name: string;
  description?: string;
  managerId?: number;
  orgUnitId?: number;
}

export interface UpdateDepartmentRequest {
  name?: string;
  description?: string;
  managerId?: number;
  orgUnitId?: number;
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
  departmentOrgUnitId?: number | null;
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

export interface ShiftTemplate {
  id: number;
  name: string;
  description?: string;
  departmentId: number;
  departmentName?: string;
  startTime: string;
  endTime: string;
  minStaff: number;
  maxStaff: number;
  isActive?: boolean;
  createdAt: Date;
  updatedAt: Date;
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
