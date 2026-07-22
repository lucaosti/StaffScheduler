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
export const userIdAndRoleIdParam = z.object({ userId: positiveInt, roleId: positiveInt });

const shortString = z.string().min(1).max(64);

export const idAndKeyParam = z.object({ id: positiveInt, key: z.string().min(1).max(128) });
export const codeParam = z.object({ code: shortString });
export const typeParam = z.object({ type: shortString });
export const changeTypeParam = z.object({ changeType: shortString });
export const categoryParam = z.object({ category: shortString });
export const categoryKeyParam = z.object({ category: shortString, key: z.string().min(1).max(128) });

// ── Shared field formats ──────────────────────────────────────────────────────

/** 24-hour wall-clock time, "HH:MM" or "HH:MM:SS". */
const timeString = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Time must be in 24-hour HH:MM format');

/** Calendar date, "YYYY-MM-DD". */
const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format');

/**
 * Cross-field rules shared by shift-like payloads. Each check only fires when
 * both fields are present, so the same helpers work for create (required
 * fields) and update (optional fields) schemas.
 *
 * Overnight shifts (endTime <= startTime) are rejected: conflict detection
 * and hour accounting assume a shift starts and ends on the same calendar day.
 */
const timeOrder = (data: { startTime?: string; endTime?: string }): boolean =>
  data.startTime === undefined || data.endTime === undefined || data.startTime < data.endTime;
const TIME_ORDER_MESSAGE = {
  message: 'endTime must be after startTime (overnight shifts are not supported)',
  path: ['endTime'],
};

const dateOrder = (data: { startDate?: string; endDate?: string }): boolean =>
  data.startDate === undefined || data.endDate === undefined || data.startDate <= data.endDate;
const DATE_ORDER_MESSAGE = {
  message: 'endDate must not be before startDate',
  path: ['endDate'],
};

const staffOrder = (data: { minStaff?: number; maxStaff?: number }): boolean =>
  data.minStaff === undefined || data.maxStaff === undefined || data.minStaff <= data.maxStaff;
const STAFF_ORDER_MESSAGE = {
  message: 'maxStaff must be greater than or equal to minStaff',
  path: ['maxStaff'],
};

// ── Body schemas ──────────────────────────────────────────────────────────────

export const createUserBody = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  roleIds: z.array(z.number().int().positive()).optional(),
  employeeId: z.string().optional(),
  phone: z.string().optional(),
  position: z.string().optional(),
  hourlyRate: z.number().nonnegative().optional(),
  departmentIds: z.array(z.number().int().positive()).optional(),
  skillIds: z.array(z.number().int().positive()).optional(),
});

export const createScheduleBody = z.object({
  name: z.string().min(1, 'Name is required'),
  startDate: dateString,
  endDate: dateString,
  departmentId: z.number().int().positive(),
  templateIds: z.array(z.number().int().positive()).optional(),
  notes: z.string().optional(),
}).refine(dateOrder, DATE_ORDER_MESSAGE);

export const duplicateScheduleBody = z.object({
  name: z.string().min(1, 'Name is required'),
  startDate: dateString,
  endDate: dateString,
}).refine(dateOrder, DATE_ORDER_MESSAGE);

export const createShiftBody = z.object({
  scheduleId: z.number().int().positive(),
  departmentId: z.number().int().positive(),
  date: dateString,
  startTime: timeString,
  endTime: timeString,
  minStaff: z.number().int().nonnegative(),
  maxStaff: z.number().int().positive(),
  templateId: z.number().int().positive().optional(),
  requiredSkillIds: z.array(z.number().int().positive()).optional(),
  notes: z.string().optional(),
}).refine(timeOrder, TIME_ORDER_MESSAGE).refine(staffOrder, STAFF_ORDER_MESSAGE);

