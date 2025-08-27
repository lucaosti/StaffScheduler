// User Authentication (with N-level hierarchy)
export interface User {
  id: string;
  username: string;
  email: string; // Used as username
  firstName: string;
  lastName: string;
  passwordHash: string; // bcrypt with salt
  salt?: string;
  role: 'admin' | 'manager' | 'employee';
  employeeId?: string; // Link to Employee if applicable
  parentSupervisor?: string; // Parent in hierarchy tree
  hierarchyLevel: number; // 0 = master, 1 = top supervisor, etc.
  hierarchyPath: string; // Materialized path: "0.1.3.7"
  permissions: Permission[];
  delegatedAuthorities?: DelegatedAuthority[]; // Specific assignments
  createdAt: string;
  updatedAt: string;
  createdBy?: string; // Who created this user
  lastLogin?: Date;
  resetToken?: string;
  resetTokenExpiry?: Date;
  notificationToken?: string; // FCM token for push notifications
  maxSubordinateLevel?: number; // How deep can they create users
  isActive: boolean;
}

export interface CreateUserRequest {
  username: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'manager' | 'employee';
}

export interface LoginResponse {
  user: Omit<User, 'passwordHash' | 'salt'>;
  token: string;
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
  employeeId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  position: string;
  department: string;
  hireDate: string;
  contractFrom: string; // ISO date
  contractTo: string;   // ISO date
  workPatterns: WorkPattern;
  skills: string[];
  preferences: EmployeePreferences;
  emergencyContact: EmergencyContact;
  primaryUnit?: string; // Main organizational unit
  secondaryUnits?: string[]; // Additional units for cross-functional work
  primarySupervisor: string; // Main supervisor ID
  secondarySupervisors?: string[]; // Matrix supervisors for specific projects
  hierarchyPath: string; // Materialized path in org tree
  restHours?: number; // Override default role rest hours
  targetHours?: Record<string, number>; // per horizon type
  roles?: string[]; // Can cover multiple roles, no seniority
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  supervisorName?: string | null;
}

export interface WorkPattern {
  preferredShifts: string[];
  maxHoursPerWeek: number;
  minHoursPerWeek: number;
  availableDays: string[];
  unavailableDates: string[];
  preferredTimeSlots: TimeSlot[];
  restrictions?: string[];
}

export interface TimeSlot {
  startTime: string;  // HH:MM
  endTime: string;    // HH:MM
  days: string[];     // ['monday', 'tuesday', ...]
}

export interface EmployeePreferences {
  preferredDepartments: string[];
  avoidNightShifts: boolean;
  flexibleSchedule: boolean;
  maxConsecutiveDays: number;
  preferredDaysOff: string[];
  notes?: string;
}

export interface EmergencyContact {
  name: string;
  phone: string;
  relationship: string;
  email?: string;
}

export interface CreateEmployeeRequest {
  employeeId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  position: string;
  department: string;
  hireDate: string;
  contractFrom: string;
  contractTo: string;
  workPatterns: WorkPattern;
  skills: string[];
  preferences: EmployeePreferences;
  emergencyContact: EmergencyContact;
  primarySupervisor: string;
  primaryUnit?: string;
}

export interface UpdateEmployeeRequest {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  position?: string;
  department?: string;
  contractFrom?: string;
  contractTo?: string;
  workPatterns?: WorkPattern;
  skills?: string[];
  preferences?: EmployeePreferences;
  emergencyContact?: EmergencyContact;
}

export interface EmployeeFilters {
  department?: string;
  position?: string;
  active?: boolean;
  hierarchyPath?: string;
  skills?: string[];
  search?: string;
}

export interface PaginationParams {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
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
  name: string;
  startTime: string;  // Time format HH:MM
  endTime: string;    // Time format HH:MM
  date: string;       // ISO date YYYY-MM-DD
  department: string;
  position: string;
  requiredSkills: string[];
  minimumStaff: number;
  maximumStaff: number;
  type: 'regular' | 'special';
  specialType?: 'on_call' | 'overtime' | 'emergency' | 'holiday';
  priority: number;
  location?: string;
  description?: string;
  status: 'draft' | 'published' | 'archived';
  rolesRequired: Record<string, number>;  // role -> minimum count
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  createdByName?: string | null;
}

