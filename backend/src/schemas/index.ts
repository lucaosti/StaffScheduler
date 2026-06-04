import { z } from 'zod';

// ── Param schemas ─────────────────────────────────────────────────────────────

const positiveInt = z.coerce.number().int().positive();

export const idParam = z.object({ id: positiveInt });
export const userIdParam = z.object({ userId: positiveInt });
export const shiftIdParam = z.object({ shiftId: positiveInt });
export const scheduleIdParam = z.object({ scheduleId: positiveInt });
export const departmentIdParam = z.object({ departmentId: positiveInt });
export const idAndSkillIdParam = z.object({ id: positiveInt, skillId: positiveInt });
export const idAndUserIdParam = z.object({ id: positiveInt, userId: positiveInt });

// ── Body schemas ──────────────────────────────────────────────────────────────

export const createUserBody = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  roleIds: z.array(z.number().int().positive()).optional(),
  employeeId: z.string().optional(),
  phone: z.string().optional(),
  departmentIds: z.array(z.number().int().positive()).optional(),
  skillIds: z.array(z.number().int().positive()).optional(),
});

export const createScheduleBody = z.object({
  name: z.string().min(1, 'Name is required'),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().min(1, 'End date is required'),
  departmentId: z.number().int().positive(),
  templateIds: z.array(z.number().int().positive()).optional(),
  notes: z.string().optional(),
});

export const duplicateScheduleBody = z.object({
  name: z.string().min(1, 'Name is required'),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().min(1, 'End date is required'),
});

export const createShiftBody = z.object({
  scheduleId: z.number().int().positive(),
  departmentId: z.number().int().positive(),
  date: z.string().min(1, 'Date is required'),
  startTime: z.string().min(1, 'Start time is required'),
  endTime: z.string().min(1, 'End time is required'),
  minStaff: z.number().int().nonnegative(),
  maxStaff: z.number().int().positive(),
  templateId: z.number().int().positive().optional(),
  requiredSkillIds: z.array(z.number().int().positive()).optional(),
  notes: z.string().optional(),
});

export const createAssignmentBody = z.object({
  shiftId: z.number().int().positive(),
  userId: z.number().int().positive(),
  notes: z.string().optional(),
});

export const bulkCreateAssignmentsBody = z.object({
  assignments: z.array(z.object({
    shiftId: z.number().int().positive(),
    userId: z.number().int().positive(),
    notes: z.string().optional(),
  })).min(1, 'At least one assignment is required'),
});

export const createDepartmentBody = z.object({
  name: z.string().min(1, 'Department name is required'),
  managerId: z.number().int().positive().optional(),
  description: z.string().optional(),
  orgUnitId: z.number().int().positive().optional(),
});

export const addUserToDepartmentBody = z.object({
  userId: z.number().int().positive(),
});
