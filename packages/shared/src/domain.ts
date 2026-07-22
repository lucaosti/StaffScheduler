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
 * WHY ZOD SCHEMAS RATHER THAN PLAIN INTERFACES: the interfaces alone removed
 * the duplication between the two apps but left a third copy — the
 * hand-written `components.schemas` in openapi.json — which nothing compared
 * against them, and which had drifted into describing an older model
 * (`User.role`, which the API has never sent; `Permission.category`/`key`
 * instead of `code`/`resource`/`action`; `Role.isBuiltin` instead of
 * `isSystem`). Declaring each entity once as a Zod schema and deriving both
 * the TypeScript type (`z.infer`) and the OpenAPI component from it makes that
 * third copy generated too, so it cannot state something the types do not.
 *
 * @author Luca Ostinelli
 */

import { z } from 'zod';

/**
 * A point in time as it appears on either side of the wire: a `Date` when it
 * came from the database driver, an ISO string when it came from JSON.
 */
/**
 * A point in time on either side of the wire, tagged so the OpenAPI generator
 * can publish the wire form.
 *
 * The schema is the union because that is what the in-memory type genuinely
 * is: mysql2 hands the backend `Date` objects, JSON gives the frontend
 * strings, and `z.infer` must reflect both or every consumer that formats a
 * `Date` stops compiling. But over the wire a timestamp is *always* a string,
 * and `z.date()` has no JSON Schema form precisely because there is nothing
 * truthful to emit for it. The `TIMESTAMP_JSON_SCHEMA` marker lets the
 * generator replace this node with `{ type: 'string', format: 'date-time' }`
 * rather than fail or publish a lie — the one place where the published shape
 * and the in-process type legitimately differ.
 */
export const TIMESTAMP_JSON_SCHEMA = { type: 'string', format: 'date-time' } as const;
export const timestamp = z
  .union([z.string(), z.date()])
  // Marked with a plain key rather than `id`: an `id` makes Zod hoist the node
  // into a local `$defs`, which openapi-typescript cannot resolve.
  .meta({ wireFormat: 'timestamp' });
export type Timestamp = z.infer<typeof timestamp>;

/** A fixed capability code that application code checks (data, not behaviour). */
export const permissionSchema = z.object({
  id: z.number().int(),
  code: z.string(),
  resource: z.string(),
  action: z.string(),
  description: z.string().optional(),
});
export type Permission = z.infer<typeof permissionSchema>;

/** A configurable bundle of permissions. System roles cannot be deleted. */
export const roleSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  description: z.string().optional(),
  isSystem: z.boolean(),
  permissions: z.array(z.string()).optional(),
  createdAt: timestamp.optional(),
  updatedAt: timestamp.optional(),
});
export type Role = z.infer<typeof roleSchema>;

/** A role granted to a user, optionally scoped to an org unit and time-bound. */
export const userRoleAssignmentSchema = z.object({
  roleId: z.number().int(),
  roleName: z.string(),
  scopeOrgUnitId: z.number().int().nullable().optional(),
  expiresAt: timestamp.nullable().optional(),
});
export type UserRoleAssignment = z.infer<typeof userRoleAssignmentSchema>;

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
export const shiftSchema = z.object({
  id: z.number().int(),
  scheduleId: z.number().int(),
  scheduleName: z.string().optional(),
  departmentId: z.number().int(),
  departmentName: z.string().optional(),
  templateId: z.number().int().optional(),
  /** Calendar date, `YYYY-MM-DD`. */
  date: timestamp,
  /** `HH:MM` (24h). */
  startTime: z.string(),
  /** `HH:MM` (24h). */
  endTime: z.string(),
  minStaff: z.number().int(),
  maxStaff: z.number().int(),
  assignedStaff: z.number().int(),
  status: z.enum(['open', 'assigned', 'confirmed', 'cancelled']),
  notes: z.string().nullable().optional(),
  createdAt: timestamp.optional(),
  updatedAt: timestamp.optional(),
});
export type Shift = z.infer<typeof shiftSchema>;

/**
 * A period-based plan for a department, as the API returns it.
 *
 * The frontend copy additionally declared `description?`, which the API never
 * sends — the server persists that value as `notes` (the create/update service
 * already maps one to the other). Backend-only enrichments (`departmentOrgUnitId`,
 * and the nested `shifts` returned by the with-shifts endpoint) stay on the
 * backend type, which extends this one.
 */
