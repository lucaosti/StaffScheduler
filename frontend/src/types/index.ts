/**
 * Type Definitions for Staff Scheduler Frontend
 * 
 * Comprehensive type definitions covering all data models, interfaces,
 * and API contracts for the Staff Scheduler React application.
 * 
 * Modules:
 * - User Authentication and Authorization
 * - Employee Management
 * - Shift and Schedule Management
 * - Assignment and Approval Workflows
 * - API Request/Response Types
 * - Component Props and State Types
 * 
 * @author Luca Ostinelli
 */

// Types for StaffScheduler Frontend (aligned with backend schema)

export type ID = number | string;

// User Authentication (with N-level hierarchy)
export interface User {
  id: ID;
  email: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'manager' | 'employee';
  employeeId?: string;
  phone?: string;
  isActive: boolean;
  lastLogin?: string | Date;
  createdAt: string | Date;
  updatedAt: string | Date;

  // Legacy / UI-only fields (optional)
  username?: string;
  passwordHash?: string;
  salt?: string;
  parentSupervisor?: ID;
  hierarchyLevel?: number;
  hierarchyPath?: string;
  permissions?: Permission[];
  delegatedAuthorities?: DelegatedAuthority[];
  createdBy?: ID;
  resetToken?: string;
  resetTokenExpiry?: Date;
  notificationToken?: string;
  maxSubordinateLevel?: number;
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

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
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
  id?: ID; // backend user.id
  employeeId?: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  position?: string;
  department?: string;
  employeeType?: string; // full-time, part-time, contract
  hourlyRate?: number; // Hourly wage rate
  maxHoursPerWeek?: number; // Maximum weekly hours
  hireDate?: string;
  contractFrom?: string; // ISO date
  contractTo?: string;   // ISO date
  workPatterns?: WorkPattern;
  skills?: string[];
  preferences?: EmployeePreferences;
  emergencyContact?: EmergencyContact;
  primaryUnit?: string; // Main organizational unit
  secondaryUnits?: string[]; // Additional units for cross-functional work
  primarySupervisor?: string; // Main supervisor ID
  secondarySupervisors?: string[]; // Matrix supervisors for specific projects
  hierarchyPath?: string; // Materialized path in org tree
  restHours?: number; // Override default role rest hours
  targetHours?: Record<string, number>; // per horizon type
  roles?: string[]; // Can cover multiple roles, no seniority
  isActive: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
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
  id: ID;
  name?: string;
  startTime: string;  // Time format HH:MM
  endTime: string;    // Time format HH:MM
  date: string | Date;       // ISO date YYYY-MM-DD
  scheduleId?: ID;
  departmentId?: ID;
  departmentName?: string;
  templateId?: ID;
  minStaff?: number;
  maxStaff?: number;
  assignedStaff?: number;
  notes?: string | null;
  status: 'open' | 'assigned' | 'confirmed' | 'cancelled';

  // Legacy fields (optional)
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
  rolesRequired?: Record<string, number>;  // role -> minimum count
  createdBy?: ID;
  createdAt?: string | Date;
  updatedAt?: string | Date;
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
  status?: 'open' | 'assigned' | 'confirmed' | 'cancelled' | 'draft' | 'published' | 'archived';
}

export interface ShiftFilters {
  startDate?: string;
  endDate?: string;
  department?: string;
  type?: 'regular' | 'special';
  status?: 'open' | 'assigned' | 'confirmed' | 'cancelled' | 'draft' | 'published' | 'archived';
  position?: string;
}

export interface Assignment {
  id: ID;
  shiftId: ID;
  userId?: ID;
  userName?: string;
  userEmail?: string;
  shiftDate?: string | Date;
  startTime?: string;
  endTime?: string;
  departmentId?: ID;
  departmentName?: string;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  assignedAt?: string | Date;
  confirmedAt?: string | Date | null;
  notes?: string | null;

  // Legacy fields (optional)
  employeeId?: ID;
  role?: string;
  approvedBy?: ID;
  approvedAt?: string | Date;
  rejectedReason?: string;
}

// Schedule management types
export interface Schedule {
  id: ID;
  name: string;
  description?: string;
  startDate: string | Date;
  endDate: string | Date;
  status: 'draft' | 'published' | 'archived';
  departmentId?: ID;
  departmentName?: string;
  createdBy?: ID;
  createdAt: string | Date;
  updatedAt: string | Date;
  publishedAt?: string | Date;
  publishedBy?: ID;
  notes?: string | null;
  totalShifts?: number;
  totalAssignments?: number;
}

export interface CreateScheduleRequest {
  name: string;
  description?: string;
  startDate: string;
  endDate: string;
  departmentId?: ID;
  notes?: string;
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
  email: string;
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