export const createAssignmentBody = z.object({
  shiftId: z.number().int().positive(),
  userId: z.number().int().positive(),
  notes: z.string().optional(),
  reason: z.string().max(2000).optional(),
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

export const updateUserBody = z.object({
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  roleIds: z.array(z.number().int().positive()).optional(),
  employeeId: z.string().optional(),
  phone: z.string().optional(),
  position: z.string().optional(),
  hourlyRate: z.number().nonnegative().optional(),
  isActive: z.boolean().optional(),
  organizationName: z.string().max(120).nullable().optional(),
});

export const updateScheduleBody = z.object({
  name: z.string().min(1).optional(),
  startDate: dateString.optional(),
  endDate: dateString.optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  departmentId: z.number().int().positive().optional(),
  notes: z.string().optional(),
}).refine(dateOrder, DATE_ORDER_MESSAGE);

export const updateAssignmentBody = z.object({
  status: z.string().optional(),
  notes: z.string().optional(),
  reason: z.string().max(2000).optional(),
});

/**
 * Query contracts for list endpoints.
 *
 * WHY THESE EXIST: `parameters` in openapi.json used to be hand-curated prose
 * that nothing compared against the code, so six endpoints documented filters
 * their handlers never read — a caller narrowing by `userId` or `isActive`
 * silently received everything. Declaring the accepted query as a schema, and
 * generating the spec's `parameters` from it (see scripts/generate-openapi.ts),
 * makes the published contract and the parsing code the same artefact.
 *
 * Each schema below is the *whole* query contract for its endpoint: anything
 * not listed here is not accepted, and anything listed here is documented.
 */

/** Boolean flags arrive as the strings "true"/"false" in a query string. */
const booleanFlag = z
  .union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')])
  .optional();

/**
 * Shared page/pageSize contract. Endpoints compose this into their own query
 * schema so the parameters are documented, rather than being invisible to the
 * spec because the pagination middleware reads `req.query` directly.
 */
export const paginationQuery = {
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(200).optional(),
};

export const departmentListQuery = z.object({
  search: shortString.optional(),
  isActive: booleanFlag,
  orgUnitId: positiveInt.optional(),
});

export const scheduleListQuery = z.object({
  departmentId: positiveInt.optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  startDate: dateString.optional(),
  endDate: dateString.optional(),
  ...paginationQuery,
}).refine(dateOrder, DATE_ORDER_MESSAGE);

export const employeeListQuery = z.object({
  search: shortString.optional(),
  /** Numeric id or department name — resolved by the route. */
  department: shortString.optional(),
  isActive: booleanFlag,
  ...paginationQuery,
});

export const userListQuery = z.object({
  search: shortString.optional(),
  department: shortString.optional(),
  roleId: positiveInt.optional(),
  isActive: booleanFlag,
  ...paginationQuery,
});

export const shiftListQuery = z.object({
  scheduleId: positiveInt.optional(),
  departmentId: positiveInt.optional(),
  /** Convenience for a single day; equivalent to startDate = endDate = date. */
  date: dateString.optional(),
  startDate: dateString.optional(),
  endDate: dateString.optional(),
  status: z.enum(['open', 'assigned', 'confirmed', 'cancelled']).optional(),
  ...paginationQuery,
}).refine(dateOrder, DATE_ORDER_MESSAGE);

/**
 * Reporting date range.
 *
 * The spec published `startDate`/`endDate` while the handlers read `start`/`end`,
 * so a client following the documentation got a 400. The documented names win;
 * the old ones stay accepted as aliases so no existing caller breaks.
 */
export const reportRangeQuery = z.object({
  startDate: dateString.optional(),
  endDate: dateString.optional(),
  start: dateString.optional(),
  end: dateString.optional(),
  departmentId: positiveInt.optional(),
});

export const auditLogListQuery = z.object({
  userId: positiveInt.optional(),
  onBehalfOfUserId: positiveInt.optional(),
  action: shortString.optional(),
  entityType: shortString.optional(),
  entityId: positiveInt.optional(),
  fromDate: dateString.optional(),
  toDate: dateString.optional(),
  requestId: shortString.optional(),
  /** Legacy pairing, kept alongside page/pageSize for existing callers. */
  limit: z.coerce.number().int().positive().max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  ...paginationQuery,
});

export const auditLogExportQuery = z.object({
  format: z.enum(['csv', 'json']).optional(),
  userId: positiveInt.optional(),
  onBehalfOfUserId: positiveInt.optional(),
  action: shortString.optional(),
  entityType: shortString.optional(),
  entityId: positiveInt.optional(),
  fromDate: dateString.optional(),
  toDate: dateString.optional(),
  requestId: shortString.optional(),
});

/**
 * Calendar feeds authenticate by opaque token, not by session cookie.
 *
 * The token is optional *to the schema* on purpose: a missing one must produce
 * the handler's `401 text/plain`, which is what an iCal client subscribing to
 * the URL expects, not a JSON 400 from the validation middleware. The schema
 * still bounds the value and documents the parameter.
 */
export const calendarFeedQuery = z.object({
  token: z.string().min(1).max(255).optional(),
});

export const changeRequestListQuery = z.object({
  proposerUserId: positiveInt.optional(),
  approverUserId: positiveInt.optional(),
  status: shortString.optional(),
  changeType: shortString.optional(),
  targetEntityType: shortString.optional(),
  limit: z.coerce.number().int().positive().max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/** Comma-separated list of user ids to render as vCards. */
export const vcardQuery = z.object({
  ids: z.string().min(1).max(2000),
});

export const onCallMineQuery = z.object({
  start: dateString.optional(),
  end: dateString.optional(),
});

export const onCallPeriodListQuery = z.object({
  departmentId: positiveInt.optional(),
  status: shortString.optional(),
  start: dateString.optional(),
  end: dateString.optional(),
});

export const responsibilityRuleListQuery = z.object({
  subjectType: shortString.optional(),
  permissionCode: shortString.optional(),
  responsibleOrgUnitId: positiveInt.optional(),
  isActive: booleanFlag,
});

export const responsibilityRuleResolveQuery = z.object({
  permissionCode: z.string().min(1).max(80),
  orgUnitId: positiveInt.optional(),
  /** Comma-separated numeric ids. */
  departmentIds: z.string().max(2000).optional(),
  roleIds: z.string().max(2000).optional(),
});

export const skillGapQuery = z.object({
  departmentId: positiveInt,
  start: dateString,
  end: dateString,
});

export const timeOffListQuery = z.object({
  status: shortString.optional(),
  userId: positiveInt.optional(),
});

/**
 * Free-text audit justification on a destructive action (role revocation,
 * delegation removal). Optional, but bounded: these were read straight off
 * `req.body` with only a `typeof === 'string'` guard, so they were
 * undocumented and unbounded in length.
 */
export const auditJustificationBody = z.object({
  justification: z.string().max(2000).nullable().optional(),
});

/** Free-text reason recorded with a publish or a deletion. */
export const auditReasonBody = z.object({
  reason: z.string().max(2000).optional(),
});

export const assignmentsByDepartmentQuery = z.object({
  status: z.enum(['pending', 'confirmed', 'completed', 'cancelled']).optional(),
});

export const shiftSwapListQuery = z.object({
  userId: positiveInt.optional(),
  status: shortString.optional(),
});

export const notificationListQuery = z.object({
  /** `1` means "unread only"; kept as the historical spelling. */
  unreadOnly: z.enum(['0', '1']).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

export const employeeLoanListQuery = z.object({
  userId: positiveInt.optional(),
  toOrgUnitId: positiveInt.optional(),
  fromOrgUnitId: positiveInt.optional(),
  status: shortString.optional(),
});

export const policyExceptionListQuery = z.object({
  policyId: positiveInt.optional(),
  targetType: shortString.optional(),
  targetId: positiveInt.optional(),
  status: shortString.optional(),
  requestedByUserId: positiveInt.optional(),
});

/** Scoped role revocation targets one org-unit grant rather than all of them. */
export const roleRevokeQuery = z.object({
  scopeOrgUnitId: positiveInt.optional(),
});

export const pendingApprovalListQuery = z.object({
  status: shortString.optional(),
});

export const attendanceListQuery = z.object({
  userId: positiveInt.optional(),
  status: shortString.optional(),
  startDate: dateString.optional(),
  endDate: dateString.optional(),
});

export const costEstimateQuery = z.object({
  startDate: dateString,
  endDate: dateString,
  departmentId: positiveInt.optional(),
}).refine(dateOrder, DATE_ORDER_MESSAGE);

/**
 * Query filters accepted by `GET /assignments`.
 *
 * These were already published in the OpenAPI spec but the route ignored them
 * entirely, so callers narrowing by `userId` silently received every
 * assignment in the system. Declaring them as a schema means the documented
 * contract and the parsing code are the same artefact and cannot drift again.
 *
 * `page` / `pageSize` are composed in so the spec documents them; the
 * pagination middleware still reads them from `req.query` directly.
 */
export const assignmentListQuery = z.object({
  shiftId: positiveInt.optional(),
  userId: positiveInt.optional(),
  scheduleId: positiveInt.optional(),
  departmentId: positiveInt.optional(),
  status: z.enum(['pending', 'confirmed', 'completed', 'cancelled']).optional(),
  startDate: dateString.optional(),
  endDate: dateString.optional(),
  ...paginationQuery,
}).refine(dateOrder, DATE_ORDER_MESSAGE);

export const createShiftTemplateBody = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  departmentId: z.number().int().positive(),
  startTime: timeString,
  endTime: timeString,
  minStaff: z.number().int().nonnegative(),
  maxStaff: z.number().int().positive(),
}).refine(timeOrder, TIME_ORDER_MESSAGE).refine(staffOrder, STAFF_ORDER_MESSAGE);

export const updateShiftTemplateBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  startTime: timeString.optional(),
  endTime: timeString.optional(),
  minStaff: z.number().int().nonnegative().optional(),
  maxStaff: z.number().int().positive().optional(),
}).refine(timeOrder, TIME_ORDER_MESSAGE).refine(staffOrder, STAFF_ORDER_MESSAGE);

const approvalStepBody = z.object({
  stepOrder: z.number().int().positive(),
  approverScope: z.enum(['policy_owner', 'unit_manager', 'unit_manager_chain', 'company_role', 'company_user']),
  approverRoleId: z.number().int().positive().nullable().optional(),
  approverUserId: z.number().int().positive().nullable().optional(),
  autoApproveForOwner: z.boolean().optional(),
  escalateAfterHours: z.number().int().positive().nullable().optional(),
});

export const createApprovalWorkflowBody = z.object({
  changeType: z.string().min(1, 'changeType is required'),
  requireAll: z.boolean().optional(),
  description: z.string().optional(),
  steps: z.array(approvalStepBody).min(1, 'At least one step is required'),
});

export const updateApprovalWorkflowBody = z.object({
  requireAll: z.boolean().optional(),
  description: z.string().optional(),
  steps: z.array(approvalStepBody).optional(),
});

export const updateDepartmentBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  managerId: z.number().int().positive().optional(),
  orgUnitId: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
});

