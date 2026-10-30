/**
 * The authorization matrix: every mounted operation, what admits a caller to
 * it, and how org-unit scope applies (#909).
 *
 * WHY A DECLARED TABLE. Authorization regressed silently for as long as it was
 * only implied by the code: two shift routes required no permission at all and
 * nothing noticed, and scope was enforced on four reads out of a hundred
 * operations (#813). `authorization.integration.test.ts` holds the running app
 * to this table in both directions — an operation without an entry fails, an
 * entry whose gate differs from the route's chain fails, every `unit` entry
 * must be probed with another unit's ids and refused, and every `filtered` one
 * must be list-probed — so a change to who may do what has to be made here,
 * deliberately, where review sees it.
 *
 * Keys are `METHOD path` exactly as `openapi.json` spells them (the spec must
 * list every mounted operation); `EXTRA_OPERATIONS` holds the few routes that
 * live outside the versioned API.
 *
 * `requires` — the permission codes `requirePermission` enforces on the route,
 *   `[]` for any signed-in caller (the handler or service may decide further:
 *   see `owner`), `'public'` for routes outside `authenticate`.
 * `owner` — who passes without a permission, when ownership decides.
 * `scope` — how org-unit scope applies:
 *   - `unit`: the operation names a unit-owned row (path or body); out of scope
 *     is 404. Probed in the suite.
 *   - `filtered`: a list or aggregate bounded by the caller's scope. Probed.
 *   - `self`: acts only on the caller's own data.
 *   - `shared`: organization-wide reference data that a unit-scoped holder may
 *     read or keep (the skills catalog, the org tree) — harmless under a scoped
 *     grant, so it does not make its code organization-wide.
 *   - `org`: organization-wide authority a unit cannot bound (roles, settings,
 *     audit). Its codes cannot be delegated for a unit (DelegationService).
 *   - `gap`: unit-owned data whose scope is not enforced yet, referencing the
 *     follow-up issue #926.
 * `note` — required for `org`, `shared` and `gap`: the reason, asserted
 *   non-empty, so classifying an operation out of scope is a stated decision.
 * `handler` — permission codes the handler (not the route chain) checks. It
 *   must be declared, `[]` included, for every signed-in operation that is
 *   neither `self` nor owner-decided with an empty `requires`, so the suite's
 *   derivation of unit-boundable codes sees every code an operation uses.
 * `shared` is read-only by definition: the suite refuses it on anything but
 *   GET, since a write to organization-wide data is organization-wide authority.
 *
 * @author Luca Ostinelli
 */

export type ScopeRule = 'unit' | 'filtered' | 'self' | 'shared' | 'org' | 'gap';

export interface AuthzRule {
  requires: 'public' | string[];
  owner?: string;
  scope: ScopeRule;
  note?: string;
  handler?: string[];
}

const pub = (note: string): AuthzRule => ({ requires: 'public', scope: 'org', note });
const org = (note: string, ...requires: string[]): AuthzRule => ({ requires, scope: 'org', note });
const shared = (note: string, ...requires: string[]): AuthzRule => ({ requires, scope: 'shared', note });
const self = (note?: string): AuthzRule => ({ requires: [], scope: 'self', note });
const unit = (...requires: string[]): AuthzRule => ({ requires, scope: 'unit' });
const owned = (owner: string, ...requires: string[]): AuthzRule => ({ requires, owner, scope: 'unit' });
const filtered = (...requires: string[]): AuthzRule => ({ requires, scope: 'filtered' });
const gap = (requires: string[], note: string): AuthzRule => ({ requires, scope: 'gap', note: `${note} (#926)` });
/** The same rule, declaring the codes its handler checks. */
const h = (rule: AuthzRule, ...handler: string[]): AuthzRule => ({ ...rule, handler });