export interface CreateShiftRequest {
  name: string;
  startTime: string;
  endTime: string;
  date: string;
  department: string;
  position: string;
  requiredSkills: string[];
  minimumStaff: number;
  maximumStaff: number;
  type?: 'regular' | 'special';
  specialType?: 'on_call' | 'overtime' | 'emergency' | 'holiday';
  priority?: number;
  location?: string;
  description?: string;
  rolesRequired: Record<string, number>;
}

export interface UpdateShiftRequest {
  name?: string;
  startTime?: string;
  endTime?: string;
  date?: string;
  department?: string;
  position?: string;
  requiredSkills?: string[];
  minimumStaff?: number;
  maximumStaff?: number;
  type?: 'regular' | 'special';
  specialType?: 'on_call' | 'overtime' | 'emergency' | 'holiday';
  priority?: number;
  location?: string;
  description?: string;
  rolesRequired?: Record<string, number>;
  status?: 'draft' | 'published' | 'archived';
}

export interface ShiftFilters {
  startDate?: string;
  endDate?: string;
  department?: string;
  type?: 'regular' | 'special';
  status?: 'draft' | 'published' | 'archived';
  position?: string;
}

export interface Assignment {
  id: string;
  employeeId: string;
  shiftId: string;
  role: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  assignedAt: Date;
  approvedBy?: string;
  approvedAt?: Date;
  rejectedReason?: string;
  notes?: string;
}

// Preference system
export interface Preference {
  id: string;
  employeeId: string;
  type: 'day_off' | 'avoid_interval' | 'preferred_shift' | 'max_consecutive';
  priority: 1 | 2 | 3; // 1 = highest, 3 = lowest
  timeInterval?: {
    start: string; // ISO datetime or date
    end: string;
  };
  weeklyPattern?: {
    daysOfWeek: number[]; // 0 = Sunday, 1 = Monday, etc.
    timeSlots?: { start: string; end: string }[];
  };
  value?: number; // For numeric preferences like max_consecutive
  isActive: boolean;
  validFrom: string; // ISO date
  validTo?: string;  // ISO date
}

// Legal/Union constraints
export interface LegalConstraint {
  id: string;
  name: string;
  description: string;
  type: 'max_consecutive_days' | 'min_rest_hours' | 'max_weekly_hours' | 'max_monthly_hours';
  value: number;
  appliesTo: 'all' | 'role' | 'employee' | 'unit'; // Scope
  targetId?: string;
  hierarchyLevel: number;
  organizationUnit: string;
  canOverride: boolean;
  isActive: boolean;
  createdBy: string;
  createdAt: Date;
}

// Role (job roles)
export interface Role {
  id: string;
  name: string;
  description?: string;
  defaultRestHours: number;
  colorCode?: string;
  isActive: boolean;
}

// Organizational Unit
export interface OrganizationalUnit {
  id: string;
  name: string;
  description?: string;
  parentUnitId?: string;
  hierarchyPath: string;
  managerId?: string;
  isActive: boolean;
}

// Schedule generation parameters
export interface ScheduleParameters {
  startDate: string; // ISO date
  endDate: string;   // ISO date
  mode: 'strict' | 'partial'; // strict = all shifts covered, partial = allow uncovered
  roleMode: 'strict' | 'flexible'; // strict = exact role match, flexible = cross-training
  optimizationGoals: {
    preferenceWeight: number;    // 0-1
    fairnessWeight: number;      // 0-1
    targetHoursWeight: number;   // 0-1
    stabilityWeight: number;     // 0-1 (minimize changes from previous)
  };
  constraints: {
    enforceRestPeriods: boolean;
    allowOvertime: boolean;
    maxOvertimePercent: number;
    respectAvailability: boolean;
  };
  excludeEmployees?: string[]; // Employees to exclude from scheduling
  forceAssignments?: Assignment[]; // Pre-assigned shifts
}