export const createTimeOffBody = z.object({
  startDate: dateString,
  endDate: dateString,
  type: z.enum(['vacation', 'sick', 'personal', 'other']).optional(),
  reason: z.string().optional(),
}).refine(dateOrder, DATE_ORDER_MESSAGE);

export const clockInBody = z.object({
  notes: z.string().max(2000).optional(),
});

export const createShiftSwapBody = z.object({
  requesterAssignmentId: z.number().int().positive(),
  targetAssignmentId: z.number().int().positive(),
  notes: z.string().optional(),
});

export const createDelegationBody = z.object({
  delegateeId: z.number().int().positive(),
  permissionCodes: z.array(z.string()).min(1, 'At least one permission code is required'),
  expiresAt: z.string().min(1, 'expiresAt is required'),
  scopeOrgUnitId: z.number().int().positive().nullable().optional(),
  justification: z.string().max(1000).nullable().optional(),
});

export const createOnCallPeriodBody = z.object({
  departmentId: z.number().int().positive(),
  date: dateString,
  startTime: timeString,
  endTime: timeString,
  scheduleId: z.number().int().positive().nullable().optional(),
  minStaff: z.number().int().nonnegative().optional(),
  maxStaff: z.number().int().positive().optional(),
  notes: z.string().optional(),
}).refine(timeOrder, TIME_ORDER_MESSAGE).refine(staffOrder, STAFF_ORDER_MESSAGE);

