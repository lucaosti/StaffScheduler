/**
 * Type Definitions for Staff Scheduler
 * Simplified and aligned with database schema
 */

// ── Shared domain contract ────────────────────────────────────────────────────
// Permission, Role and UserRoleAssignment are declared once in
// @staff-scheduler/shared and re-exported here, so both sides cannot drift.
// Importing them from this barrel keeps every existing call site unchanged.
import type {
  Permission,
  Role,
  UserRoleAssignment,
  Timestamp,
  Shift as SharedShift,
  Schedule as SharedSchedule,
  User as SharedUser,
  Department as SharedDepartment,
  ShiftAssignment as SharedShiftAssignment,
} from '@staff-scheduler/shared';
export type { Permission, Role, UserRoleAssignment, Timestamp };


// ============================================================================
// USER TYPES
// ============================================================================

export interface User extends SharedUser {
  /**
   * Server-only authorisation context, derived per request — never part of the
   * wire contract the UI consumes.
   *
   * Org-unit IDs the user may access (union of all scoped-role subtrees).
   * `null` means no scoping — full access across all org units. An empty array
   * means the user has scoped roles but none resolve to a valid org unit, so
   * they can access nothing.
   */
  allowedOrgUnitIds?: number[] | null;
  /**
   * Per-permission org-unit restrictions introduced by scoped delegations.
   * Only populated when the user holds at least one delegation with
   * scope_org_unit_id set. Route handlers performing org-unit gating must check
   * this before allowing a delegated permission to act outside its scope.
   */
  delegationScopes?: Array<{ permissionCode: string; allowedOrgUnitIds: number[] }>;
  departments?: UserDepartment[];
  /** Convenience field: name of the user's primary department (list queries). */
  department?: string;
  skills?: Skill[];
  preferences?: UserPreferences;
}

// ============================================================================
// RBAC TYPES — configurable roles and permissions (no hardcoded roles)
// ============================================================================

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
  | 'company_user'
  | 'responsibility_rule'
  | 'unit_structure';

export interface ApprovalStep {
  id: number;
  workflowId: number;
  stepOrder: number;
  approverScope: ApproverScope;
  approverRoleId: number | null;
  approverUserId: number | null;
  /** Required when approverScope === 'responsibility_rule'. */
  approverPermissionCode: string | null;
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
    approverPermissionCode?: string | null;
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
  /** Organization name for per-org module override resolution. Null clears the assignment. */
  organizationName?: string | null;
}

// ============================================================================
// DEPARTMENT TYPES
// ============================================================================

export type Department = SharedDepartment;

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

