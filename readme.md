# Staff Scheduler: Advanced Workforce Management System

## Executive Summary

The Staff Scheduler is an enterprise-grade workforce management system designed for complex healthcare and service organizations. It automatically generates optimal shift schedules while respecting legal constraints, union rules, employee preferences, and management directives.

### Key Capabilities:
- **Intelligent Optimization**: Uses advanced constraint programming to balance coverage requirements, employee preferences, and fairness
- **N-Level Hierarchical Management**: Supports unlimited organizational depth with role-based permissions and delegation
- **Flexible Constraint System**: Handles hard constraints (legal/mandatory) and soft preferences with configurable priorities
- **Real-time Collaboration**: Multiple supervisors can work simultaneously on schedules with automatic conflict resolution
- **Mobile-Responsive Interface**: Works seamlessly across desktop, tablet, and mobile browsers
- **Advanced Reporting**: PDF/Excel exports plus in-browser editing capabilities

### What It Considers:
- **Legal & Union Requirements**: Maximum consecutive days, minimum rest periods, weekly hour limits
- **Coverage Needs**: Role-specific minimum/maximum staffing per time interval
- **Employee Preferences**: Day-off requests, shift type preferences, availability constraints
- **Management Directives**: Forced assignments, special shift requirements, emergency coverage
- **Fairness & Equity**: Ensures equitable distribution of desirable/undesirable shifts
- **Special Situations**: Holiday coverage, on-call assignments, overtime management
- **Hierarchical Constraints**: Supervisor-imposed rules that cascade down organizational levels

### Core Problem Solved:
Creates feasible, fair, and optimal work schedules for large organizations (100+ employees) while automatically handling complex business rules, regulatory compliance, and stakeholder preferences through a user-friendly interface accessible at all organizational levels.

---

## 1. Problem Statement

The Staff Scheduler aims to assign employees to shifts over a given time horizon, respecting hard constraints (legal, contractual, operational) and optimizing for soft preferences (employee wishes, fairness, target hours). The system must support flexible roles, overlapping coverage intervals, and individual overrides.

## 2. Complete Mathematical Model

### Sets and Indices
- $E$: Employees, index $i$.
- $R$: Roles (e.g., Nurse, Doctor, OSS), index $r$. No hierarchy - roles are equivalent in seniority.
- $T$: Shifts, index $t$. Each $t$ has $(\text{start}_t, \text{end}_t)$ timestamps. Includes regular and special shifts.
- $F$: Coverage intervals, index $f$ (arbitrary, possibly overlapping).
- $S$: Special shift types (on-call, overtime, emergency), index $s$.
- $H$: Hierarchy levels in organization, index $h$.
- $U$: Organizational units, index $u$.

### Parameters
- `coverage_mode ∈ {per_role, total}` (default: per_role)
- `role_flex ∈ {strict, flexible}` (default: strict)
- $A_{i,r}$: Matrix of roles each employee can cover (if flexible)
- $[\text{from}_i, \text{to}_i]$: Contract validity for employee $i$
- $\text{min}_{f,r}, \text{max}_{f,r}$: Min/max coverage for each interval/role
- $\text{rest\_hrs}_r$, $\text{rest\_hrs}_i$: Minimum rest hours per role/employee
- $\text{target\_hrs}_{r,\mathcal{H}}$, $\text{target\_hrs}_{i,\mathcal{H}}$: Target hours per role/employee for horizon $\mathcal{H}$

### Decision Variables
- $x_{i,t} \in \{0,1\}$: Employee $i$ assigned to shift $t$
- $y_{i,t,r} \in \{0,1\}$: (Flexible) Employee $i$ covers role $r$ in shift $t$
- $u^{(2)}_{i,g,X}, u^{(1)}_{i,g} \in \{0,1\}$: Preference satisfaction indicators
- $m_{i,X} \in \mathbb{Z}_{\ge0}$: Count of assignments to undesired intervals
- $\delta_i \ge 0$: Absolute deviation from target hours
- $z$: Minimum satisfaction score (for fairness)
- $d_{f,r} \ge 0$: Coverage deficit variables (only in PARTIAL mode)

### Hard Constraints (Absolute Priority)

#### 1. Forced Assignments (Management Directives)
For any forced assignment $(i,t)$ mandated by authorized supervisor:

$$x_{i,t} = 1$$

**Priority**: Highest - overrides all other constraints except basic feasibility

#### 2. Availability and Basic Feasibility
- **Contract validity**: $x_{i,t} = 0$ if $t$ outside $[\text{from}_i, \text{to}_i]$
- **No overlap**: $x_{i,t} + x_{i,t'} \leq 1$ if $\text{overlap}(t,t') > 0$
- **Approved absences**: $x_{i,t} = 0$ if $i$ has approved absence during $t$