export const updateOnCallPeriodBody = z.object({
  date: dateString.optional(),
  startTime: timeString.optional(),
  endTime: timeString.optional(),
  minStaff: z.number().int().nonnegative().optional(),
  maxStaff: z.number().int().positive().optional(),
  notes: z.string().nullable().optional(),
  status: z.enum(['open', 'assigned', 'cancelled']).optional(),
}).refine(timeOrder, TIME_ORDER_MESSAGE).refine(staffOrder, STAFF_ORDER_MESSAGE);

export const onCallAssignBody = z.object({
  userId: z.number().int().positive(),
  notes: z.string().nullable().optional(),
});

export const updateShiftBody = z.object({
  date: dateString.optional(),
  startTime: timeString.optional(),
  endTime: timeString.optional(),
  minStaff: z.number().int().nonnegative().optional(),
  maxStaff: z.number().int().positive().optional(),
  status: z.enum(['open', 'assigned', 'confirmed', 'cancelled']).optional(),
  requiredSkillIds: z.array(z.number().int().positive()).optional(),
  notes: z.string().nullable().optional(),
}).refine(timeOrder, TIME_ORDER_MESSAGE).refine(staffOrder, STAFF_ORDER_MESSAGE);

export const addEmployeeSkillBody = z.object({
  skillId: z.number().int().positive(),
  proficiencyLevel: z.number().int().min(1).max(5),
});

