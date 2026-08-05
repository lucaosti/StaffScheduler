/**
 * Request schemas — the single declaration of what the API accepts.
 *
 * WHY THIS FILE IS IN A SHARED WORKSPACE PACKAGE RATHER THAN IN THE BACKEND.
 * These schemas are consumed three times over, and each consumer would
 * otherwise hold its own copy: the backend validates with them
 * (`validateBody` / `validateQuery` / `validateParams`), the OpenAPI generator
 * emits the spec's request bodies and query parameters FROM them, and the
 * frontend builds forms against them with `zodResolver` and derives its payload
 * types from the generated contract. Every copy that has ever existed in this
 * codebase drifted — a client type omitting a required `password` so that
 * every employee creation was rejected, filter types sending parameters no
 * endpoint accepts. One declaration in one place is what makes client
 * validation the server's by construction rather than by diligence.
 *
 * WHY THE PARAM SCHEMAS COERCE. Path and query values arrive as strings,
 * always: `/shifts/5` gives `"5"`, `?page=2` gives `"2"`. `z.coerce` is
 * therefore not a convenience but a correctness requirement — a plain
 * `z.number()` rejects every real request. The corollary is that the coerced
 * result must be read from `res.locals`, not from `req.params`/`req.query`,
 * which still hold the raw strings.
 *
 * WHY BOOLEAN FLAGS ACCEPT THE STRINGS "true"/"false". Same reason: a query
 * string has no booleans. `booleanFlag` takes either a real boolean (for
 * programmatic callers) or the two string spellings, and transforms.
 *
 * WHY SOME SCHEMAS CARRY LEGACY ALIASES. `reportRangeQuery` accepts both
 * `startDate`/`endDate` and `start`/`end` because the spec once documented the
 * first pair while the handlers read the second, so a caller following the
 * documentation got a 400. The documented names won; the old ones stay
 * accepted so existing callers keep working. An alias is a deliberate, dated
 * decision recorded here — not an invitation to add more.
 *
 * ADDING A QUERY CONTRACT IS NOT OPTIONAL. The OpenAPI generator fails the
 * build in both directions: a documented parameter with no `validateQuery`
 * behind it, and a handler reading `req.query` with no schema. So a new filter
 * starts here, or it does not ship.
 *
 * @author Luca Ostinelli
 */

import { z } from 'zod';

// ── Param schemas ─────────────────────────────────────────────────────────────

const positiveInt = z.coerce.number().int().positive();

export const idParam = z.object({ id: positiveInt });
export const userIdParam = z.object({ userId: positiveInt });
export const shiftIdParam = z.object({ shiftId: positiveInt });
export const scheduleIdParam = z.object({ scheduleId: positiveInt });
export const departmentIdParam = z.object({ departmentId: positiveInt });
export const idAndSkillIdParam = z.object({ id: positiveInt, skillId: positiveInt });
export const idAndProposalIdParam = z.object({ id: positiveInt, proposalId: positiveInt });
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

/**
 * A comma-separated list of positive integer ids, parsed to `number[]`.
 *
 * Validated here rather than split in a handler: a handler doing
 * `.split(',').map(Number)` turns "3,abc" into `[3, NaN]` and hands NaN to a
 * query, where it silently matches nothing — a filter that quietly loses half
 * its terms. Bounded at 100 so a URL cannot become an unbounded IN clause.
 */
const idListString = z
  .string()
  .regex(/^\d+(,\d+)*$/, 'Must be a comma-separated list of positive integers')
  .transform((raw) => raw.split(',').map(Number))
  .refine((ids) => ids.every((id) => Number.isInteger(id) && id > 0), 'Ids must be positive')
  .refine((ids) => ids.length <= 100, 'At most 100 ids');

/** Calendar date, "YYYY-MM-DD". */
const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format');

/**
 * Cross-field rules shared by shift-like payloads. Each check only fires when
 * both fields are present, so the same helpers work for create (required
 * fields) and update (optional fields) schemas.
 *
 * OVERNIGHT SHIFTS ARE ACCEPTED. This rule used to require
 * `startTime < endTime` on the grounds that "conflict detection and hour
 * accounting assume a shift starts and ends on the same calendar day". That was
 * false of everything downstream: the constraint validator, both optimizer
 * engines, the calendar feed and the compliance engine all roll an overnight
 * end into the following day, deliberately and with tests. Only the front door
 * refused, so a substantial amount of careful logic existed to handle a shape
 * the API would not accept — and a night shift is an ordinary requirement in
 * every sector this system targets.
 *
 * What remains rejected is the degenerate case: `startTime === endTime` is a
 * zero-length shift, which is meaningless rather than nocturnal, and would
 * otherwise have to be read as a full 24-hour block.
 *
 * The shift's `date` is its START date, so an overnight shift's hours count
 * entirely against the day it begins — see `DateUtils.shiftBounds`.
 */
