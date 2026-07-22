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

// ── Shared domain contract ────────────────────────────────────────────────────
// Permission, Role and UserRoleAssignment are declared once in
// @staff-scheduler/shared and re-exported here, so both sides cannot drift.
// Importing them from this barrel keeps every existing call site unchanged.
import type {
  Permission,
  Role,
  UserRoleAssignment,
  Shift,
  Schedule,
  User,
  AuditLogEntry,
  Timestamp,
} from '@staff-scheduler/shared';
export type {
  Permission,
  Role,
  UserRoleAssignment,
  Shift,
  Schedule,
  User,
  AuditLogEntry,
  Timestamp,
};


// Types for StaffScheduler Frontend (aligned with backend schema)

type ID = number | string;

// User Authentication (with N-level hierarchy)

export interface LoginResponse {
  user: User;
}

// Employee (with matrix organization support)
export interface Employee {
  id: ID; // backend user.id
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
  skills?: string[];
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

// Shift (including special shifts)

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

// Attendance tracking (clock-in / clock-out) types
export interface AttendanceRecord {
  id: ID;
  userId: ID;
  shiftAssignmentId?: ID | null;
  clockIn: string | Date;
  clockOut?: string | Date | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewerId?: ID | null;
  reviewedAt?: string | Date | null;
  reviewNotes?: string | null;
  notes?: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface AttendanceCostEstimate {
  startDate: string;
  endDate: string;
  departmentId: number | null;
  plannedHours: number;
  plannedCost: number;
  actualHours: number;
  actualCost: number;
}

// Schedule management types

// API Response types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
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

// Authentication types
export interface LoginRequest {
  email: string;
  password: string;
  /** TOTP or recovery code; required when the account has 2FA enabled. */
  totpCode?: string;
  rememberMe?: boolean;
}

export interface DashboardStats {
  totalEmployees: number;
  activeSchedules: number;
  todayShifts: number;
  pendingApprovals: number;
  monthlyHours: number;
  /** Labor cost for the month; null when the caller lacks `report.read`. */
  monthlyCost: number | null;
  coverageRate: number;
  employeeSatisfaction: number;
}


export interface Module {
  id: number;
  code: string;
  name: string;
  description: string | null;
  isEnabled: boolean;
  updatedAt: string;
}

export interface ModuleWithOrgOverride extends Module {
  effectiveEnabled: boolean;
  orgOverride: boolean | null;
}
