export interface User {
  id: number;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'manager' | 'employee';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Employee {
  id: number;
  userId: number;
  employeeCode: string;
  department: string;
  position: string;
  hourlyRate: number;
  maxHoursPerWeek: number;
  skills: string[];
  availability: EmployeeAvailability[];
  hierarchyPath: string;
  managerId?: number;
  isActive: boolean;
  hireDate: string;
  user: User;
}

export interface EmployeeAvailability {
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday, 6 = Saturday
  startTime: string; // HH:mm format
  endTime: string; // HH:mm format
  isAvailable: boolean;
}

export interface Shift {
  id: number;
  name: string;
  startTime: string; // HH:mm format
  endTime: string; // HH:mm format
  requiredEmployees: number;
  department: string;
  requiredSkills: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ShiftAssignment {
  id: number;
  employeeId: number;
  shiftId: number;
  date: string; // YYYY-MM-DD format
  status: 'scheduled' | 'confirmed' | 'completed' | 'cancelled';
  notes?: string;
  createdAt: string;
  updatedAt: string;
  employee: Employee;
  shift: Shift;
}

export interface Schedule {
  id: number;
  name: string;
  startDate: string; // YYYY-MM-DD format
  endDate: string; // YYYY-MM-DD format
  status: 'draft' | 'published' | 'finalized';
  assignments: ShiftAssignment[];
  createdAt: string;
  updatedAt: string;
}

export interface OptimizationRequest {
  scheduleId: number;
  constraints: OptimizationConstraints;
  preferences: OptimizationPreferences;
}

export interface OptimizationConstraints {
  respectAvailability: boolean;
  maxConsecutiveDays: number;
  minRestHours: number;
  maxHoursPerWeek: number;
  requiredSkillsMatch: boolean;
  fairWorkloadDistribution: boolean;
}

export interface OptimizationPreferences {
  preferredEmployees: { shiftId: number; employeeIds: number[] }[];
  avoidEmployees: { shiftId: number; employeeIds: number[] }[];
  prioritizeFullTime: boolean;
  balanceExperience: boolean;
}

export interface OptimizationResult {
  success: boolean;
  assignments: ShiftAssignment[];
  metrics: {
    totalCost: number;
    coveragePercentage: number;
    employeeSatisfaction: number;
    workloadBalance: number;
  };
  warnings: string[];
  errors: string[];
}

export interface Report {
  id: number;
  type: 'employee_hours' | 'cost_analysis' | 'coverage_report' | 'custom';
  name: string;
  parameters: Record<string, any>;
  generatedAt: string;
  data: any;
}

export interface Notification {
  id: number;
  userId: number;
  type: 'info' | 'warning' | 'error' | 'success';
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  errors?: string[];
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  user: User;
  token: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  color?: string;
  employee?: Employee;
  shift?: Shift;
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

export interface ChartData {
  labels: string[];
  datasets: {
    label: string;
    data: number[];
    backgroundColor?: string | string[];
    borderColor?: string | string[];
    borderWidth?: number;
  }[];
}