const timeOrder = (data: { startTime?: string; endTime?: string }): boolean =>
  data.startTime === undefined || data.endTime === undefined || data.startTime !== data.endTime;
const TIME_ORDER_MESSAGE = {
  message: 'endTime must differ from startTime (a shift cannot have zero length)',
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

/**
 * The schedule this one continues from.
 *
 * Optional, and omitting it is not the same as saying there is none: the
 * server resolves the most recent published schedule for the department. It
 * exists for the case the default cannot decide — several generations covering
 * the same period, where which one actually happened is a manager's judgement.
 */
const previousScheduleIdField = {
  // `z.number()` and not the shared `positiveInt`, which is `z.coerce`: a
  // coercing schema has an INPUT type of `unknown`, and `zodResolver` types the
  // form from the input side, so the whole form's field names collapse to
  // `string` and every handler stops type-checking. `positiveInt` is for path
  // and query params, where values arrive as strings and coercion is the point.
  previousScheduleId: z.number().int().positive().nullable().optional(),
};

export const createScheduleBody = z.object({
  name: z.string().min(1, 'Name is required'),
  startDate: dateString,
  endDate: dateString,
  departmentId: z.number().int().positive(),
  templateIds: z.array(z.number().int().positive()).optional(),
  notes: z.string().optional(),
  ...previousScheduleIdField,
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

/**
 * Batch endpoints for high-volume integrations (#316) — distinct from
 * `bulkCreateAssignmentsBody`/`POST /assignments/bulk` above, which predates
 * this and intentionally swallows per-row failures for its own callers (see
 * `AssignmentService.bulkCreateAssignments`). These report one outcome per
 * input row instead, via the shared `BatchResult` envelope in `./batch`, so
 * an integration can tell exactly which rows in a large payload failed and
 * why. Capped at 200 rows: high-volume still means one HTTP request per bulk
 * operation, not one request replacing an unbounded stream.
 */
const MAX_BATCH_SIZE = 200;

export const batchCreateEmployeesBody = z.object({
  employees: z.array(createUserBody).min(1, 'At least one employee is required').max(MAX_BATCH_SIZE),
});

export const batchCreateAssignmentsBody = z.object({
  assignments: z.array(createAssignmentBody).min(1, 'At least one assignment is required').max(MAX_BATCH_SIZE),
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

const geoPointBody = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const createGeofenceBody = z.object({
  name: z.string().min(1).max(100),
  polygon: z.array(geoPointBody).min(3, 'A polygon needs at least 3 points'),
  isActive: z.boolean().optional(),
});

export const updateGeofenceBody = z.object({
  name: z.string().min(1).max(100).optional(),
  polygon: z.array(geoPointBody).min(3, 'A polygon needs at least 3 points').optional(),
  isActive: z.boolean().optional(),
});

export const idAndGeofenceIdParam = z.object({ id: positiveInt, geofenceId: positiveInt });

export const createKioskDeviceBody = z.object({
  name: z.string().min(1).max(100),
});

export const idAndKioskIdParam = z.object({ id: positiveInt, kioskId: positiveInt });

export const kioskPunchBody = z.object({
  employeeId: z.string().min(1).max(50),
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
  ...previousScheduleIdField,
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

/**
 * Size of the dashboard's recent-activity feed.
 *
 * The spec published a `limit` parameter for this endpoint through a reusable
 * `$ref` while the handler took `_req` and hardcoded `LIMIT 10`, so the
 * documented knob did nothing. Declaring it here is the honest fix: the widget
 * is a fixed-height panel whose useful size depends on the caller, and a
 * bounded, validated integer is cheaper than a second endpoint. The ceiling is
 * deliberately low — this is a preview of `audit_logs`, not a way to page
 * through it; `GET /audit-logs` is the endpoint for that.
 */
export const dashboardActivitiesQuery = z.object({
  limit: z.coerce.number().int().positive().max(50).optional(),
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

/** Required "as of" calendar date for a person-history projection. */
export const personHistoryQuery = z.object({
  asOf: dateString,
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

/**
 * The filtered aggregate calendar feed.
 *
 * Every filter is a comma-separated id list rather than a repeated parameter,
 * because a calendar client stores a URL and a person edits it by hand; one
 * `departmentId=3,4` is something you can read and change, where
 * `departmentId=3&departmentId=4` invites the two halves to be edited apart.
 *
 * NONE of these widens what the caller may see. The org-unit scope is resolved
 * from the token's owner on every fetch and intersected with whatever is asked
 * for here — see services/orgScope.
 */
export const calendarAggregateQuery = z.object({
  token: z.string().min(1).max(255).optional(),
  departmentId: idListString.optional(),
  roleId: idListString.optional(),
  userId: idListString.optional(),
  /** Days back from today. The feed reaches into the past on purpose. */
  pastDays: z.coerce.number().int().min(0).max(365).optional(),
  futureDays: z.coerce.number().int().min(1).max(365).optional(),
});

/**
 * A field policy, as the admin API accepts it.
 *
 * `fieldKey` is a plain string here and validated against the ALLOWLIST in the
 * service, not by an enum in this schema. Deliberate: the allowlist is a
 * security boundary that must live next to the code that knows why each field is
 * on it, and publishing it as an OpenAPI enum would also publish the set of
 * custom keys an organization uses — a small disclosure with no upside.
 */
export const employeeFieldPolicyBody = z.object({
  organizationName: z.string().min(1).max(120).nullable().optional(),
  fieldKey: z.string().min(1).max(80),
  isRequired: z.boolean().optional(),
  visiblePermission: z.string().min(1).max(64).nullable().optional(),
  editPermission: z.string().min(1).max(64).nullable().optional(),
  minLength: z.number().int().min(0).max(65535).nullable().optional(),
  maxLength: z.number().int().min(1).max(65535).nullable().optional(),
  minValue: z.number().nullable().optional(),
  maxValue: z.number().nullable().optional(),
  // Length capped here as well as in the column: a user-supplied regex is a
  // ReDoS surface, and a short one is much harder to make pathological.
  pattern: z.string().min(1).max(200).nullable().optional(),
  allowedValues: z.array(z.string().min(1).max(255)).max(200).nullable().optional(),
  helpText: z.string().min(1).max(255).nullable().optional(),
});

export const employeeFieldPolicyQuery = z.object({
  organizationName: z.string().min(1).max(120).optional(),
});

export const employeeFieldPolicyDeleteQuery = z.object({
  organizationName: z.string().min(1).max(120).optional(),
  fieldKey: z.string().min(1).max(80),
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

/**
 * A timeline window and the sources to draw on it.
 *
 * `sources` is a comma-separated list rather than a repeated parameter: it is
 * a small closed set, and repeated query keys are the one shape the generated
 * client and the OpenAPI parameter types disagree about.
 */
export const timelineQuery = z.object({
  from: dateString,
  to: dateString,
  sources: z.string().max(200).optional(),
}).refine(
  (v) => v.from <= v.to,
  { message: 'from must be on or before to', path: ['to'] }
);

/**
 * A new calendar feed token.
 *
 * The label is required and not defaulted: with several tokens, revoking the
 * right one means knowing which is which, and "Token 3" tells nobody whether it
 * is the phone that was lost. Making the caller name it is the only point at
 * which they know.
 */
export const createCalendarTokenBody = z.object({
  label: shortString,
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

/** `1` restricts the open-shift board to the caller's own posted offers. */
export const shiftSwapOpenListQuery = z.object({
  mine: z.enum(['0', '1']).optional(),
});

export const notificationListQuery = z.object({
  /** `1` means "unread only"; kept as the historical spelling. */
  unreadOnly: z.enum(['0', '1']).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

/** The PushSubscription object the browser's `pushManager.subscribe()` returns, verbatim. */
export const pushSubscribeBody = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export const pushUnsubscribeBody = z.object({
  endpoint: z.string().url(),
});

// ── Outbound webhooks (#315) ─────────────────────────────────────────────────

const webhookEventType = z.enum(['schedule.published', 'assignment.confirmed', 'approval.decided']);

export const createWebhookSubscriptionBody = z.object({
  url: z.string().url(),
  eventTypes: z.array(webhookEventType).min(1, 'At least one event type is required'),
});

export const updateWebhookSubscriptionBody = z.object({
  url: z.string().url().optional(),
  eventTypes: z.array(webhookEventType).min(1).optional(),
  isActive: z.boolean().optional(),
});

export const webhookDeliveriesQuery = z.object({
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

/**
 * How far back a role timeline reaches.
 *
 * Optional, and the endpoint caps the number of events regardless: the audit
 * table only grows, and the per-role query cannot use an index on the role id
 * (it lives inside a JSON snapshot), so the range is what keeps that scan
 * bounded rather than merely tidy.
 */
export const roleTimelineQuery = z.object({
  since: dateString.optional(),
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
  // Present only when the device provided geolocation. Geofence enforcement
  // (see AttendanceService.clockIn) is per-caller: it activates only when the
  // caller's departments have at least one active geofence, so a deployment
  // that never configures one sees no change in behavior with or without
  // these fields.
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

export const createShiftSwapBody = z.object({
  requesterAssignmentId: z.number().int().positive(),
  targetAssignmentId: z.number().int().positive(),
  notes: z.string().optional(),
});

export const createShiftSwapOfferBody = z.object({
  assignmentId: z.number().int().positive(),
  notes: z.string().max(2000).nullable().optional(),
});

export const claimShiftSwapOfferBody = z.object({
  assignmentId: z.number().int().positive(),
  notes: z.string().max(2000).nullable().optional(),
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

/**
 * Every 2FA method type the registry can dispatch to (#586/#591) — kept in
 * lockstep with `TwoFactorMethodType` in `backend/src/services/TwoFactorMethodProvider.ts`,
 * which is the actual source of truth (a Zod-only definition here would be
 * one more place the set of methods could drift from what's registered).
 */
export const twoFactorMethodType = z.enum(['totp', 'webauthn', 'email', 'sms']);

export const twoFactorSetupBody = z.object({
  methodType: twoFactorMethodType.optional(),
});

export const twoFactorCodeBody = z.object({
  code: z.string().min(1, 'code is required'),
  methodType: twoFactorMethodType.optional(),
});

/** Requests a fresh challenge for an ALREADY-ENROLLED method, e.g. sending a new email code or issuing a WebAuthn assertion challenge. Authenticated — see twoFactorLoginChallengeBody for the pre-session equivalent used during login. */
export const twoFactorChallengeBody = z.object({
  methodType: twoFactorMethodType,
});

/** Same as twoFactorChallengeBody, but for a caller who hasn't finished logging in yet — carries credentials instead of relying on a session. */
export const twoFactorLoginChallengeBody = z.object({
  email: z.string().min(1, 'email is required'),
  password: z.string().min(1, 'password is required'),
  methodType: twoFactorMethodType,
});

/**
 * What an employee may set about their OWN scheduling.
 *
 * WHY THE WORKING-TIME LIMITS ARE NOT HERE. `maxHoursPerWeek`,
 * `minHoursPerWeek` and `maxConsecutiveDays` used to be part of this body, on
 * an endpoint (`PUT /preferences/me`) deliberately guarded by `authenticate`
 * alone because it is self-service. But those three are not preferences: they
 * are the working-time limits the optimizer enforces as HARD constraints, so
 * any employee could raise their own maximum weekly hours and consecutive
 * working days and the scheduler would then legitimately assign them more
 * work. In most jurisdictions those are legally bounded, which made it a
 * compliance exposure and not only an authorization one. The reverse was
 * quieter and just as wrong: lowering one's own limits silently removes
 * oneself from the schedulable pool.
 *
 * The mistake was structural rather than careless. The limits live in the
 * `user_preferences` table alongside `preferred_shifts`, and the table name
 * asserts that everything in it is a preference — so one endpoint, one schema
 * and one service method covered both, and the guard was chosen for the table
 * rather than for the fields.
 */
export const upsertOwnPreferencesBody = z.object({
  preferredShifts: z.array(z.number().int().positive()).optional(),
  avoidShifts: z.array(z.number().int().positive()).optional(),
  notes: z.string().nullable().optional(),
});

/**
 * What a manager may set about someone else's scheduling: the preferences
 * above plus the working-time limits. Used only by `PUT /preferences/:userId`,
 * which is gated on `preferences.manage`.
 *
 * These limits remain here rather than in a properly effective-dated
 * employment contract, which is the durable fix — a person moving from
 * full-time to part-time still overwrites the old value, so the schedule
 * generated last month appears to violate a limit that did not apply then.
 */
export const upsertPreferencesBody = upsertOwnPreferencesBody.extend({
  maxHoursPerWeek: z.number().positive().optional(),
  minHoursPerWeek: z.number().nonnegative().optional(),
  maxConsecutiveDays: z.number().int().min(1).max(14).optional(),
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
  // Second-factor code/assertion (or a recovery code); required only when
  // the account has 2FA enabled. methodType selects which enrolled method
  // `code` is being verified against — defaults to 'totp' when omitted, so
  // a TOTP-only account never needs to send it.
  code: z.string().min(1).optional(),
  methodType: twoFactorMethodType.optional(),
});

export const optionalNotesBody = z.object({
  notes: z.string().max(2000).nullable().optional(),
});

/** The target's response to a pending shift swap (#522) — accept routes it to the manager, decline ends it immediately. */
export const respondToShiftSwapBody = z.object({
  accepted: z.boolean(),
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

export const importVcardPreviewBody = z.object({
  vcf: z.string().min(1, 'vcf is required'),
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

/**
 * Employment contracts. Every limit is optional and nullable because `null`
 * means "this contract does not constrain it" — distinct from zero, and from
 * omitting the field on an update.
 */
const contractLimitFields = {
  maxHoursPerWeek: z.number().int().positive().nullable().optional(),
  minHoursPerWeek: z.number().int().nonnegative().nullable().optional(),
  maxHoursPerDay: z.number().int().positive().max(24).nullable().optional(),
  maxConsecutiveDays: z.number().int().positive().max(31).nullable().optional(),
  minHoursBetweenShifts: z.number().int().nonnegative().max(24).nullable().optional(),
  /**
   * Consecutive days off guaranteed at least once per rolling 7-day window.
   * Bounded at 7 because a longer block cannot fit in the window it is
   * measured over — asking for 8 would be unsatisfiable by construction.
   */
  minConsecutiveDaysOff: z.number().int().positive().max(7).nullable().optional(),
  /**
   * Minimum total days off per 7-day reference period, independent of how
   * they're distributed — a rate, not an absolute count, prorated against
   * whatever period a schedule actually spans. Bounded at 7 for the same
   * reason as `minConsecutiveDaysOff`: a rate above the reference period it's
   * measured against is unsatisfiable by construction.
   */
  minDaysOffPerPeriod: z.number().int().positive().max(7).nullable().optional(),
};

export const createEmploymentContractBody = z.object({
  name: shortString,
  description: z.string().max(2000).nullable().optional(),
  ...contractLimitFields,
});

export const updateEmploymentContractBody = z.object({
  name: shortString.optional(),
  description: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
  ...contractLimitFields,
});

/**
 * The skills catalogue.
 *
 * `isActive` is on the update body and not on create: a skill is created to be
 * used, and offering "create it already retired" would be a state with no
 * purpose that someone would eventually reach by accident.
 */
export const createSkillBody = z.object({
  name: shortString,
  description: z.string().max(2000).nullable().optional(),
});

export const updateSkillBody = z.object({
  name: shortString.optional(),
  description: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
});

/**
 * Hide retired skills, for pickers that should only offer usable ones.
 *
 * NOT `z.coerce.boolean()`. Coercion follows JavaScript truthiness, and a query
 * string is always a string — so `?activeOnly=false` parses as TRUE and does
 * the exact opposite of what it says, silently. `'true'`/`'false'` are matched
 * literally instead, and anything else is a 400 rather than a guess.
 */
export const skillListQuery = z.object({
  activeOnly: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

/**
 * Pairing rules: relationships between two named people that constrain who may
 * share a shift.
 *
 * `kind` is not optional and has no default on purpose. `apart` and `requires`
 * are opposites, and the cost of getting one silently is a schedule that keeps
 * two people together who must be separated — a request that does not say
 * which it means should be rejected rather than guessed.
 *
 * `reason` is free text and stays optional: some rules are a matter of record
 * ("cannot operate the till unsupervised") and some are a matter nobody should
 * be required to write down. Who may READ it is decided by the router, not
 * here — see `employeePairings.ts`.
 */
export const createEmployeePairingBody = z.object({
  userId: positiveInt,
  otherUserId: positiveInt,
  kind: z.enum(['apart', 'requires']),
  reason: z.string().max(2000).nullable().optional(),
});

/**
 * Only the reason is editable. Changing who a rule is about, or which way it
 * runs, is a different rule — expressing that as an update would let an `apart`
 * become a `requires` in place, keeping the row's history and audit trail while
 * inverting what it means.
 */
export const updateEmployeePairingBody = z.object({
  reason: z.string().max(2000).nullable(),
});

/** Narrow the list to the rules involving one person, in either direction. */
export const employeePairingListQuery = z.object({
  userId: positiveInt.optional(),
});

/**
 * Assigning a contract to a person for a period. `effectiveTo` omitted or null
 * means open-ended — the contract in force until something replaces it.
 */
export const assignEmploymentContractBody = z.object({
  contractId: positiveInt,
  effectiveFrom: dateString,
  effectiveTo: dateString.nullable().optional(),
});
