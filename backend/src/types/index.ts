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
  role: 'admin' | 'manager' | 'employee';
  employeeId?: string;
  phone?: string;
  isActive: boolean;
  lastLogin?: Date;
  departments?: UserDepartment[];
  skills?: Skill[];
  preferences?: UserPreferences;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserDepartment {
  id: number;
  name: string;
}

export interface UserPreferences {
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
  role: 'admin' | 'manager' | 'employee';
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
  role?: 'admin' | 'manager' | 'employee';
  employeeId?: string;
  phone?: string;
  isActive?: boolean;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  success: boolean;
  data?: {
    token: string;
    user: Omit<User, 'createdAt' | 'updatedAt'>;
  };
  error?: {
    code: string;
    message: string;
  };
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
// SHIFT TEMPLATE TYPES
// ============================================================================

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
  requiredSkills?: Skill[];
  isActive: boolean;
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
  requiredSkillIds?: number[];
}

export interface UpdateShiftTemplateRequest {
  name?: string;
  description?: string;
  departmentId?: number;
  startTime?: string;
  endTime?: string;
  minStaff?: number;
  maxStaff?: number;
  requiredSkillIds?: number[];
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

export interface UpdateAssignmentRequest {
  status?: 'pending' | 'confirmed' | 'cancelled';
  notes?: string;
}

// ============================================================================
// OPTIMIZATION TYPES
// ============================================================================

export interface OptimizationRequest {
  scheduleId: number;
  startDate: string;
  endDate: string;
  departmentIds?: number[];
  constraints: OptimizationConstraints;
}

export interface OptimizationConstraints {
  maxHoursPerWeek: number;
  minHoursPerWeek: number;
  maxConsecutiveDays: number;
  minRestHoursBetweenShifts: number;
  respectPreferences: boolean;
  respectUnavailability: boolean;
  respectSkills: boolean;
}

export interface OptimizationResult {
  success: boolean;
  scheduleId: number;
  assignments: ShiftAssignment[];
  statistics: {
    totalShifts: number;
    assignedShifts: number;
    unassignedShifts: number;
    coverageRate: number;
    constraintViolations: number;
  };
  warnings?: string[];
  errors?: string[];
}

// ============================================================================
// DASHBOARD TYPES
// ============================================================================

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

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  message?: string;
}

export interface PaginatedResponse<T = any> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

// ============================================================================
// QUERY FILTER TYPES
// ============================================================================

export interface UserFilters {
  role?: 'admin' | 'manager' | 'employee';
  departmentId?: number;
  isActive?: boolean;
  search?: string;
}

export interface ShiftFilters {
  scheduleId?: number;
  departmentId?: number;
  startDate?: string;
  endDate?: string;
  status?: string;
}

export interface AssignmentFilters {
  userId?: number;
  shiftId?: number;
  scheduleId?: number;
  status?: string;
  startDate?: string;
  endDate?: string;
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