export const createRoleBody = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  permissionCodes: z.array(z.string()).optional(),
});

export const updateRoleBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  permissionCodes: z.array(z.string()).optional(),
});

export const createOrgUnitBody = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  parentId: z.number().int().positive().nullable().optional(),
  managerUserId: z.number().int().positive().nullable().optional(),
});

export const updateOrgUnitBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  parentId: z.number().int().positive().nullable().optional(),
  managerUserId: z.number().int().positive().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const addOrgMemberBody = z.object({
  userId: z.number().int().positive(),
  isPrimary: z.boolean().optional(),
});

export const createLoanBody = z.object({
  userId: z.number().int().positive(),
  fromOrgUnitId: z.number().int().positive(),
  toOrgUnitId: z.number().int().positive(),
  startDate: dateString,
  endDate: dateString,
  reason: z.string().optional(),
}).refine(dateOrder, DATE_ORDER_MESSAGE);

export const createPolicyExceptionBody = z.object({
  policyId: z.number().int().positive(),
  targetType: z.string().min(1, 'Target type is required'),
  targetId: z.number().int().positive(),
  reason: z.string().nullable().optional(),
});

export const createPolicyBody = z.object({
  scopeType: z.enum(['global', 'org_unit', 'schedule', 'shift_template']),
  scopeId: z.number().int().positive().nullable().optional(),
  policyKey: z.string().min(1, 'Policy key is required'),
  policyValue: z.unknown(),
  description: z.string().nullable().optional(),
});