export interface Schedule extends SharedSchedule {
  /** Server-only: the owning department's org unit, used for approval routing. */
  departmentOrgUnitId?: number | null;
  /** Populated by the with-shifts endpoint. */
  shifts?: Shift[];
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

export interface Shift extends SharedShift {
  /**
   * Server-side enrichments that do not cross the wire in the shared contract:
   * the skills a shift demands and its current assignments. Kept here rather
   * than in @staff-scheduler/shared because the UI never reads them and they
   * reference backend-only types.
   */
  requiredSkills?: Skill[];
  assignments?: ShiftAssignment[];
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

export interface CreateShiftTemplateRequest {
  name: string;
  description?: string;
  departmentId: number;
  startTime: string;
  endTime: string;
  minStaff: number;
  maxStaff: number;
}

export interface UpdateShiftTemplateRequest {
  name?: string;
  description?: string;
  startTime?: string;
  endTime?: string;
  minStaff?: number;
  maxStaff?: number;
}

export interface EmployeeSkill {
  id: number;
  name: string;
  description?: string;
  proficiencyLevel: number;
}

// ============================================================================
// ASSIGNMENT TYPES
// ============================================================================

export type ShiftAssignment = SharedShiftAssignment;

export interface CreateAssignmentRequest {
  shiftId: number;
  userId: number;
  notes?: string;
  /** ID of the user performing the assignment (manager); used for audit trail. */
  actorId?: number;
  /** Free-text reason for the assignment; stored in the audit log. */
  reason?: string;
}

// ============================================================================
// RESPONSIBILITY RULES
// ============================================================================

export type ResponsibilitySubjectType = 'org_unit' | 'department' | 'role' | 'all';

export interface ResponsibilityRule {
  id: number;
  subjectType: ResponsibilitySubjectType;
  subjectId: number | null;
  permissionCode: string;
  responsibleOrgUnitId: number;
  delegatedToRoleId: number | null;
  description: string | null;
  isActive: boolean;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateResponsibilityRuleRequest {
  subjectType: ResponsibilitySubjectType;
  subjectId?: number | null;
  permissionCode: string;
  responsibleOrgUnitId: number;
  delegatedToRoleId?: number | null;
  description?: string | null;
}

export interface UpdateResponsibilityRuleRequest {
  subjectType?: ResponsibilitySubjectType;
  subjectId?: number | null;
  permissionCode?: string;
  responsibleOrgUnitId?: number;
  delegatedToRoleId?: number | null;
  description?: string | null;
  isActive?: boolean;
}

// ============================================================================
// CHANGE REQUEST TYPES
// ============================================================================

export type ChangeRequestStatus = 'pending' | 'approved' | 'rejected' | 'applied' | 'cancelled';

export interface ChangeRequest {
  id: number;
  changeType: string;
  proposerUserId: number;
  targetEntityType: string;
  targetEntityId: number | null;
  proposedPayload: Record<string, unknown>;
  justification: string | null;
  status: ChangeRequestStatus;
  approverUserId: number | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  appliedAt: string | null;
  /** When applied, the action is attributed to this user (the authority holder). */
  onBehalfOfUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateChangeRequestInput {
  changeType: string;
  targetEntityType: string;
  targetEntityId?: number | null;
  proposedPayload: Record<string, unknown>;
  justification?: string | null;
}

export interface ChangeRequestFilters {
  proposerUserId?: number;
  approverUserId?: number;
  status?: ChangeRequestStatus;
  changeType?: string;
  targetEntityType?: string;
  limit?: number;
  offset?: number;
}

export type PendingApprovalStatus = 'pending' | 'approved' | 'rejected' | 'escalated' | 'skipped';

/** Which entity table a `pending_approvals` row is deciding on. Exactly one of the four *Id fields is set. */
export type PendingApprovalEntityType = 'change_request' | 'time_off_request' | 'employee_loan' | 'shift_swap_request';

export interface PendingApproval {
  id: number;
  changeRequestId: number | null;
  timeOffRequestId: number | null;
  employeeLoanId: number | null;
  shiftSwapRequestId: number | null;
  workflowId: number;
  stepId: number;
  stepOrder: number;
  /** The person who can decide this right now. Null once opened to the whole structure. */
  assignedToUserId: number | null;
  /** Set when this step's scope is 'unit_structure' — the decision belongs to this org unit. */
  assignedToOrgUnitId: number | null;
  /** When true, any member of assignedToOrgUnitId may decide it (assignedToUserId is null). */
  openToStructure: boolean;
  /** Who actually decided it — may differ from assignedToUserId once opened to the structure. */
  decidedByUserId: number | null;
  status: PendingApprovalStatus;
  decidedAt: string | null;
  decisionNote: string | null;
  escalatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PendingApprovalWithContext extends PendingApproval {
  changeType: string;
  targetEntityType: PendingApprovalEntityType;
  targetEntityId: number | null;
  proposedPayload: Record<string, unknown>;
  justification: string | null;
  proposerUserId: number;
}

export type DecisionReassignmentAction = 'kept' | 'delegated_to_person' | 'opened_to_structure';

export interface DecisionReassignment {
  id: number;
  pendingApprovalId: number;
  action: DecisionReassignmentAction;
  actorUserId: number;
  targetUserId: number | null;
  createdAt: string;
}

export interface DecisionChain {
  pendingApprovalId: number;
  status: PendingApprovalStatus;
  assignedToOrgUnit: { id: number; name: string; headUserId: number | null; headName: string | null } | null;
  reassignments: Array<DecisionReassignment & { actorName: string; targetName: string | null }>;
  currentAssigneeUserId: number | null;
  openToStructure: boolean;
  decidedByUserId: number | null;
  decidedByName: string | null;
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