#### 3. Minimum Rest Requirements (Legal/Union)
For each employee $i$ and shift pair $(t,t')$:

$$x_{i,t} + x_{i,t'} \leq 1 \quad \text{if } \Delta(t,t') < \text{rest\_hrs}_i$$

Where $\text{rest\_hrs}_i$ comes from personal override or role default.

#### 4. Hierarchical Constraint Inheritance
For constraint $C$ imposed at hierarchy level $h$ on organizational unit $u$:
- Applies to all employees in sub-units of $u$
- Can be overridden only by:
  - The supervisor who imposed $C$
  - A supervisor at same level $h$ with authority over $u$
  - Higher-level supervisor (level $< h$) through exemption approval

Mathematically, if constraint $C$ requires $\sum_{i \in U_{sub}} x_{i,T_C} \leq B_C$:

$$\sum_{i \in \text{descendants}(u)} x_{i,t} \leq B_C \quad \forall t \in T_C$$

unless exemption $E_{i,t,C}$ is approved.

#### 5. Coverage Requirements
For each coverage interval $f$ and role $r$:

$$\text{min}_{f,r} \leq \sum_{t \in \text{overlap}(f)} \sum_{i \in E_r} \phi_{i,t,r} \leq \text{max}_{f,r}$$

Where:
- **Strict mode**: $\phi_{i,t,r} = x_{i,t}$ if $\text{role}(i) = r$
- **Flexible mode**: $\phi_{i,t,r} = y_{i,t,r}$

#### 6. Role Assignment Consistency (Flexible Mode)

$$\sum_r y_{i,t,r} = x_{i,t} \quad \forall i,t$$

$$y_{i,t,r} \leq A_{i,r} \quad \forall i,t,r$$

### Soft Constraints (Preference Optimization)

#### 1. Employee Preferences (Hierarchical Priority)
**Level 1 (Highest Soft Priority)**: Day-off requests

$$u^{(1)}_{i,g} \leq 1 - \sum_{t \in \text{day}(g)} x_{i,t}$$

**Level 2**: Avoid specific intervals

$$u^{(2)}_{i,g,X} \leq 1 - \sum_{t \in (\text{day}(g) \cap X)} x_{i,t}$$

**Level 3 (Lowest Soft Priority)**: Minimize undesired assignments

$$m_{i,X} = \sum_{t \in X} x_{i,t}$$

#### 2. Target Hours Deviation

$$\text{hours}_i - \text{target}_i \leq \delta_i \quad \forall i$$

$$\text{target}_i - \text{hours}_i \leq \delta_i \quad \forall i$$

Where: $\text{hours}_i = \sum_t x_{i,t} \cdot \text{duration}(t)$

#### 3. Fairness (Max-Min Satisfaction)

$$S_i = \sum u^{(1)}_{i,\cdot} + \sum u^{(2)}_{i,\cdot,\cdot} - \alpha \sum_X m_{i,X}$$

$$z \leq S_i \quad \forall i$$

### Hierarchical Management Constraints

#### Delegation and Authority Transfer
If user $s_1$ delegates authority $A$ to user $s_2$ for scope $\Sigma$:
- $s_2$ can impose constraints within $\Sigma$ as if they were $s_1$
- Delegation cannot exceed $s_1$'s original authority level
- $s_1$ retains ability to revoke delegation

#### Exemption Request System
For exemption $E$ from constraint $C$ imposed by supervisor $s$:

$$\text{valid}(E) \iff (\text{requestor} \text{ subordinate of } s) \land (\text{approver} \geq \text{level}(s))$$

### Objective Function (Lexicographic Optimization)

**Phase 1**: Maximize hard constraint satisfaction

$$\max \text{feasibility\_score}$$

**Phase 2**: Optimize soft constraints with hierarchy

$$\max W_1 \sum u^{(1)} + W_2 \sum u^{(2)} - W_3 \sum m_{i,X}$$

Where $W_1 > W_2 > W_3$ ensures preference hierarchy.

**Phase 3**: Maximize fairness

$$\max z$$

**Phase 4**: Minimize target deviation

$$\min \sum_i \delta_i$$

**Phase 5** (Optional): Minimize schedule changes

$$\min \sum_{i,t} |x_{i,t} - x^{\text{prev}}_{i,t}|$$

### Conflict Resolution Algorithm

#### Multi-Supervisor Coordination
Since supervisors at same level can modify each other's constraints:

1. **Last-Write-Wins with Audit**: Most recent change takes precedence
2. **Notification Chain**: All affected supervisors notified of changes
3. **Automatic Feasibility Check**: System validates after each change
4. **Escalation Trigger**: If infeasible, escalate to common superior

#### Mathematical Representation
For conflicting constraints $C_1, C_2$ from supervisors at same level:

$$\text{active\_constraint} = \arg\max_{C \in \{C_1, C_2\}} \text{timestamp}(C)$$

### Exemption and Override System

#### Exemption Variables
$e_{i,t,C} \in \{0,1\}$: Exemption granted for employee $i$ in shift $t$ from constraint $C$

Modified constraint becomes:

$$\text{original\_constraint}(i,t) \lor e_{i,t,C} = 1$$

#### Approval Chain
Exemption $e_{i,t,C}$ valid only if:

$$\exists s : (\text{level}(s) \leq \text{level}(\text{creator}(C))) \land \text{approved\_by}(e,s)$$

This mathematical model ensures:
✅ Forced assignments are absolute (hard constraints)
✅ Hierarchy cascades with exemption system
✅ Same-level supervisors can modify each other's work
✅ Delegation system maintains authority boundaries
✅ Conflict resolution through timestamps and escalation
✅ Complete audit trail for all decisions

## 3. System Architecture

### Technology Stack
- **Frontend**: React (TypeScript)
- **Backend**: Node.js with Express (TypeScript)
- **Database**: MySQL (Relational)
- **Authentication**: Express sessions with bcrypt password hashing
- **Email**: For username and password recovery
- **Push Notifications**: Firebase Cloud Messaging (FCM) for iOS/Android
- **Optimization**: OR-Tools or similar constraint solver
- **Reports**: PDF generation (jsPDF/Puppeteer), Excel export (ExcelJS), in-browser editing
- **Integration Ready**: Event-driven architecture for future HR/payroll integrations

## 4. Frontend-Backend Interaction (TypeScript)

### Data Models (shared via TypeScript interfaces)
```typescript
// User Authentication (with N-level hierarchy)
export interface User {
  id: string;
  email: string; // Used as username
  passwordHash: string; // bcrypt with salt
  salt: string;
  role: 'master' | 'supervisor' | 'employee';
  employeeId?: string; // Link to Employee if applicable
  parentSupervisor?: string; // Parent in hierarchy tree
  hierarchyLevel: number; // 0 = master, 1 = top supervisor, etc.
  hierarchyPath: string; // Materialized path: "0.1.3.7"
  permissions: Permission[];
  delegatedAuthorities?: DelegatedAuthority[]; // Specific assignments
  createdAt: Date;
  createdBy?: string; // Who created this user
  lastLogin?: Date;
  resetToken?: string;
  resetTokenExpiry?: Date;
  notificationToken?: string; // FCM token for push notifications
  maxSubordinateLevel?: number; // How deep can they create users
}

export interface Permission {
  resource: 'employees' | 'shifts' | 'schedules' | 'reports' | 'settings' | 'users';
  action: 'read' | 'write' | 'delete' | 'approve' | 'create_user';
  scope: 'all' | 'hierarchy_down' | 'unit' | 'self'; // Hierarchical scope
  conditions?: Record<string, any>; // Additional conditions
}

export interface DelegatedAuthority {
  id: string;
  type: 'forced_assignment' | 'availability_override' | 'constraint_exception';
  targetEmployeeId?: string;
  targetShiftId?: string;
  targetTimeRange?: { start: string; end: string };
  description: string;
  isActive: boolean;
  expiresAt?: Date;
  delegatedBy: string; // Who gave this authority
}

// Employee (with matrix organization support)
export interface Employee {
  id: string;
  name: string;
  email: string;
  roles: string[]; // Can cover multiple roles, no seniority
  contractFrom: string; // ISO date
  contractTo: string;   // ISO date
  restHours?: number; // Override default role rest hours
  preferences?: Preference[];
  isActive: boolean;
  targetHours?: Record<string, number>; // per horizon type
  primaryUnit: string; // Main organizational unit
  secondaryUnits?: string[]; // Additional units for cross-functional work
  primarySupervisor: string; // Main supervisor ID
  secondarySupervisors?: string[]; // Matrix supervisors for specific projects
  hierarchyPath: string; // Materialized path in org tree
}

// Notification
export interface Notification {
  id: string;
  userId: string;
  type: 'schedule_change' | 'shift_assignment' | 'approval_request' | 'reminder';
  title: string;
  message: string;
  data?: Record<string, any>; // Additional payload
  isRead: boolean;
  createdAt: Date;
  scheduledFor?: Date; // For future notifications
}

// Shift (including special shifts)
export interface Shift {
  id: string;
  start: string; // ISO datetime
  end: string;   // ISO datetime
  type: 'regular' | 'special'; // Distinguish shift types
  specialType?: 'on_call' | 'overtime' | 'emergency' | 'holiday';
  rolesRequired: Record<string, number>; // role -> min required
  priority: number; // For constraint resolution
  location?: string;
  description?: string;
}

// Assignment
export interface Assignment {
  id: string;
  employeeId: string;
  shiftId: string;
  role: string;
  status: 'pending' | 'approved' | 'rejected';
  assignedAt: Date;
  approvedBy?: string;
  approvedAt?: Date;
}

// Forced Assignment (absolute priority)
export interface ForcedAssignment {
  id: string;
  employeeId: string;
  shiftId: string;
  createdBy: string; // Supervisor who mandated it
  createdAt: Date;
  justification: string;
  priority: 'emergency' | 'operational' | 'administrative';
  overrides: string[]; // List of constraints this overrides
  canBeExempted: boolean; // Can subordinate supervisors request exemption
}

// Exemption Request System
export interface ExemptionRequest {
  id: string;
  constraintId: string; // Which constraint needs exemption
  requestedBy: string;
  requestedFor: string; // Employee ID
  targetShifts: string[]; // Which shifts need exemption
  justification: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: string;
  reviewedAt?: Date;
  expiresAt?: Date; // When exemption expires
}

// Hierarchical Constraint (replaces simple Preference for hierarchy-imposed rules)
export interface HierarchicalConstraint {
  id: string;
  type: 'max_consecutive' | 'no_night_shifts' | 'mandatory_coverage' | 'forced_assignment';
  createdBy: string; // Supervisor who imposed it
  hierarchyLevel: number;
  appliesTo: 'employee' | 'unit' | 'role' | 'hierarchy_branch';
  targetScope: string[]; // Employee IDs, unit names, or role names
  parameters: Record<string, any>; // Constraint-specific parameters
  inheritanceRule: 'cascade_down' | 'direct_only' | 'skip_one_level';
  exemptionPolicy: 'no_exemptions' | 'same_level_approval' | 'higher_level_approval';
  isActive: boolean;
  createdAt: Date;
  expiresAt?: Date;
}

// Union/Legal Constraints
export interface LegalConstraint {
  id: string;
  type: 'max_consecutive_days' | 'max_weekly_hours' | 'mandatory_break' | 'night_shift_limit';
  roleId?: string; // Apply to specific role or all
  value: number;
  period: 'daily' | 'weekly' | 'monthly';
  isActive: boolean;
}

// Schedule Result
export interface ScheduleResult {
  id: string;
  assignments: Assignment[];
  unassignedShifts?: Shift[];
  constraintViolations?: ConstraintViolation[];
  stats: ScheduleStats;
  generatedAt: Date;
  parameters: ScheduleParameters;
}

export interface ScheduleStats {
  fairness: number; // Min satisfaction score
  preferenceSatisfaction: number; // Overall percentage
  targetDeviation: number; // Average hours deviation
  coverageRate: number; // Percentage of shifts covered
  employeeUtilization: Record<string, number>; // Hours per employee
}

export interface ConstraintViolation {
  type: 'hard' | 'soft';
  constraint: string;
  employeeId?: string;
  shiftId?: string;
  severity: number;
  message: string;
}

export interface ScheduleParameters {
  coverageMode: 'per_role' | 'total';
  roleFlex: 'strict' | 'flexible';
  horizon: 'weekly' | 'monthly' | 'annual';
  mode: 'strict' | 'partial' | 'whatif'; // Added what-if mode
  optimizationLevel: 'fast' | 'balanced' | 'optimal';
  solver: 'ortools' | 'cplex' | 'gurobi' | 'custom';
}

// Report Configuration
export interface ReportConfig {
  id: string;
  type: 'schedule_overview' | 'employee_hours' | 'coverage_analysis' | 'constraint_violations';
  format: 'pdf' | 'excel' | 'browser_edit';
  parameters: Record<string, any>;
  scheduledGeneration?: Date;
  recipients?: string[]; // Email addresses
}

// Integration Event (for future HR/payroll integrations)
export interface IntegrationEvent {
  id: string;
  type: 'schedule_approved' | 'employee_updated' | 'hours_calculated';
  payload: Record<string, any>;
  targetSystem?: string;
  status: 'pending' | 'sent' | 'acknowledged' | 'failed';
  createdAt: Date;
  processedAt?: Date;
}
```

### API Contracts (REST with Express, all TypeScript)

#### User Management & Hierarchy Endpoints
- `POST /api/users/create` — Create subordinate user
  - Input: `{ userData: User, initialPermissions: Permission[] }`
  - Output: `User`
  - Validation: Ensures creator can create at that level
- `GET /api/users/hierarchy/:userId` — Get user's hierarchy tree
  - Output: `{ ancestors: User[], descendants: User[], level: number }`
- `POST /api/users/:id/delegate` — Delegate specific authority
  - Input: `DelegatedAuthority`
  - Output: `{ success: boolean, notifiedUsers: string[] }`
- `GET /api/users/:id/authorities` — Get delegated authorities
  - Output: `DelegatedAuthority[]`
- `POST /api/hierarchy/validate` — Validate hierarchy change
  - Input: `{ newSupervisor: string, subordinate: string }`
  - Output: `{ valid: boolean, conflicts?: string[] }`
#### Authentication Endpoints
- `POST /api/auth/register` — Register new user (only by authorized supervisors)
  - Input: `{ email: string, password: string, role: string, permissions: Permission[] }`
  - Output: `{ user: User, token: string }`
- `POST /api/auth/login` — User login
  - Input: `{ email: string, password: string }`
  - Output: `{ user: User, token: string, hierarchyContext: HierarchyContext }`
- `POST /api/auth/logout` — User logout
- `POST /api/auth/forgot-password` — Request password reset
  - Input: `{ email: string }`
  - Output: `{ message: string }`
- `POST /api/auth/reset-password` — Reset password with token
  - Input: `{ token: string, newPassword: string }`
  - Output: `{ message: string }`

export interface HierarchyContext {
  level: number;
  canCreateUsers: boolean;
  maxSubordinateLevel: number;
  accessibleUnits: string[];
  delegatedAuthorities: DelegatedAuthority[];
}

#### Notification Endpoints
- `POST /api/notifications/send` — Send push notification
  - Input: `{ userIds: string[], title: string, message: string, data?: any }`
  - Output: `{ success: boolean, sentCount: number }`
- `GET /api/notifications/:userId` — Get user notifications
  - Output: `Notification[]`
- `PUT /api/notifications/:id/read` — Mark notification as read
- `POST /api/notifications/register-token` — Register FCM token
  - Input: `{ userId: string, token: string, platform: 'ios' | 'android' | 'web' }`

#### Reporting Endpoints
- `GET /api/reports/types` — List available report types
  - Output: `ReportType[]`
- `POST /api/reports/generate` — Generate report
  - Input: `ReportConfig`
  - Output: `{ reportId: string, downloadUrl?: string }`
- `GET /api/reports/:id/download` — Download report file
- `GET /api/reports/:id/edit` — Get editable report data (for browser editing)
  - Output: `{ data: any[][], columns: string[], metadata: ReportMetadata }`
- `PUT /api/reports/:id/save` — Save edited report data
  - Input: `{ data: any[][], changes: ChangeLog[] }`

#### What-If Analysis Endpoints
- `POST /api/schedule/whatif` — Run what-if scenario
  - Input: `{ baseScheduleId: string, changes: Assignment[], parameters: ScheduleParameters }`
  - Output: `{ comparison: ScheduleComparison, newResult: ScheduleResult }`
- `GET /api/schedule/whatif/:id` — Get what-if results
  - Output: `ScheduleComparison`

#### Integration Endpoints (Future-Ready)
- `POST /api/integrations/webhook` — Receive external system webhooks
- `GET /api/integrations/events` — List integration events
- `POST /api/integrations/sync` — Trigger manual sync with external system
#### Core API Endpoints
- `GET /api/employees` — List employees (filtered by user permissions)
  - Query: `{ unit?: string, role?: string, active?: boolean }`
  - Output: `Employee[]`
- `POST /api/employees` — Create employee
  - Input: `Employee`
  - Output: `Employee`
- `PUT /api/employees/:id` — Update employee
  - Input: `Partial<Employee>`
  - Output: `Employee`
- `DELETE /api/employees/:id` — Deactivate employee

- `GET /api/shifts` — List shifts with filters
  - Query: `{ start?: string, end?: string, type?: string, unit?: string }`
  - Output: `Shift[]`
- `POST /api/shifts` — Create shift
  - Input: `Shift`
  - Output: `Shift`
- `PUT /api/shifts/:id` — Update shift
- `DELETE /api/shifts/:id` — Delete shift

- `GET /api/preferences/:employeeId` — Get employee preferences
  - Output: `Preference[]`
- `POST /api/preferences` — Set/update preferences
  - Input: `Preference[]`
  - Output: `Preference[]`

- `POST /api/schedule/generate` — Generate schedule
  - Input: `{ parameters: ScheduleParameters, overrides?: Assignment[] }`
  - Output: `ScheduleResult`
- `GET /api/schedule/:id` — Get generated schedule
  - Output: `ScheduleResult`
- `POST /api/schedule/:id/approve` — Approve schedule
  - Input: `{ approvedBy: string }`
  - Output: `{ success: boolean }`

- `GET /api/constraints` — List legal/union constraints
  - Output: `LegalConstraint[]`
- `POST /api/constraints` — Create constraint
  - Input: `LegalConstraint`
  - Output: `LegalConstraint`

### Interaction Flow
1. **Authentication**: User logs in with email/password. Backend validates credentials using bcrypt, returns JWT token.
2. **User Management**: Admin manages employees, roles, and constraints. Employees can update their own preferences.
3. **Shift Planning**: Supervisors create regular and special shifts, defining coverage requirements.
4. **Schedule Generation**: 
   - Frontend sends scheduling request with parameters and any manual overrides
   - Backend validates input, applies constraints (hard and soft)
   - Optimization engine runs with specified mode (strict/partial)
   - Returns assignments, unassigned shifts, and constraint violations
5. **Review & Approval**: Supervisors review generated schedule, can make manual adjustments, then approve.
6. **Notification**: System notifies employees of their assignments (future enhancement).

### Database Schema (MySQL)
```sql
-- Users table with N-level hierarchy support
CREATE TABLE users (
  id VARCHAR(36) PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  salt VARCHAR(255) NOT NULL,
  role ENUM('master', 'supervisor', 'employee') NOT NULL,
  employee_id VARCHAR(36),
  parent_supervisor VARCHAR(36) NULL,
  hierarchy_level INT NOT NULL DEFAULT 0,
  hierarchy_path VARCHAR(500) NOT NULL, -- Materialized path: "0.1.3.7"
  max_subordinate_level INT NULL, -- How deep they can create users
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(36) NULL,
  last_login TIMESTAMP NULL,
  reset_token VARCHAR(255) NULL,
  reset_token_expiry TIMESTAMP NULL,
  notification_token VARCHAR(500) NULL,
  is_active BOOLEAN DEFAULT TRUE,
  INDEX idx_email (email),
  INDEX idx_hierarchy_path (hierarchy_path),
  INDEX idx_parent (parent_supervisor),
  INDEX idx_level (hierarchy_level),
  FOREIGN KEY (parent_supervisor) REFERENCES users(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Hierarchy paths for efficient queries (materialized view)
CREATE TABLE hierarchy_paths (
  descendant_id VARCHAR(36),
  ancestor_id VARCHAR(36),
  depth INT,
  PRIMARY KEY (descendant_id, ancestor_id),
  FOREIGN KEY (descendant_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (ancestor_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_descendant (descendant_id),
  INDEX idx_ancestor (ancestor_id),
  INDEX idx_depth (depth)
);

-- Delegated authorities
CREATE TABLE delegated_authorities (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  type ENUM('forced_assignment', 'availability_override', 'constraint_exception') NOT NULL,
  target_employee_id VARCHAR(36) NULL,
  target_shift_id VARCHAR(36) NULL,
  target_time_start DATETIME NULL,
  target_time_end DATETIME NULL,
  description TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  expires_at DATETIME NULL,
  delegated_by VARCHAR(36) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (target_employee_id) REFERENCES employees(id),
  FOREIGN KEY (target_shift_id) REFERENCES shifts(id),
  FOREIGN KEY (delegated_by) REFERENCES users(id),
  INDEX idx_user (user_id),
  INDEX idx_type (type),
  INDEX idx_active (is_active),
  INDEX idx_expires (expires_at)
);

-- Modified employees table with matrix organization
CREATE TABLE employees (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  contract_from DATE NOT NULL,
  contract_to DATE NOT NULL,
  rest_hours INT NULL,
  primary_unit VARCHAR(255) NOT NULL,
  primary_supervisor VARCHAR(36) NOT NULL,
  hierarchy_path VARCHAR(500) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email),
  INDEX idx_active (is_active),
  INDEX idx_primary_unit (primary_unit),
  INDEX idx_hierarchy_path (hierarchy_path),
  FOREIGN KEY (primary_supervisor) REFERENCES users(id)
);

-- Secondary units for matrix organization
CREATE TABLE employee_secondary_units (
  employee_id VARCHAR(36),
  unit_name VARCHAR(255),
  supervisor_id VARCHAR(36),
  PRIMARY KEY (employee_id, unit_name),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (supervisor_id) REFERENCES users(id)
);

-- Hierarchy change log for audit
CREATE TABLE hierarchy_changes (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  change_type ENUM('created', 'moved', 'permissions_changed', 'authority_delegated') NOT NULL,
  old_parent VARCHAR(36) NULL,
  new_parent VARCHAR(36) NULL,
  changed_by VARCHAR(36) NOT NULL,
  change_reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (old_parent) REFERENCES users(id),
  FOREIGN KEY (new_parent) REFERENCES users(id),
  FOREIGN KEY (changed_by) REFERENCES users(id),
  INDEX idx_user (user_id),
  INDEX idx_changed_by (changed_by),
  INDEX idx_created_at (created_at)
);

-- User permissions for fine-grained access control
CREATE TABLE user_permissions (
  user_id VARCHAR(36),
  resource VARCHAR(50),
  action VARCHAR(50),
  scope VARCHAR(50),
  PRIMARY KEY (user_id, resource, action),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Employees table with organizational hierarchy
CREATE TABLE employees (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  contract_from DATE NOT NULL,
  contract_to DATE NOT NULL,
  rest_hours INT NULL,
  organization_unit VARCHAR(255) NOT NULL,
  supervisor_id VARCHAR(36) NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email),
  INDEX idx_active (is_active),
  INDEX idx_org_unit (organization_unit),
  FOREIGN KEY (supervisor_id) REFERENCES employees(id)
);

-- Notifications table
CREATE TABLE notifications (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  data JSON NULL,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  scheduled_for TIMESTAMP NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_read (user_id, is_read),
  INDEX idx_scheduled (scheduled_for)
);

-- Reports table
CREATE TABLE reports (
  id VARCHAR(36) PRIMARY KEY,
  type VARCHAR(100) NOT NULL,
  format ENUM('pdf', 'excel', 'browser_edit') NOT NULL,
  parameters JSON NOT NULL,
  file_path VARCHAR(500) NULL,
  status ENUM('generating', 'ready', 'failed') DEFAULT 'generating',
  generated_by VARCHAR(36) NOT NULL,
  generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NULL,
  FOREIGN KEY (generated_by) REFERENCES users(id),
  INDEX idx_type (type),
  INDEX idx_status (status),
  INDEX idx_expires (expires_at)
);

-- Integration events for future external system connections
CREATE TABLE integration_events (
  id VARCHAR(36) PRIMARY KEY,
  type VARCHAR(100) NOT NULL,
  payload JSON NOT NULL,
  target_system VARCHAR(100) NULL,
  status ENUM('pending', 'sent', 'acknowledged', 'failed') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP NULL,
  retry_count INT DEFAULT 0,
  INDEX idx_status (status),
  INDEX idx_type (type),
  INDEX idx_target (target_system)
);

-- Existing tables remain the same...
-- (employees, shifts, assignments, preferences, legal_constraints, schedule_results)
```

-- Employee roles (many-to-many)
CREATE TABLE employee_roles (
  employee_id VARCHAR(36),
  role_name VARCHAR(100),
  PRIMARY KEY (employee_id, role_name),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

-- Shifts table
CREATE TABLE shifts (
  id VARCHAR(36) PRIMARY KEY,
  start_time DATETIME NOT NULL,
  end_time DATETIME NOT NULL,
  type ENUM('regular', 'special') DEFAULT 'regular',
  special_type ENUM('on_call', 'overtime', 'emergency', 'holiday') NULL,
  priority INT DEFAULT 1,
  location VARCHAR(255) NULL,
  description TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_time_range (start_time, end_time),
  INDEX idx_type (type)
);

-- Shift role requirements
CREATE TABLE shift_role_requirements (
  shift_id VARCHAR(36),
  role_name VARCHAR(100),
  min_required INT NOT NULL,
  PRIMARY KEY (shift_id, role_name),
  FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE
);

-- Assignments table
CREATE TABLE assignments (
  id VARCHAR(36) PRIMARY KEY,
  employee_id VARCHAR(36) NOT NULL,
  shift_id VARCHAR(36) NOT NULL,
  role_name VARCHAR(100) NOT NULL,
  status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  approved_by VARCHAR(36) NULL,
  approved_at TIMESTAMP NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (shift_id) REFERENCES shifts(id),
  FOREIGN KEY (approved_by) REFERENCES users(id),
  INDEX idx_employee (employee_id),
  INDEX idx_shift (shift_id),
  INDEX idx_status (status)
);

-- Preferences table
CREATE TABLE preferences (
  id VARCHAR(36) PRIMARY KEY,
  employee_id VARCHAR(36) NOT NULL,
  type ENUM('avoid_interval', 'day_off', 'minimize_global', 'union_rule') NOT NULL,
  interval_id VARCHAR(36) NULL,
  preference_date DATE NULL,
  role_name VARCHAR(100) NULL,
  priority ENUM('soft', 'hard') DEFAULT 'soft',
  description TEXT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  INDEX idx_employee (employee_id),
  INDEX idx_type (type),
  INDEX idx_active (is_active)
);

-- Legal/Union constraints
CREATE TABLE legal_constraints (
  id VARCHAR(36) PRIMARY KEY,
  type VARCHAR(100) NOT NULL,
  role_name VARCHAR(100) NULL,
  constraint_value INT NOT NULL,
  period ENUM('daily', 'weekly', 'monthly') NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_type (type),
  INDEX idx_active (is_active)
);

-- Schedule results (for history/audit)
CREATE TABLE schedule_results (
  id VARCHAR(36) PRIMARY KEY,
  generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  generated_by VARCHAR(36) NOT NULL,
  parameters JSON NOT NULL,
  stats JSON NOT NULL,
  status ENUM('draft', 'approved', 'active', 'archived') DEFAULT 'draft',
  FOREIGN KEY (generated_by) REFERENCES users(id),
  INDEX idx_generated_at (generated_at),
  INDEX idx_status (status)
);
```

### TypeScript Usage
- All shared models are defined in a common package (e.g., `@staffscheduler/types`) and imported by both frontend and backend.
- API request/response types are enforced via TypeScript interfaces.
- Validation and error handling use TypeScript types for safety.
- Database operations use typed ORM (e.g., TypeORM or Prisma) for compile-time safety.

### Security Best Practices
- **Password Security**: bcrypt with salt for hashing, minimum 8 characters with complexity requirements
- **Authentication**: JWT tokens with reasonable expiration, secure HTTP-only cookies
- **Authorization**: Role-based access control (RBAC) for different user types
- **Password Recovery**: Time-limited tokens, secure email delivery
- **Input Validation**: All API inputs validated against TypeScript schemas
- **SQL Injection Prevention**: Parameterized queries only
- **Rate Limiting**: Login attempts and API calls
- **HTTPS**: All communication encrypted in production

### Detailed Mathematical Model

### Extended Constraint Types

#### Union/Legal Constraints (Configurable as Hard/Soft)
1. **Maximum Consecutive Working Days**
   - $\sum_{t \in \text{consecutive\_days}(d, n)} x_{i,t} \leq \text{max\_consecutive}$
   - Where $n$ is the number of consecutive days, $d$ is the starting day

2. **Maximum Weekly Hours**
   - $\sum_{t \in \text{week}(w)} x_{i,t} \cdot \text{duration}(t) \leq \text{max\_weekly\_hours}$

3. **Mandatory Break Between Shifts**
   - $x_{i,t} + x_{i,t'} \leq 1$ if $\text{time\_gap}(t, t') < \text{min\_break\_hours}$

4. **Night Shift Limitations**
   - $\sum_{t \in \text{night\_shifts}(\text{period})} x_{i,t} \leq \text{max\_night\_shifts}$

#### Special Shift Handling
- **On-call assignments**: Different rest requirements, availability constraints
- **Overtime**: Limited per employee per period, premium weighting
- **Emergency coverage**: Higher priority, flexible role assignments
- **Holiday shifts**: Special compensation rules, volunteer preferences

#### Hierarchical Constraint Propagation System

**Constraint Inheritance Model**:
For constraint $C_h$ imposed at hierarchy level $h$ on unit $u$:

$$\text{applies}(C_h, i) \iff (\text{unit}(i) \in \text{descendants}(u)) \land \neg \exists E_{i,C_h}^{\text{approved}}$$

Where $E_{i,C_h}^{\text{approved}}$ represents an approved exemption.

**Exemption Approval Logic**:

$$\text{valid}(E_{i,C_h}) \iff \exists s : (\text{level}(s) \leq h) \land (\text{scope}(s) \supseteq \text{scope}(C_h)) \land \text{signed}(s, E_{i,C_h})$$

**Delegation Authority Transfer**:
If supervisor $s_1$ delegates authority $A$ to $s_2$ for scope $\Sigma$:
- $\forall C \in A, \text{scope}(C) \subseteq \Sigma : s_2$ can impose/modify $C$
- $\text{level}(s_2) \geq \text{level}(s_1)$ (cannot delegate to superior)
- $s_1$ retains all original authorities

**Forced Assignment Override System**:

$$x_{i,t} = 1 \quad \forall (i,t) \in \mathcal{F}$$

Where $\mathcal{F}$ is the set of all active forced assignments. These override all soft constraints and most hard constraints (except basic feasibility).

**Multi-Supervisor Collaboration Model**:
For supervisors $\{s_1, s_2, \ldots, s_k\}$ at same hierarchy level:
- Shared constraint space: $\mathcal{C}_{\text{shared}} = \bigcup_{j=1}^k \mathcal{C}_{s_j}$
- Last-write-wins: $\text{active}(C) = \arg\max_{C \in \mathcal{C}_{\text{shared}}} \text{timestamp}(C)$
- Notification requirement: $\forall s_j : \text{notify}(s_j, \text{changes})$ when $\mathcal{C}_{\text{shared}}$ modified

### Optimization Algorithm Details

#### Multi-Phase Approach with Hierarchy
1. **Phase 1**: Ensure hard constraint feasibility + forced assignments
2. **Phase 2**: Apply hierarchical constraints with exemption handling
3. **Phase 3**: Optimize employee preferences with lexicographic ordering
4. **Phase 4**: Minimize target hour deviations
5. **Phase 5**: Fairness optimization (max-min satisfaction)
6. **Phase 6**: Minimize schedule disruption (optional)

#### Conflict Detection and Resolution
```typescript
interface ConflictDetection {
  detectCycle(newSupervisor: string, subordinate: string): boolean;
  validateAuthority(requester: string, action: string, scope: string): boolean;
  findCommonSupervisor(users: string[]): string | null;
  escalateConflict(conflict: Conflict): EscalationResult;
}

interface EscalationResult {
  escalatedTo: string; // Common supervisor
  resolution: 'manual_review' | 'automatic_precedence' | 'split_authority';
  notificationsSent: string[];
  temporaryHold: boolean; // Pause optimization until resolved
}
```

#### Performance Considerations
- **Problem Size**: Support for 100+ employees, 1000+ shifts per month
- **Response Time**: < 30 seconds for monthly schedules, < 5 seconds for weekly
- **Memory Usage**: Efficient constraint representation, lazy evaluation
- **Incremental Updates**: Ability to modify existing schedules with minimal disruption
- **Hierarchy Queries**: Materialized paths for O(1) ancestor/descendant checks

## 6. Frontend Specifications

### React Component Architecture
```typescript
// Main App Component with hierarchical access
interface AppProps {
  user: User;
  onLogout: () => void;
}

// Employee Management with scope filtering
interface EmployeeListProps {
  employees: Employee[];
  userScope: 'all' | 'unit' | 'self';
  onEdit: (employee: Employee) => void;
  onDeactivate: (id: string) => void;
}

// Calendar Views
interface PersonalCalendarProps {
  employeeId: string;
  assignments: Assignment[];
  shifts: Shift[];
  viewMode: 'month' | 'week' | 'day';
  onAssignmentClick: (assignment: Assignment) => void;
}

interface SupervisorGridProps {
  employees: Employee[];
  assignments: Assignment[];
  dateRange: { start: Date; end: Date };
  onCellEdit: (employeeId: string, date: Date, value: string) => void;
}

// Schedule Generation with What-If Analysis
interface ScheduleGeneratorProps {
  employees: Employee[];
  shifts: Shift[];
  onGenerate: (params: ScheduleParameters) => Promise<ScheduleResult>;
  onWhatIf: (changes: Assignment[]) => Promise<ScheduleComparison>;
}

// Notification System
interface NotificationCenterProps {
  notifications: Notification[];
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
}

// Report Generation and Editing
interface ReportGeneratorProps {
  reportTypes: ReportType[];
  onGenerate: (config: ReportConfig) => Promise<string>;
}

interface BrowserReportEditorProps {
  reportId: string;
  data: any[][];
  columns: string[];
  onSave: (changes: any[][]) => Promise<void>;
  onExport: (format: 'pdf' | 'excel') => Promise<void>;
}
```

### State Management
- **Redux Toolkit** for global state management
- **RTK Query** for API data fetching and caching
- **Real-time updates** via WebSocket for schedule changes
- **Optimistic updates** for better UX
- **Offline support** for mobile browser usage

### Mobile-Responsive Design
- **PWA capabilities** for mobile browser installation
- **Touch-friendly** calendar and grid interactions
- **Responsive breakpoints** for tablet/phone layouts
- **Swipe gestures** for calendar navigation
- **Pull-to-refresh** for data updates

### Advanced UI Features

#### Calendar Visualization
- **Multi-view calendar**: Monthly overview, weekly detail, daily breakdown
- **Color coding**: Different shift types, roles, conflicts
- **Drag-and-drop**: Manual assignment adjustments with constraint validation
- **Conflict highlighting**: Real-time constraint violation indicators
- **Quick actions**: Context menus for common operations

#### Supervisor Grid View
```typescript
interface GridCell {
  employeeId: string;
  date: Date;
  value: 'morning' | 'afternoon' | 'night' | 'night_end' | 'rest' | 'vacation' | 'sick';
  editable: boolean;
  conflicts?: string[];
}

interface SupervisorGridState {
  employees: Employee[];
  dateRange: DateRange;
  cells: Map<string, GridCell>; // key: `${employeeId}-${date}`
  editMode: boolean;
  pendingChanges: GridCell[];
}
```

#### Real-time Collaboration
- **WebSocket integration** for live updates during schedule editing
- **Conflict resolution** when multiple supervisors edit simultaneously
- **Change notifications** for affected employees
- **Version history** with rollback capabilities

### Performance Optimization
- **Virtual scrolling** for large employee lists
- **Lazy loading** for calendar data
- **Memoized components** to prevent unnecessary re-renders
- **Service worker** for background sync and caching
- **Bundle splitting** for faster initial load

### Optimization Engine Integration

#### Solver Selection and Configuration
```typescript
interface SolverConfig {
  engine: 'ortools' | 'cplex' | 'gurobi' | 'custom';
  timeout: number; // seconds
  threads?: number;
  memoryLimit?: number; // MB
  heuristics?: 'fast' | 'balanced' | 'thorough';
}

interface OptimizationProgress {
  phase: 'preprocessing' | 'solving' | 'postprocessing';
  progress: number; // 0-100
  currentObjective?: number;
  bestBound?: number;
  elapsedTime: number;
  estimatedRemaining?: number;
}
```

#### Large-Scale Performance Targets
- **100+ employees**: < 30 seconds for monthly optimization
- **500+ employees**: < 2 minutes with progress updates
- **1000+ shifts/month**: Efficient constraint handling
- **Memory usage**: < 2GB for largest instances
- **Incremental solving**: < 5 seconds for minor changes

#### Hierarchical Access Control (N-Level)
```typescript
interface AccessScope {
  hierarchyLevel: number; // Dynamic depth
  maxCreateLevel: number; // How deep can create users
  accessiblePaths: string[]; // Hierarchy paths accessible
  permissions: {
    viewDown: boolean; // See subordinates
    viewUp: boolean; // See superiors (limited)
    editSchedules: boolean;
    approveSchedules: boolean;
    manageEmployees: boolean;
    viewReports: boolean;
    manageConstraints: boolean;
    createUsers: boolean;
    delegateAuthority: boolean;
  };
}

// Hierarchy validation functions
function canCreateUserAtLevel(creator: User, targetLevel: number): boolean {
  return creator.hierarchyLevel < targetLevel && 
         (creator.maxSubordinateLevel === null || targetLevel <= creator.maxSubordinateLevel);
}

function getNotificationChain(employeeId: string): string[] {
  // Returns all supervisors up the chain who should be notified
  // Uses hierarchy_paths table for efficient querying
}

function validateHierarchyMove(userId: string, newParentId: string): ValidationResult {
  // Prevents cycles and validates business rules
  // Checks if move would create conflicts
}
```

### Critical Business Rules for N-Level Hierarchy

#### 1. **Forced Assignment Workflow**
```typescript
interface ForcedAssignmentRequest {
  employeeId: string;
  shiftId: string;
  requestedBy: string; // Supervisor making the request
  justification: string;
  priority: 'normal' | 'urgent' | 'emergency';
}

// Business Logic:
// 1. Supervisor requests forced assignment
// 2. System checks if supervisor has authority over employee
// 3. If cross-hierarchy, escalates to common supervisor
// 4. All supervisors in chain get notified
// 5. Assignment becomes hard constraint in optimization
```

#### 2. **Notification Propagation Rules**
```typescript
interface NotificationRule {
  eventType: string;
  propagateUp: boolean; // Notify supervisors
  propagateDown: boolean; // Notify subordinates
  propagateSideways: boolean; // Notify matrix supervisors
  maxLevelsUp: number; // Limit propagation depth
  immediateOnly: boolean; // Only direct supervisor/subordinates
}
```

#### 3. **Conflict Resolution Matrix**
```typescript
// When multiple supervisors have conflicting demands
interface ConflictResolution {
  conflictType: 'forced_assignment' | 'availability' | 'preference';
  employees: string[];
  supervisors: string[];
  resolutionStrategy: 'escalate_to_common' | 'priority_based' | 'manual_review';
  escalationPath: string[]; // Hierarchy path for escalation
}
```

---

This comprehensive documentation provides a complete foundation for implementing the Staff Scheduler system with all specified requirements and best practices.