// Schedule generation result
export interface ScheduleResult {
  id: string;
  parameters: ScheduleParameters;
  assignments: Assignment[];
  unassignedShifts: string[]; // Shift IDs that couldn't be covered
  constraintViolations: ConstraintViolation[];
  statistics: {
    totalShifts: number;
    assignedShifts: number;
    coveragePercent: number;
    averageFairness: number;
    employeeUtilization: Record<string, number>; // employeeId -> utilization %
  };
  generatedAt: Date;
  generatedBy: string;
  status: 'draft' | 'approved' | 'published' | 'archived';
  approvedBy?: string;
  approvedAt?: Date;
}

export interface ConstraintViolation {
  type: 'hard' | 'soft';
  constraintId: string;
  employeeId: string;
  shiftId: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

// Report configuration
export interface ReportConfig {
  type: 'schedule' | 'utilization' | 'fairness' | 'violations' | 'custom';
  timeRange: {
    start: string; // ISO date
    end: string;
  };
  filters: {
    employees?: string[];
    roles?: string[];
    units?: string[];
    shiftTypes?: string[];
  };
  format: 'pdf' | 'excel' | 'csv';
  includeGraphics: boolean;
  groupBy?: 'employee' | 'role' | 'unit' | 'week' | 'month';
}

export interface ReportResult {
  id: string;
  config: ReportConfig;
  data: any[][]; // Raw data matrix
  columns: string[];
  generatedAt: Date;
  generatedBy: string;
  downloadUrl?: string;
}

// Conflict resolution
export interface Conflict {
  id: string;
  type: 'overlapping_assignments' | 'constraint_violation' | 'authority_dispute' | 'resource_conflict';
  involvedEmployees: string[];
  involvedSupervisors: string[];
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  resolutionStrategy: 'manual_review' | 'automatic_precedence' | 'escalate_to_superior';
  status: 'open' | 'in_review' | 'resolved' | 'escalated';
  createdAt: Date;
  resolvedAt?: Date;
  resolvedBy?: string;
  resolutionNotes?: string;
}

// Audit trail
export interface AuditLog {
  id: string;
  userId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  changes: Record<string, { old: any; new: any }>;
  timestamp: Date;
  ipAddress?: string;
  userAgent?: string;
  reason?: string; // For sensitive operations
}

// API Response types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
    totalPages?: number;
    hasNext?: boolean;
    hasPrev?: boolean;
  };
}

export interface PaginationOptions {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
  filters?: Record<string, any>;
}

// Authentication types
export interface LoginRequest {
  username?: string;
  email?: string;
  password: string;
  rememberMe?: boolean;
}

export interface PasswordResetRequest {
  email: string;
}

export interface PasswordResetConfirm {
  token: string;
  newPassword: string;
}

// Validation types
export interface ValidationError {
  field: string;
  message: string;
  value?: any;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

// Database result types
export interface DatabaseInsertResult {
  insertId: string | number;
  affectedRows: number;
}

export interface DatabaseUpdateResult {
  affectedRows: number;
  changedRows: number;
}

// Session extension

// Schedule management types
export interface Schedule {
  id: string;
  name: string;
  description?: string;
  startDate: string;
  endDate: string;
  status: 'draft' | 'published' | 'archived';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  publishedBy?: string;
}

export interface CreateScheduleRequest {
  name: string;
  description?: string;
  startDate: string;
  endDate: string;
}

export interface UpdateScheduleRequest {
  name?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  status?: 'draft' | 'published' | 'archived';
}

export interface OptimizationOptions {
  startDate: string;
  endDate: string;
  departments?: string[];
  roles?: string[];
  employees?: string[];
  constraints: {
    maxConsecutiveDays?: number;
    minRestHours?: number;
    respectPreferences?: boolean;
    allowOvertime?: boolean;
  };
  weights: {
    coverage: number;
    fairness: number;
    preferences: number;
    stability: number;
  };
}

export interface DashboardStats {
  totalEmployees: number;
  activeSchedules: number;
  todayShifts: number;
  pendingApprovals: number;
  monthlyHours: number;
  monthlyCost: number;
  coverageRate: number;
  employeeSatisfaction: number;
}