const CONFIG = 'organization-wide configuration; no unit owns it';
const APPROVAL_CONFIG = 'approval workflows and routing are configured for the whole organization';
const RBAC = 'role administration assigns any role to anyone, organization-wide by design';
const AUDIT = 'the audit trail spans the organization';
const PAYROLL = 'payroll export covers the organization';
const RESPONSIBILITY = 'responsibility rules are organization-wide routing configuration';
const POLICY = 'policies are organization-wide configuration';
const PUBLIC = 'outside authenticate: answers before any session exists';
const DEPARTMENTS = 'department routes gate on department.* in the handler and are not scoped yet';
const PAIRINGS = 'pairings name people of any unit';

export const AUTHORIZATION_MATRIX: Record<string, AuthzRule> = {
  'GET /approval-workflows': org(APPROVAL_CONFIG, 'approval.manage'),
  'POST /approval-workflows': org(APPROVAL_CONFIG, 'approval.manage'),
  'PUT /approval-workflows/{id}': org(APPROVAL_CONFIG, 'approval.manage'),
  'DELETE /approval-workflows/{id}': org(APPROVAL_CONFIG, 'approval.manage'),
  'GET /approval-workflows/{type}': org(APPROVAL_CONFIG, 'approval.manage'),
  'POST /approval-workflows/escalate': org('escalates overdue approvals across the organization', 'approval.manage'),

  'GET /assignments': filtered('assignment.manage'),
  'GET /assignments/export': filtered('assignment.manage'),
  'POST /assignments': unit('assignment.manage'),
  'POST /assignments/bulk': unit('assignment.manage'),
  'POST /assignments/batch': unit('assignment.manage'),
  'GET /assignments/{id}': owned('the assigned user, or assignment.manage over its unit'),
  'PUT /assignments/{id}': unit('assignment.manage'),
  'DELETE /assignments/{id}': unit('assignment.manage'),
  'PATCH /assignments/{id}/complete': unit('assignment.manage'),
  'PATCH /assignments/{id}/confirm': owned('the assigned user, or assignment.manage over its unit'),
  'PATCH /assignments/{id}/decline': owned('the assigned user, or assignment.manage over its unit'),
  'GET /assignments/{id}/swap-candidates': self('the caller must own the assignment; candidates are bounded by their units'),
  'GET /assignments/department/{departmentId}': unit('assignment.manage'),
  'GET /assignments/shift/{shiftId}': unit('assignment.manage'),
  'GET /assignments/shift/{shiftId}/available-employees': unit('assignment.manage'),
  'GET /assignments/user/{userId}': owned('the user themselves, or assignment.manage over a unit they belong to'),

  'GET /attendance': h({ requires: [], owner: 'own records; attendance.read/approve see their scope', scope: 'filtered' }, 'attendance.read', 'attendance.approve'),
  'GET /attendance/export': h({ requires: [], owner: 'own records; attendance.read/approve see their scope', scope: 'filtered' }, 'attendance.read', 'attendance.approve'),
  'GET /attendance/{id}': owned('the punching user, or attendance.read/approve over their unit'),
  'POST /attendance/{id}/approve': unit('attendance.approve'),
  'POST /attendance/{id}/reject': unit('attendance.approve'),
  'POST /attendance/{id}/clock-out': self(),
  'POST /attendance/clock-in': self(),
  'GET /attendance/cost-estimate': unit('attendance.read'),
  'POST /attendance/kiosk/punch': pub('kiosk device credential, bound to one department'),

  'GET /audit-logs': org(AUDIT, 'audit.read'),
  'GET /audit-logs/{id}': org(AUDIT, 'audit.read'),
  'GET /audit-logs/export': org(AUDIT, 'audit.read'),

  'POST /auth/2fa/challenge': self(),
  'POST /auth/2fa/disable': self(),
  'POST /auth/2fa/enable': self(),
  'GET /auth/2fa/methods': self(),
  'POST /auth/2fa/setup': self(),
  'POST /auth/2fa/verify': self(),
  'POST /auth/login': pub(PUBLIC),
  'POST /auth/login/challenge': pub(PUBLIC),
  'POST /auth/refresh': pub('refresh-token cookie'),
  'POST /auth/refresh/logout': pub('revokes whatever session it is presented with'),
  'GET /auth/sso/{id}/callback': pub(PUBLIC),
  'GET /auth/sso/{id}/login': pub(PUBLIC),
  'GET /auth/sso/providers': pub(PUBLIC),
  'GET /auth/verify': self(),

  'GET /calendar/aggregate.ics': pub('feed token; visibility recomputed from its owner, delegation scopes included'),
  'GET /calendar/department/{id}.ics': pub('feed token of the owner'),
  'GET /calendar/feed.ics': pub('feed token of the owner'),
  'GET /calendar/tokens': self(),
  'POST /calendar/tokens': self(),
  'DELETE /calendar/tokens/{id}': self(),

  'GET /change-requests': gap(['change_request.review'], 'reviewers see every unit'),
  'POST /change-requests': gap(['change_request.create'], 'target ids are not scope-checked'),
  'GET /change-requests/{id}': h(gap([], 'proposer or reviewer, any unit'), 'change_request.review'),
  'POST /change-requests/{id}/apply': unit('change_request.review'),
  'POST /change-requests/{id}/approve': unit('change_request.review'),
  'POST /change-requests/{id}/cancel': self('proposer only'),
  'POST /change-requests/{id}/reject': unit('change_request.review'),

  'GET /cost-plans': filtered('report.read'),
  'POST /cost-plans': unit('report.manage'),
  'GET /cost-plans/{id}': unit('report.read'),
  'PUT /cost-plans/{id}': unit('report.manage'),
  'DELETE /cost-plans/{id}': unit('report.manage'),

  'GET /dashboard/attention-items': h(gap([], 'organization-wide counts behind in-handler permission checks'), 'report.read'),
  'GET /dashboard/stats': h(gap([], 'organization-wide counts behind in-handler permission checks'), 'report.read'),

  'GET /delegations': self(),
  'POST /delegations': self('delegation.manage or delegation.self; codes and scope must be the delegator\'s own (#814)'),
  'DELETE /delegations/{id}': self('the delegator only'),

  // Creating, moving, deleting and staffing a department change which unit its
  // schedules, shifts and assignments belong to, so both ends are scoped.
  'GET /departments': h(gap([], DEPARTMENTS), 'settings.manage'),
  'POST /departments': owned('the department must be placed in one of the caller\'s units', 'department.manage'),
  'GET /departments/{id}': h(gap([], DEPARTMENTS), 'settings.manage'),
  'PUT /departments/{id}': h(owned('settings.manage, or department.manage as its manager; the department and any new unit must be in scope'), 'department.manage', 'settings.manage'),
  'DELETE /departments/{id}': h(owned('settings.manage over its unit'), 'settings.manage'),
  'GET /departments/{id}/geofences': h(gap([], DEPARTMENTS), 'department.manage', 'settings.manage'),
  'POST /departments/{id}/geofences': h(gap([], DEPARTMENTS), 'department.manage', 'settings.manage'),
  'PUT /departments/{id}/geofences/{geofenceId}': h(gap([], `${DEPARTMENTS}; child id not bound to the department (#850)`), 'department.manage', 'settings.manage'),
  'DELETE /departments/{id}/geofences/{geofenceId}': h(gap([], `${DEPARTMENTS}; child id not bound to the department (#850)`), 'department.manage', 'settings.manage'),
  'GET /departments/{id}/kiosks': h(gap([], DEPARTMENTS), 'department.manage', 'settings.manage'),
  'POST /departments/{id}/kiosks': h(gap([], DEPARTMENTS), 'department.manage', 'settings.manage'),
  'DELETE /departments/{id}/kiosks/{kioskId}': h(gap([], `${DEPARTMENTS}; child id not bound to the department (#850)`), 'department.manage', 'settings.manage'),
  'GET /departments/{id}/stats': h(gap([], DEPARTMENTS), 'department.manage', 'settings.manage'),
  'POST /departments/{id}/users': h(owned('settings.manage, or department.manage as its manager; department and person in scope'), 'department.manage', 'settings.manage'),
  'DELETE /departments/{id}/users/{userId}': h(owned('settings.manage, or department.manage as its manager; department and person in scope'), 'department.manage', 'settings.manage'),

  'POST /directory/import-vcard': org('creates accounts organization-wide, in no unit; role names are held to UserAuthorityService', 'user.manage'),
  'POST /directory/import-vcard/preview': org('parses a file of accounts for the whole organization; writes nothing', 'user.manage'),
  'GET /directory/me': self(),
  'GET /directory/users/{id}': unit('user.read'),
  'PUT /directory/users/{id}/fields': unit('user.manage'),
  'DELETE /directory/users/{id}/fields/{key}': unit('user.manage'),
  'GET /directory/users/{id}/vcard': unit('user.read'),
  'GET /directory/vcard.vcf': gap(['user.read'], 'the whole-directory export is not filtered by unit'),

  'GET /employee-field-policies': h(org('the caller\'s organization field rules')),
  'PUT /employee-field-policies': org(CONFIG, 'settings.manage'),
  'DELETE /employee-field-policies': org(CONFIG, 'settings.manage'),

  'GET /employee-pairings': gap(['employee.manage'], PAIRINGS),
  'POST /employee-pairings': unit('employee.manage'),
  'GET /employee-pairings/{id}': unit('employee.manage'),
  'PUT /employee-pairings/{id}': unit('employee.manage'),
  'DELETE /employee-pairings/{id}': unit('employee.manage'),

  'GET /employees': filtered('employee.read'),
  'GET /employees/export': filtered('employee.read'),
  'POST /employees': unit('employee.manage'),
  'POST /employees/batch': unit('employee.manage'),
  'GET /employees/{id}': unit('employee.read'),
  'PUT /employees/{id}': unit('employee.manage'),
  'DELETE /employees/{id}': unit('employee.manage'),
  'GET /employees/{id}/skills': unit('employee.read'),
  'POST /employees/{id}/skills': unit('employee.manage'),
  'DELETE /employees/{id}/skills/{skillId}': unit('employee.manage'),
  'GET /employees/department/{departmentId}': unit('employee.read'),

  'GET /employment-contracts': shared('the catalog of contract types, owned by no unit', 'employee.read'),
  'POST /employment-contracts': org('a contract type is organization-wide; editing it changes every unit\'s limits', 'preferences.manage'),
  'GET /employment-contracts/{id}': shared('one contract type of the catalog', 'employee.read'),
  'PUT /employment-contracts/{id}': org('a contract type is organization-wide; editing it changes every unit\'s limits', 'preferences.manage'),
  'GET /employment-contracts/users/{userId}': unit('employee.read'),
  'POST /employment-contracts/users/{userId}': unit('preferences.manage'),

  'GET /events/stream': h(gap([], 'events are fanned out to every subscriber')),
  'GET /health': pub('liveness probe'),
  'GET /health/ready': pub('readiness probe'),

  'GET /i18n/overrides': self('the caller\'s organization'),
  'GET /i18n/overrides/admin': org(CONFIG, 'settings.manage'),
  'POST /i18n/overrides/admin': org(CONFIG, 'settings.manage'),
  'GET /i18n/overrides/admin/{id}': org(CONFIG, 'settings.manage'),
  'PUT /i18n/overrides/admin/{id}': org(CONFIG, 'settings.manage'),
  'DELETE /i18n/overrides/admin/{id}': org(CONFIG, 'settings.manage'),

  // CSV rows of employees name no unit (accounts are created in none, roles go
  // through UserAuthorityService); CSV rows of shifts name a schedule and a
  // department, each checked against the importer's scope.
  'POST /import/employees': org('creates accounts organization-wide, in no unit; role names are held to UserAuthorityService', 'employee.manage'),
  'POST /import/shifts': unit('shift.manage'),

  'GET /integrations/payroll/export': org(PAYROLL, 'payroll.manage'),
  'POST /integrations/payroll/export': org(PAYROLL, 'payroll.manage'),
  'GET /integrations/payroll/export/{id}': org(PAYROLL, 'payroll.manage'),

  'GET /modules': org(CONFIG, 'settings.manage'),
  'PUT /modules/{code}': org(CONFIG, 'settings.manage'),
  'PUT /modules/{code}/org/{org}': org(CONFIG, 'settings.manage'),
  'DELETE /modules/{code}/org/{org}': org(CONFIG, 'settings.manage'),
  'GET /modules/org/{org}': org(CONFIG, 'settings.manage'),

  'GET /notifications': self(),
  'PATCH /notifications/{id}/read': self(),
  'POST /notifications/push/device-token': self(),
  'DELETE /notifications/push/device-token': self(),
  'GET /notifications/push/public-key': self(),
  'POST /notifications/push/subscribe': self(),
  'DELETE /notifications/push/subscribe': self(),
  'PATCH /notifications/read-all': self(),
  'GET /notifications/unread-count': self(),

  'GET /on-call/me': self(),
  'GET /on-call/periods': filtered('schedule.read'),
  'POST /on-call/periods': unit('oncall.manage'),
  'GET /on-call/periods/{id}': unit('schedule.read'),
  'PUT /on-call/periods/{id}': unit('oncall.manage'),
  'DELETE /on-call/periods/{id}': unit('oncall.manage'),
  'POST /on-call/periods/{id}/assign': unit('oncall.manage'),
  'DELETE /on-call/periods/{id}/assign/{userId}': unit('oncall.manage'),
  'GET /on-call/periods/{id}/assignments': unit('schedule.read'),

  'GET /org/authority': self(),
  'GET /org/authority/{userId}': h(gap([], 'self, or org_unit.read for anyone in any unit'), 'org_unit.read'),
  'GET /org/history': self(),
  'GET /org/history/{userId}': h(gap([], 'self, or org_unit.read for anyone in any unit'), 'org_unit.read'),
  'GET /org/manager-chain': self(),
  'GET /org/manager-chain/{userId}': h(gap([], 'no permission check (#850)')),
  'GET /org/loans': h({ requires: [], owner: 'own loans; loan.approve sees loans touching their scope', scope: 'filtered' }, 'loan.approve'),
  'POST /org/loans': unit('loan.request'),
  'POST /org/loans/{id}/approve': unit('loan.approve'),
  'POST /org/loans/{id}/reject': unit('loan.approve'),
  'POST /org/loans/{id}/cancel': self('the requester only'),
  'GET /org/units': shared('the org tree is how anyone finds their way around the organization', 'org_unit.read'),
  'POST /org/units': org('reshapes the org tree every scope is computed from', 'org_unit.manage'),
  'GET /org/units/tree': shared('the org tree is how anyone finds their way around the organization', 'org_unit.read'),
  'GET /org/units/{id}': shared('one node of the org tree', 'org_unit.read'),
  'PUT /org/units/{id}': org('reshapes the org tree every scope is computed from', 'org_unit.manage'),
  'DELETE /org/units/{id}': org('reshapes the org tree every scope is computed from', 'org_unit.manage'),
  'GET /org/units/{id}/members': unit('org_unit.read'),
  'GET /org/units/{id}/members/detailed': unit('org_unit.read'),
  'POST /org/units/{id}/members': unit('employee.manage'),
  'DELETE /org/units/{id}/members/{userId}': unit('employee.manage'),
  'PATCH /org/units/{id}/members/{userId}/primary': unit('employee.manage'),

  'GET /pending-approvals': self('approvals the caller is resolved to decide'),
  'GET /pending-approvals/count': self('approvals the caller is resolved to decide'),
  'POST /pending-approvals/{id}/approve': self('the resolved approver only'),
  'POST /pending-approvals/{id}/reject': self('the resolved approver only'),
  'POST /pending-approvals/{id}/keep': self('the resolved approver only'),
  'POST /pending-approvals/{id}/delegate': self('the resolved approver only'),
  'POST /pending-approvals/{id}/open-to-structure': self('the resolved approver only'),
  'GET /pending-approvals/{id}/chain': self('the resolved approver only'),

  'GET /permissions': org(RBAC, 'role.manage'),
  'GET /policies': org(POLICY, 'policy.read'),
  'POST /policies': org(POLICY, 'policy.manage'),
  'GET /policies/{id}': org(POLICY, 'policy.read'),
  'PUT /policies/{id}': h(org(POLICY, 'policy.manage'), 'settings.manage'),
  'DELETE /policies/{id}': h(org(POLICY, 'policy.manage'), 'settings.manage'),
  'GET /policies/approval-matrix': h(org(APPROVAL_CONFIG)),
  'PUT /policies/approval-matrix/{changeType}': org(APPROVAL_CONFIG, 'approval.manage'),
  'GET /policies/exceptions': h(gap([], 'exceptions of any unit'), 'policy.approve'),
  'POST /policies/exceptions': h(gap([], 'requesting needs no permission and the target is not scope-checked; deciding is scoped')),
  'POST /policies/exceptions/{id}/approve': unit('policy.approve'),
  'POST /policies/exceptions/{id}/cancel': self('the requester only'),
  'POST /policies/exceptions/{id}/reject': unit('policy.approve'),
  'GET /policies/presets': org(POLICY, 'policy.read'),
  'POST /policies/presets/{code}/apply': org(POLICY, 'policy.manage'),
  'POST /policies/validate/assignment': h(gap([], 'any signed-in caller evaluates the policies for any person and shift')),

  'GET /preferences/me': self(),
  'PUT /preferences/me': self(),
  'GET /preferences/{userId}': unit('preferences.manage'),
  'PUT /preferences/{userId}': unit('preferences.manage'),

  'GET /reports/attendance-anomalies': filtered('report.read'),
  'GET /reports/compliance-violations-trend': filtered('report.read'),
  'GET /reports/cost-by-department': filtered('report.read'),
  'GET /reports/cost-by-department/export': filtered('report.read'),
  'GET /reports/fairness/{scheduleId}': unit('report.read'),
  'GET /reports/fairness/{scheduleId}/export': unit('report.read'),
  'GET /reports/hours-worked': unit('report.read'),
  'GET /reports/hours-worked/export': unit('report.read'),

  'GET /responsibility-rules': org(RESPONSIBILITY, 'responsibility.read'),
  'POST /responsibility-rules': org(RESPONSIBILITY, 'responsibility.manage'),
  'GET /responsibility-rules/{id}': org(RESPONSIBILITY, 'responsibility.read'),
  'PUT /responsibility-rules/{id}': org(RESPONSIBILITY, 'responsibility.manage'),
  'DELETE /responsibility-rules/{id}': org(RESPONSIBILITY, 'responsibility.manage'),
  'GET /responsibility-rules/{id}/conflicts': org(RESPONSIBILITY, 'responsibility.read'),
  'POST /responsibility-rules/bulk': org(RESPONSIBILITY, 'responsibility.manage'),
  'GET /responsibility-rules/matrix': org(RESPONSIBILITY, 'responsibility.read'),
  'GET /responsibility-rules/my-responsibilities': self(),
  'GET /responsibility-rules/resolve': org(RESPONSIBILITY, 'responsibility.read'),

  'GET /roles': org(RBAC, 'role.manage'),
  'POST /roles': org(RBAC, 'role.manage'),
  'GET /roles/{id}': org(RBAC, 'role.manage'),
  'PUT /roles/{id}': org(RBAC, 'role.manage'),
  'DELETE /roles/{id}': org(RBAC, 'role.manage'),
  'GET /roles/{id}/timeline': org(RBAC, 'role.manage'),
  'POST /roles/bulk-assign': org(RBAC, 'role.manage'),
  'GET /roles/users/{userId}': org(RBAC, 'role.manage'),
  'POST /roles/users/{userId}': org(RBAC, 'role.manage'),
  'DELETE /roles/users/{userId}/{roleId}': org(RBAC, 'role.manage'),
  'GET /roles/users/{userId}/timeline': org(RBAC, 'role.manage'),

  'GET /schedules': filtered('schedule.read'),
  'POST /schedules': unit('schedule.manage'),
  'GET /schedules/{id}': unit('schedule.read'),
  'PUT /schedules/{id}': unit('schedule.manage'),
  'DELETE /schedules/{id}': unit('schedule.manage'),
  'PATCH /schedules/{id}/archive': unit('schedule.manage'),
  'POST /schedules/{id}/duplicate': unit('schedule.manage'),
  'POST /schedules/{id}/generate': unit('schedule.optimize'),
  'GET /schedules/{id}/optimization': unit('schedule.optimize'),
  'DELETE /schedules/{id}/optimization': unit('schedule.optimize'),
  'GET /schedules/{id}/predecessor-candidates': unit('schedule.read'),
  'PATCH /schedules/{id}/publish': unit('schedule.publish'),
  'GET /schedules/{id}/replan-proposals': unit('schedule.optimize'),
  'POST /schedules/{id}/replan-proposals/{proposalId}/apply': unit('schedule.publish'),
  'POST /schedules/{id}/replan-proposals/{proposalId}/reject': unit('schedule.publish'),
  'GET /schedules/{id}/shifts': unit('schedule.read'),
  'GET /schedules/department/{departmentId}': unit('schedule.read'),
  'GET /schedules/user/{userId}': owned('the user themselves, or schedule.manage over a unit they belong to'),

  'GET /settings': org(CONFIG, 'settings.manage'),
  'GET /settings/{category}/{key}': org(CONFIG, 'settings.manage'),
  'PUT /settings/{category}/{key}': h(org(CONFIG), 'settings.manage'),
  'POST /settings/{category}/{key}/reset': h(org(CONFIG), 'settings.manage'),
  'GET /settings/category/{category}': org(CONFIG, 'settings.manage'),
  'GET /settings/currency': h(org(CONFIG)),
  'PUT /settings/currency': h(org(CONFIG), 'settings.manage'),
  'GET /settings/time-period': h(org(CONFIG)),
  'PUT /settings/time-period': h(org(CONFIG), 'settings.manage'),

  'GET /shift-swap': self('own swaps; approvers see every unit'),
  'POST /shift-swap': self('the caller must own the offered assignment'),
  'GET /shift-swap/{id}': self('a party to the swap, or an approver'),
  'POST /shift-swap/{id}/approve': unit('shiftswap.approve'),
  'POST /shift-swap/{id}/cancel': self('the requester only'),
  'POST /shift-swap/{id}/decline': unit('shiftswap.approve'),
  'POST /shift-swap/{id}/respond': self('the target only'),
  'GET /shift-swap/open': self('offers within the caller\'s units'),
  'POST /shift-swap/open': self('the caller must own the offered assignment'),
  'POST /shift-swap/open/{id}/cancel': self('the offerer only'),
  'POST /shift-swap/open/{id}/claim': self('a claimant within the offer\'s units'),

  'GET /shifts': filtered('schedule.read'),
  'GET /shifts/export': filtered('schedule.read'),
  'POST /shifts': unit('shift.manage'),
  'GET /shifts/{id}': unit('schedule.read'),
  'PUT /shifts/{id}': unit('shift.manage'),
  'DELETE /shifts/{id}': unit('shift.manage'),
  'GET /shifts/department/{departmentId}': unit('schedule.read'),
  'GET /shifts/schedule/{scheduleId}': unit('schedule.read'),
  'GET /shifts/staffing-suggestion': unit('schedule.read'),
  'GET /shifts/templates': filtered('schedule.read'),
  'POST /shifts/templates': unit('shift.manage'),
  'GET /shifts/templates/{id}': unit('schedule.read'),
  'PUT /shifts/templates/{id}': unit('shift.manage'),
  'DELETE /shifts/templates/{id}': unit('shift.manage'),

  'GET /skill-gap': gap(['report.read'], 'organization-wide aggregate'),
  'GET /skills': shared('the skills catalog is reference data for every unit', 'employee.read'),
  'POST /skills': org('the skills catalog is organization-wide; writing it changes every unit\'s vocabulary', 'employee.manage'),
  'GET /skills/{id}': shared('the skills catalog is reference data for every unit', 'employee.read'),
  'PUT /skills/{id}': org('the skills catalog is organization-wide; writing it changes every unit\'s vocabulary', 'employee.manage'),
  'DELETE /skills/{id}': org('the skills catalog is organization-wide; writing it changes every unit\'s vocabulary', 'employee.manage'),

  'GET /sso/providers': org(CONFIG, 'settings.manage'),
  'POST /sso/providers': org(CONFIG, 'settings.manage'),
  'GET /sso/providers/{id}': org(CONFIG, 'settings.manage'),
  'PUT /sso/providers/{id}': org(CONFIG, 'settings.manage'),
  'DELETE /sso/providers/{id}': org(CONFIG, 'settings.manage'),
  'GET /system/info': pub('version information'),

  'GET /time-off': { requires: [], owner: 'own requests; timeoff.approve sees their scope', scope: 'filtered' },
  'GET /time-off/export': { requires: [], owner: 'own requests; timeoff.approve sees their scope', scope: 'filtered' },
  'POST /time-off': self(),
  'GET /time-off/{id}': owned('the requester, or timeoff.approve over their unit'),
  'POST /time-off/{id}/approve': unit('timeoff.approve'),
  'POST /time-off/{id}/reject': unit('timeoff.approve'),
  'POST /time-off/{id}/cancel': self('the requester only'),

  'GET /timeline': filtered('timeline.read'),
  'GET /timeline/sources': { requires: ['timeline.read'], scope: 'self', note: 'returns the fixed list of event sources: constants, no data about anyone' },

  'GET /users': h(gap([], 'user.read in the handler; account administration lists every unit'), 'user.read', 'user.read_all'),
  'POST /users': unit('user.manage'),
  'GET /users/{id}': owned('the user themselves, or user.read over a unit they belong to'),
  'PUT /users/{id}': h(unit(), 'user.manage'),
  'DELETE /users/{id}': h(unit(), 'user.manage'),

  'GET /webhooks': org(CONFIG, 'settings.manage'),
  'POST /webhooks': org(CONFIG, 'settings.manage'),
  'PUT /webhooks/{id}': org(CONFIG, 'settings.manage'),
  'DELETE /webhooks/{id}': org(CONFIG, 'settings.manage'),
  'GET /webhooks/{id}/deliveries': org(CONFIG, 'settings.manage'),
};

/** Mounted routes outside the versioned API (not in openapi.json), by full path. */
export const EXTRA_OPERATIONS: Record<string, AuthzRule> = {
  'GET /metrics': pub('bearer METRICS_TOKEN when configured'),
  'GET /api/openapi.json': pub('the published API contract'),
  'GET /api/docs': pub('the published API contract'),
  'GET /api/docs-assets/swagger-init.js': pub('the published API contract'),
};