export const updatePolicyBody = z.object({
  scopeType: z.enum(['global', 'org_unit', 'schedule', 'shift_template']).optional(),
  scopeId: z.number().int().positive().nullable().optional(),
  policyKey: z.string().min(1).optional(),
  policyValue: z.unknown().optional(),
  description: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const twoFactorCodeBody = z.object({
  code: z.string().min(1, 'code is required'),
});

export const upsertPreferencesBody = z.object({
  maxHoursPerWeek: z.number().positive().optional(),
  minHoursPerWeek: z.number().nonnegative().optional(),
  maxConsecutiveDays: z.number().int().min(1).max(14).optional(),
  preferredShifts: z.array(z.number().int().positive()).optional(),
  avoidShifts: z.array(z.number().int().positive()).optional(),
  notes: z.string().nullable().optional(),
});

export const moduleEnabledBody = z.object({
  isEnabled: z.boolean(),
  justification: z.string().max(1000).nullable().optional(),
});

export const directoryFieldsBody = z.object({
  fields: z.array(z.object({
    key: z.string().min(1),
    value: z.unknown(),
  })),
});

export const validateAssignmentBody = z.object({
  userId: z.number().int().positive(),
  shiftId: z.number().int().positive(),
});

export const updateApprovalMatrixBody = z.object({
  approverScope: z.enum(['policy_owner', 'unit_manager', 'unit_manager_chain', 'company_role', 'company_user']).optional(),
  approverRoleId: z.number().int().positive().nullable().optional(),
  approverUserId: z.number().int().positive().nullable().optional(),
  autoApproveForOwner: z.boolean().optional(),
  description: z.string().nullable().optional(),
});

export const updateCurrencyBody = z.object({
  currency: z.enum(['EUR', 'USD']),
});

export const updateTimePeriodBody = z.object({
  timePeriod: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
});

export const updateSettingValueBody = z.object({
  value: z.string(),
});

export const loginBody = z.object({
  email: z.string().min(1, 'email is required'),
  password: z.string().min(1, 'password is required'),
  // TOTP or recovery code; required only when the account has 2FA enabled.
  totpCode: z.string().min(1).optional(),
});

export const optionalNotesBody = z.object({
  notes: z.string().max(2000).nullable().optional(),
});

export const bulkImportEmployeesBody = z.object({
  csv: z.string().min(1, 'csv is required'),
  defaultPassword: z.string().min(8, 'defaultPassword must be at least 8 characters'),
});

export const bulkImportShiftsBody = z.object({
  csv: z.string().min(1, 'csv is required'),
});

export const importVcardBody = z.object({
  vcf: z.string().min(1, 'vcf is required'),
  defaultPassword: z.string().min(8, 'defaultPassword must be at least 8 characters'),
});

// ─── Schemas promoted from route files (single-source contract) ──────────────
// These lived next to their routers until the OpenAPI spec became generated
// from this package: every request shape the API accepts must be defined
// here so the generator (backend/scripts/generate-openapi.ts) and both apps
// read one truth. Route files import them, optionally under local aliases.

export const codeOrgParams = z.object({
  code: z.string().min(1).max(60),
  org: z.string().min(1).max(120),
});

// Same length bound as codeOrgParams.org: org names are URL identifiers,
// validated declaratively like every other param (a hand-rolled length check
// drifted from the schema once already).
export const orgParam = z.object({
  org: z.string().min(1).max(120),
});

export const moduleOrgOverrideBody = z.object({
  isEnabled: z.boolean(),
  justification: z.string().max(1000).nullable().optional(),
});

export const changeRequestCreateBody = z.object({
  changeType: z.string().min(1).max(80),
  targetEntityType: z.string().min(1).max(60),
  targetEntityId: z.number().int().positive().nullable().optional(),
  proposedPayload: z.record(z.string(), z.unknown()),
  justification: z.string().max(2000).nullable().optional(),
});

export const changeRequestApproveBody = z.object({
  justification: z.string().max(2000).nullable().optional(),
});

export const changeRequestRejectBody = z.object({
  rejectionReason: z.string().min(1).max(2000),
});

export const changeRequestApplyBody = z.object({
  justification: z.string().max(2000).nullable().optional(),
});

export const assignRoleBody = z.object({
  roleId: z.number().int().positive(),
  scopeOrgUnitId: z.number().int().positive().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  justification: z.string().max(1000).nullable().optional(),
});

export const bulkAssignRoleBody = z.object({
  roleId: z.number().int().positive(),
  userIds: z.array(z.number().int().positive()).min(1).max(500),
  scopeOrgUnitId: z.number().int().positive().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  justification: z.string().max(1000).nullable().optional(),
});

export const RESPONSIBILITY_SUBJECT_TYPES = ['org_unit', 'department', 'role', 'all'] as const;

export const responsibilityRuleCreateBody = z.object({
  subjectType: z.enum(RESPONSIBILITY_SUBJECT_TYPES),
  subjectId: z.number().int().positive().nullable().optional(),
  permissionCode: z.string().min(1).max(80),
  responsibleOrgUnitId: z.number().int().positive(),
  delegatedToRoleId: z.number().int().positive().nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
});

export const responsibilityRuleUpdateBody = z.object({
  subjectType: z.enum(RESPONSIBILITY_SUBJECT_TYPES).optional(),
  subjectId: z.number().int().positive().nullable().optional(),
  permissionCode: z.string().min(1).max(80).optional(),
  responsibleOrgUnitId: z.number().int().positive().optional(),
  delegatedToRoleId: z.number().int().positive().nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const responsibilityRuleBulkBody = z.object({
  subjectType: z.enum(RESPONSIBILITY_SUBJECT_TYPES),
  subjectIds: z.array(z.number().int().positive()).max(200).optional(),
  permissionCodes: z.array(z.string().min(1).max(80)).min(1).max(50),
  responsibleOrgUnitId: z.number().int().positive(),
  delegatedToRoleId: z.number().int().positive().nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
});

export const pendingApprovalDelegateBody = z.object({
  targetUserId: z.coerce.number().int().positive(),
});

// approve/reject accept an optional free-text note; validated so the
// generated OpenAPI documents exactly what the API enforces.
export const pendingApprovalDecisionBody = z.object({
  note: z.string().max(2000).nullable().optional(),
});
