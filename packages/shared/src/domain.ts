/**
 * Shared domain types — the entities both the API and the UI speak about.
 *
 * WHY THIS FILE EXISTS: these types were declared twice, by hand, in
 * `backend/src/types/index.ts` and `frontend/src/types/index.ts`. That is the
 * duplication this package was created to remove, and it had already drifted in
 * practice, so the two sides were quietly modelling the same entity
 * differently. Declaring them once here makes divergence a compile error
 * instead of a runtime surprise.
 *
 * WHY TIMESTAMPS ARE `Timestamp = string | Date`: the single systematic
 * difference between the two old copies was the timestamp representation — the
 * backend receives `Date` objects from mysql2, the frontend receives ISO
 * strings over JSON. Rather than pick one and force casts on the other side (or
 * introduce a generic that infects every consumer), the shared type admits
 * both. This is not a new compromise: `Schedule.startDate` was already declared
 * `string | Date` in *both* copies, so this simply makes the existing,
 * pragmatic convention explicit and uniform. Consumers that need a concrete
 * type narrow at the point of use.
 *
 * Both `types/index.ts` barrels re-export these, so no call site had to change
 * when they moved here.
 *
 * @author Luca Ostinelli
 */

/**
 * A point in time as it appears on either side of the wire: a `Date` when it
 * came from the database driver, an ISO string when it came from JSON.
 */
export type Timestamp = string | Date;

/** A fixed capability code that application code checks (data, not behaviour). */
export interface Permission {
  id: number;
  code: string;
  resource: string;
  action: string;
  description?: string;
}

/** A configurable bundle of permissions. System roles cannot be deleted. */
export interface Role {
  id: number;
  name: string;
  description?: string;
  isSystem: boolean;
  permissions?: string[];
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

/** A role granted to a user, optionally scoped to an org unit and time-bound. */
export interface UserRoleAssignment {
  roleId: number;
  roleName: string;
  scopeOrgUnitId?: number | null;
  expiresAt?: Timestamp | null;
}

/**
 * A single time slot within a schedule, as the API returns it.
 *
 * WHY THIS SHAPE: the two hand-written copies disagreed on more than dates. The
 * frontend made `scheduleId`, `departmentId`, `minStaff` and `maxStaff`
 * optional, declared `requiredSkills` as `string[]` where the backend used
 * `Skill[]`, and carried a block of "legacy" fields (`minimumStaff`,
 * `maximumStaff`, `department`, `position`, `rolesRequired`, `specialType`,
 * `priority`, `location`, …). An audit of the frontend showed every one of those
 * legacy fields was either never read or read only as a `??` fallback for a
 * field the API always sends — so they described a shape the server never
 * produced, and the optional markers made call sites defend against absences
 * that cannot happen.
 *
 * This interface is therefore the API's actual contract: required where the
 * server always sends a value. Backend-only enrichments that never cross the
 * wire in this form (`requiredSkills: Skill[]`, `assignments`) stay on the
 * backend's own type, which extends this one — so the shared fields cannot
 * drift while the richer server model is preserved.
 */
export interface Shift {
  id: number;
  scheduleId: number;
  scheduleName?: string;
  departmentId: number;
  departmentName?: string;
  templateId?: number;
  /** Calendar date, `YYYY-MM-DD`. */
  date: Timestamp;
  /** `HH:MM` (24h). */
  startTime: string;
  /** `HH:MM` (24h). */
  endTime: string;
  minStaff: number;
  maxStaff: number;
  assignedStaff: number;
  status: 'open' | 'assigned' | 'confirmed' | 'cancelled';
  notes?: string | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

/**
 * A period-based plan for a department, as the API returns it.
 *
 * The frontend copy additionally declared `description?`, which the API never
 * sends — the server persists that value as `notes` (the create/update service
 * already maps one to the other). Backend-only enrichments (`departmentOrgUnitId`,
 * and the nested `shifts` returned by the with-shifts endpoint) stay on the
 * backend type, which extends this one.
 */
export interface Schedule {
  id: number;
  name: string;
  startDate: Timestamp;
  endDate: Timestamp;
  status: 'draft' | 'published' | 'archived';
  departmentId?: number;
  departmentName?: string;
  createdBy?: number;
  createdByName?: string;
  publishedBy?: number;
  publishedAt?: Timestamp;
  totalShifts?: number;
  totalAssignments?: number;
  notes?: string | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

/**
 * A person with a system account, as the API returns it.
 *
 * WHY THE OLD FRONTEND COPY WAS A PROBLEM, beyond duplication: it declared
 * `passwordHash`, `salt`, `resetToken`, `resetTokenExpiry` and
 * `notificationToken` on a type consumed by the browser. Nothing read them
 * (verified), but declaring credential fields on a client-side model invites
 * code that does, and quietly asserts that the API might send them — which it
 * must never do. They are gone.
 *
 * It also declared `role?: string`, which the API does not send: authorisation
 * is the RBAC model (`roles`, plus flattened `permissions`). Anything rendering
 * `user.role` was rendering `undefined`.
 *
 * Backend-only enrichments (`allowedOrgUnitIds`, `delegationScopes`,
 * `departments`, `skills`, `preferences`, …) stay on the backend type, which
 * extends this one.
 */
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
  lastLogin?: Timestamp;
  /** Roles assigned to the user, each optionally scoped to an org unit. */
  roles?: UserRoleAssignment[];
  /** Flattened, de-duplicated effective permission codes (e.g. `schedule.manage`). */
  permissions?: string[];
  /** Named org for per-org module overrides; null when the user has none. */
  organizationName?: string | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}