export const scheduleSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  startDate: timestamp,
  endDate: timestamp,
  status: z.enum(['draft', 'published', 'archived']),
  departmentId: z.number().int().optional(),
  departmentName: z.string().optional(),
  createdBy: z.number().int().optional(),
  createdByName: z.string().optional(),
  publishedBy: z.number().int().optional(),
  publishedAt: timestamp.optional(),
  totalShifts: z.number().int().optional(),
  totalAssignments: z.number().int().optional(),
  notes: z.string().nullable().optional(),
  createdAt: timestamp.optional(),
  updatedAt: timestamp.optional(),
});
export type Schedule = z.infer<typeof scheduleSchema>;

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
export const userSchema = z.object({
  id: z.number().int(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  employeeId: z.string().optional(),
  phone: z.string().optional(),
  position: z.string().optional(),
  hourlyRate: z.number().optional(),
  isActive: z.boolean(),
  lastLogin: timestamp.optional(),
  /** Roles assigned to the user, each optionally scoped to an org unit. */
  roles: z.array(userRoleAssignmentSchema).optional(),
  /** Flattened, de-duplicated effective permission codes (e.g. `schedule.manage`). */
  permissions: z.array(z.string()).optional(),
  /** Named org for per-org module overrides; null when the user has none. */
  organizationName: z.string().nullable().optional(),
  createdAt: timestamp.optional(),
  updatedAt: timestamp.optional(),
});
export type User = z.infer<typeof userSchema>;

/**
 * A department, as the API returns it.
 *
 * The hand-written component published `memberCount`, a field that exists
 * nowhere in the codebase — the real one is `employeeCount` — so any client
 * generated from it carried a property that was always `undefined`. Same class
 * as `User.role`.
 */
export const departmentSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  description: z.string().optional(),
  managerId: z.number().int().optional(),
  managerName: z.string().optional(),
  /** Parent org-unit FK. Absent when the department is not linked to one. */
  orgUnitId: z.number().int().optional(),
  isActive: z.boolean(),
  employeeCount: z.number().int().optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type Department = z.infer<typeof departmentSchema>;

/**
 * A scoped business policy.
 *
 * The hand-written component described a different model entirely —
 * `key`/`label`/`value`/`valueType`/`category` — where the service has always
 * had `scopeType`/`scopeId`/`policyKey`/`policyValue`/`imposedByUserId`.
 */
export const policySchema = z.object({
  id: z.number().int(),
  scopeType: z.enum(['global', 'org_unit', 'department', 'user']),
  scopeId: z.number().int().nullable(),
  policyKey: z.string(),
  /** Shape depends on policyKey; validated by the policy engine, not here. */
  policyValue: z.unknown(),
  description: z.string().nullable(),
  imposedByUserId: z.number().int(),
  isActive: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type Policy = z.infer<typeof policySchema>;

/**
 * A time-off request.
 *
 * The hand-written component published `reviewedBy`, which does not exist —
 * the reviewer FK is `reviewerId` — and omitted `reviewedAt`, `reviewNotes`
 * and `unavailabilityId`.
 */
export const timeOffRequestSchema = z.object({
  id: z.number().int(),
  userId: z.number().int(),
  startDate: z.string(),
  endDate: z.string(),
  type: z.enum(['vacation', 'sick', 'personal', 'other']),
  reason: z.string().nullable(),
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']),
  reviewerId: z.number().int().nullable(),
  reviewedAt: timestamp.nullable(),
  reviewNotes: z.string().nullable(),
  /** Set when an approved request materialised an unavailability row. */
  unavailabilityId: z.number().int().nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type TimeOffRequest = z.infer<typeof timeOffRequestSchema>;

/**
 * A node in the organisational tree.
 *
 * The hand-written component omitted `description`, `managerUserId`,
 * `isActive`, `createdAt` and `updatedAt` — an incompleteness rather than a
 * falsehood, but one that left half the entity invisible to any generated
 * client.
 */
export const orgUnitSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  description: z.string().nullable(),
  parentId: z.number().int().nullable(),
  managerUserId: z.number().int().nullable(),
  isActive: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type OrgUnit = z.infer<typeof orgUnitSchema>;

/** A proposed swap of two assignments between two employees. */
export const shiftSwapRequestSchema = z.object({
  id: z.number().int(),
  requesterUserId: z.number().int(),
  requesterAssignmentId: z.number().int(),
  targetUserId: z.number().int(),
  targetAssignmentId: z.number().int(),
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']),
  notes: z.string().nullable(),
  reviewerId: z.number().int().nullable(),
  reviewedAt: timestamp.nullable(),
  reviewNotes: z.string().nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type ShiftSwapRequest = z.infer<typeof shiftSwapRequestSchema>;

/**
 * One append-only audit record.
 *
 * The hand-written component omitted precisely the substance of the trail —
 * who acted (`userId`), on whose behalf (`onBehalfOfUserId`), with what
 * `justification`, from where (`ipAddress`, `userAgent`), under which
 * `requestId`, and the `beforeSnapshot`/`afterSnapshot` pair that makes a
 * record reconstructable. A consumer reading the published contract would
 * conclude the audit log carries far less than it does.
 */
export const auditLogEntrySchema = z.object({
  id: z.number().int(),
  userId: z.number().int().nullable(),
  /** Set when the action was performed for another user (proxy / approval). */
  onBehalfOfUserId: z.number().int().nullable(),
  action: z.string(),
  entityType: z.string().nullable(),
  entityId: z.number().int().nullable(),
  description: z.string().nullable(),
  justification: z.string().nullable(),
  beforeSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  afterSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  /** Correlates the record with the request that produced it. */
  requestId: z.string().nullable(),
  createdAt: timestamp,
});
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

/**
 * One employee assigned to one shift, as the API returns it.
 *
 * The hand-written component was already accurate; deriving it removes the
 * last domain entity from the hand-maintained surface, leaving only the
 * envelope types (`ApiSuccess`, `ApiError`, `PaginationMeta`), which describe
 * the response wrapper rather than a domain entity and have no schema to
 * derive from.
 */
export const shiftAssignmentSchema = z.object({
  id: z.number().int(),
  shiftId: z.number().int(),
  userId: z.number().int(),
  userName: z.string().optional(),
  userEmail: z.string().optional(),
  shiftDate: timestamp.optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  departmentId: z.number().int().optional(),
  departmentName: z.string().optional(),
  status: z.enum(['pending', 'confirmed', 'cancelled', 'completed']),
  assignedAt: timestamp,
  confirmedAt: timestamp.optional(),
  notes: z.string().optional(),
});
export type ShiftAssignment = z.infer<typeof shiftAssignmentSchema>;
