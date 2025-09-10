// Core User and Authentication Types
export interface User {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'manager' | 'department_manager' | 'employee';
  employeeId?: string;
  phone?: string;
  isActive: boolean;
  departments?: UserDepartment[];
  skills?: UserSkill[];
  createdAt: Date;
  updatedAt: Date;
}

export interface UserDepartment {
  departmentId: number;
  departmentName: string;
  isManager: boolean;
}

export interface UserSkill {
  skillId: number;
  skillName: string;
  proficiencyLevel: number;
}

// User Request Types
export interface CreateUserRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'manager' | 'department_manager' | 'employee';
  employeeId?: string;
  phone?: string;
  departmentIds?: number[];
  skillIds?: number[];
}

export interface UpdateUserRequest {
  email?: string;
  firstName?: string;
  lastName?: string;
  role?: 'admin' | 'manager' | 'department_manager' | 'employee';
  employeeId?: string;
  phone?: string;
  isActive?: boolean;
  departmentIds?: number[];
  skillIds?: number[];
}

// Department Types
export interface Department {
  id: number;
  name: string;
  description?: string;
  location?: string;
  budget?: number;
  isActive: boolean;
  employeeCount?: number;
  employees?: DepartmentEmployee[];
  managers?: string[];
  isManager?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DepartmentEmployee {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  isManager: boolean;
}

export interface CreateDepartmentRequest {
  name: string;
  description?: string;
  location?: string;
  budget?: number;
  managerId?: number;
}

export interface UpdateDepartmentRequest {
  name?: string;
  description?: string;
  location?: string;
  budget?: number;
  managerId?: number;
}

// Skill Types
export interface Skill {
  id: number;
  name: string;
  description?: string;
  category?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSkillRequest {
  name: string;
  description?: string;
  category?: string;
}

export interface UpdateSkillRequest {
  name?: string;
  description?: string;
  category?: string;
  isActive?: boolean;
}

// Shift Template Types
export interface ShiftTemplate {
  id: number;
  name: string;
  startTime: string;
  endTime: string;
  breakDuration?: number;
  requiredStaff: number;
  departmentId: number;
  requiredSkills?: number[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateShiftTemplateRequest {
  name: string;
  startTime: string;
  endTime: string;
  breakDuration?: number;
  requiredStaff: number;
  departmentId: number;
  requiredSkills?: number[];
}

export interface UpdateShiftTemplateRequest {
  name?: string;
  startTime?: string;
  endTime?: string;
  breakDuration?: number;
  requiredStaff?: number;
  departmentId?: number;
  requiredSkills?: number[];
  isActive?: boolean;
}

// Schedule Types
export interface Schedule {
  id: number;
  name: string;
  startDate: Date;
  endDate: Date;
  status: 'draft' | 'published' | 'archived';
  departmentId?: number;
  createdBy: number;
  shifts?: Shift[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateScheduleRequest {
  name: string;
  startDate: string;
  endDate: string;
  departmentId?: number;
  templateIds?: number[];
}

export interface UpdateScheduleRequest {
  name?: string;
  startDate?: string;
  endDate?: string;
  status?: 'draft' | 'published' | 'archived';
  departmentId?: number;
}

// Shift Types
export interface Shift {
  id: number;
  scheduleId: number;
  templateId?: number;
  date: Date;
  startTime: string;
  endTime: string;
  requiredStaff: number;
  assignedStaff: number;
  departmentId: number;
  assignments?: Assignment[];
  requiredSkills?: number[];
  status: 'open' | 'filled' | 'overstaffed';
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateShiftRequest {
  scheduleId: number;
  templateId?: number;
  date: string;
  startTime: string;
  endTime: string;
  requiredStaff: number;
  departmentId: number;
  requiredSkills?: number[];
}

export interface UpdateShiftRequest {
  date?: string;
  startTime?: string;
  endTime?: string;
  requiredStaff?: number;
  departmentId?: number;
  requiredSkills?: number[];
}

// Assignment Types
export interface Assignment {
  id: number;
  shiftId: number;
  userId: number;
  status: 'scheduled' | 'confirmed' | 'declined' | 'completed';
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  shift?: Shift;
  user?: User;
}

export interface CreateAssignmentRequest {
  shiftId: number;
  userId: number;
  notes?: string;
}

export interface UpdateAssignmentRequest {
  status?: 'scheduled' | 'confirmed' | 'declined' | 'completed';
  notes?: string;
}

// Time Off Request Types
export interface TimeOffRequest {
  id: number;
  userId: number;
  startDate: Date;
  endDate: Date;
  reason?: string;
  status: 'pending' | 'approved' | 'denied';
  approvedBy?: number;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  user?: User;
}

export interface CreateTimeOffRequest {
  startDate: string;
  endDate: string;
  reason?: string;
}

export interface UpdateTimeOffRequest {
  status?: 'pending' | 'approved' | 'denied';
  notes?: string;
}

// System Settings Types
export interface SystemSetting {
  id: number;
  key: string;
  value: string;
  description?: string;
  category: string;
  dataType: 'string' | 'number' | 'boolean' | 'json';
  isSystem: boolean;
  updatedAt: Date;
}

export interface UpdateSystemSettingRequest {
  value: string;
}

// API Response Types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    code?: string;
    details?: any;
  };
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Pagination and Filtering
export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface EmployeeFilters {
  search?: string;
  department?: string;
  role?: string;
  skill?: string;
}

export interface ShiftFilters {
  department?: string;
  date?: string;
  status?: string;
}

// Authentication Types
export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: User;
}

export interface AuthUser {
  id: number;
  email: string;
  role: string;
}

// Legacy Types for Compatibility
export interface Employee extends User {}

export interface CreateEmployeeRequest extends CreateUserRequest {}

export interface UpdateEmployeeRequest extends UpdateUserRequest {}

export interface ScheduleParameters {
  maxHoursPerWeek?: number;
  minHoursBetweenShifts?: number;
  preferredDaysOff?: string[];
  skillWeighting?: number;
}

export interface OptimizationOptions {
  priority: 'coverage' | 'fairness' | 'preferences';
  allowOvertime: boolean;
  maxConsecutiveDays: number;
}
