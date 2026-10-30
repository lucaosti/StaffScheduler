/**
 * The authorization matrix: every mounted operation, what admits a caller to
 * it, and how org-unit scope applies (#909).
 *
 * WHY A DECLARED TABLE. Authorization regressed silently for as long as it was
 * only implied by the code: two shift routes required no permission at all and
 * nothing noticed, and scope was enforced on four reads out of a hundred
 * operations (#813). `authorization.integration.test.ts` holds the running app
 * to this table in both directions — an operation without an entry fails, an
 * entry whose gate differs from the route's chain fails, and every `unit` entry
 * must be probed with another unit's ids and refused — so a change to who may
 * do what has to be made here, deliberately, where review sees it.
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
 *   - `filtered`: a list or aggregate bounded by the caller's scope.
 *   - `self`: acts only on the caller's own data.
 *   - `org`: organization-wide configuration or catalog; scope does not apply.
 *   - `gap`: unit-owned data whose scope is not enforced yet — each names the
 *     follow-up, so the gap is visible rather than implied.
 *
 * @author Luca Ostinelli
 */

export type ScopeRule = 'unit' | 'filtered' | 'self' | 'org' | 'gap';

export interface AuthzRule {
  requires: 'public' | string[];
  owner?: string;
  scope: ScopeRule;
  note?: string;
}

const pub = (note?: string): AuthzRule => ({ requires: 'public', scope: 'org', note });
const org = (...requires: string[]): AuthzRule => ({ requires, scope: 'org' });
const self = (note?: string): AuthzRule => ({ requires: [], scope: 'self', note });
const unit = (...requires: string[]): AuthzRule => ({ requires, scope: 'unit' });
const owned = (owner: string): AuthzRule => ({ requires: [], owner, scope: 'unit' });
const filtered = (...requires: string[]): AuthzRule => ({ requires, scope: 'filtered' });
const gap = (requires: string[], note: string): AuthzRule => ({ requires, scope: 'gap', note });

const DEPARTMENTS = 'departments are scoped through org_unit_id but these routes gate on department.* in the handler only';

export const AUTHORIZATION_MATRIX: Record<string, AuthzRule> = {
  'GET /approval-workflows': org('approval.manage'),
  'POST /approval-workflows': org('approval.manage'),
  'PUT /approval-workflows/{id}': org('approval.manage'),
  'DELETE /approval-workflows/{id}': org('approval.manage'),
  'GET /approval-workflows/{type}': org('approval.manage'),
  'POST /approval-workflows/escalate': org('approval.manage'),

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

  'GET /attendance': { requires: [], owner: 'own records; attendance.read/approve see their scope', scope: 'filtered' },
  'GET /attendance/export': { requires: [], owner: 'own records; attendance.read/approve see their scope', scope: 'filtered' },
  'GET /attendance/{id}': owned('the punching user, or attendance.read/approve over their unit'),
  'POST /attendance/{id}/approve': unit('attendance.approve'),
  'POST /attendance/{id}/reject': unit('attendance.approve'),
  'POST /attendance/{id}/clock-out': self(),
  'POST /attendance/clock-in': self(),
  'GET /attendance/cost-estimate': unit('attendance.read'),
  'POST /attendance/kiosk/punch': pub('kiosk device credential, bound to one department'),

  'GET /audit-logs': org('audit.read'),
  'GET /audit-logs/{id}': org('audit.read'),
  'GET /audit-logs/export': org('audit.read'),

  'POST /auth/2fa/challenge': self(),
  'POST /auth/2fa/disable': self(),
  'POST /auth/2fa/enable': self(),
  'GET /auth/2fa/methods': self(),
  'POST /auth/2fa/setup': self(),
  'POST /auth/2fa/verify': self(),
  'POST /auth/login': pub(),
  'POST /auth/login/challenge': pub(),
  'POST /auth/refresh': pub('refresh-token cookie'),
  'POST /auth/refresh/logout': pub('revokes whatever session it is presented with'),
  'GET /auth/sso/{id}/callback': pub(),
  'GET /auth/sso/{id}/login': pub(),
  'GET /auth/sso/providers': pub(),
  'GET /auth/verify': self(),

  'GET /calendar/aggregate.ics': pub('feed token; visibility recomputed from its owner (orgScope)'),
  'GET /calendar/department/{id}.ics': pub('feed token of the owner'),
  'GET /calendar/feed.ics': pub('feed token of the owner'),
  'GET /calendar/tokens': self(),
  'POST /calendar/tokens': self(),
  'DELETE /calendar/tokens/{id}': self(),

  'GET /change-requests': gap(['change_request.review'], 'reviewers see every unit'),
  'POST /change-requests': gap(['change_request.create'], 'target ids are not scope-checked'),
  'GET /change-requests/{id}': gap([], 'proposer or reviewer, any unit'),
  'POST /change-requests/{id}/apply': gap(['change_request.review'], 'any unit'),
  'POST /change-requests/{id}/approve': gap(['change_request.review'], 'any unit'),
  'POST /change-requests/{id}/cancel': self('proposer only'),
  'POST /change-requests/{id}/reject': gap(['change_request.review'], 'any unit'),

  'GET /cost-plans': filtered('report.read'),
  'POST /cost-plans': unit('report.manage'),
  'GET /cost-plans/{id}': unit('report.read'),
  'PUT /cost-plans/{id}': unit('report.manage'),
  'DELETE /cost-plans/{id}': unit('report.manage'),

  'GET /dashboard/attention-items': gap([], 'organization-wide counts behind in-handler permission checks'),
  'GET /dashboard/stats': gap([], 'organization-wide counts behind in-handler permission checks'),

  'GET /delegations': self(),
  'POST /delegations': self('delegation.manage or delegation.self; codes and scope must be the delegator\'s own (#814)'),
  'DELETE /delegations/{id}': self('the delegator only'),

  'GET /departments': gap([], DEPARTMENTS),
  'POST /departments': gap([], DEPARTMENTS),
  'GET /departments/{id}': gap([], DEPARTMENTS),
  'PUT /departments/{id}': gap([], DEPARTMENTS),
  'DELETE /departments/{id}': gap([], DEPARTMENTS),
  'GET /departments/{id}/geofences': gap([], DEPARTMENTS),
  'POST /departments/{id}/geofences': gap([], DEPARTMENTS),
  'PUT /departments/{id}/geofences/{geofenceId}': gap([], `${DEPARTMENTS}; child id not bound to the department (#850)`),
  'DELETE /departments/{id}/geofences/{geofenceId}': gap([], `${DEPARTMENTS}; child id not bound to the department (#850)`),
  'GET /departments/{id}/kiosks': gap([], DEPARTMENTS),
  'POST /departments/{id}/kiosks': gap([], DEPARTMENTS),
  'DELETE /departments/{id}/kiosks/{kioskId}': gap([], `${DEPARTMENTS}; child id not bound to the department (#850)`),
  'GET /departments/{id}/stats': gap([], DEPARTMENTS),
  'POST /departments/{id}/users': gap([], DEPARTMENTS),
  'DELETE /departments/{id}/users/{userId}': gap([], DEPARTMENTS),

  'POST /directory/import-vcard': org('user.manage'),
  'POST /directory/import-vcard/preview': org('user.manage'),
  'GET /directory/me': self(),
  'GET /directory/users/{id}': gap(['user.read'], 'account directory reads are not scoped'),
  'PUT /directory/users/{id}/fields': unit('user.manage'),
  'DELETE /directory/users/{id}/fields/{key}': unit('user.manage'),
  'GET /directory/users/{id}/vcard': gap(['user.read'], 'account directory reads are not scoped'),
  'GET /directory/vcard.vcf': gap(['user.read'], 'account directory reads are not scoped'),

  'GET /employee-field-policies': org(),
  'PUT /employee-field-policies': org('settings.manage'),
  'DELETE /employee-field-policies': org('settings.manage'),

  'GET /employee-pairings': gap(['employee.manage'], 'pairings name people of any unit'),
  'POST /employee-pairings': gap(['employee.manage'], 'pairings name people of any unit'),
  'GET /employee-pairings/{id}': gap(['employee.manage'], 'pairings name people of any unit'),
  'PUT /employee-pairings/{id}': gap(['employee.manage'], 'pairings name people of any unit'),
  'DELETE /employee-pairings/{id}': gap(['employee.manage'], 'pairings name people of any unit'),

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

  'GET /employment-contracts': gap(['employee.read'], 'contracts of any unit'),
  'POST /employment-contracts': gap(['preferences.manage'], 'contracts of any unit'),
  'GET /employment-contracts/{id}': gap(['employee.read'], 'contracts of any unit'),
  'PUT /employment-contracts/{id}': gap(['preferences.manage'], 'contracts of any unit'),
  'GET /employment-contracts/users/{userId}': gap(['employee.read'], 'contracts of any unit'),
  'POST /employment-contracts/users/{userId}': gap(['preferences.manage'], 'contracts of any unit'),

  'GET /events/stream': gap([], 'events are fanned out to every subscriber'),
  'GET /health': pub(),
  'GET /health/ready': pub(),

  'GET /i18n/overrides': self('the caller\'s organization'),
  'GET /i18n/overrides/admin': org('settings.manage'),
  'POST /i18n/overrides/admin': org('settings.manage'),
  'GET /i18n/overrides/admin/{id}': org('settings.manage'),
  'PUT /i18n/overrides/admin/{id}': org('settings.manage'),
  'DELETE /i18n/overrides/admin/{id}': org('settings.manage'),

  'POST /import/employees': gap(['employee.manage'], 'imported rows name departments of any unit'),
  'POST /import/shifts': gap(['employee.manage'], 'imported rows name departments of any unit'),

  'GET /integrations/payroll/export': org('payroll.manage'),
  'POST /integrations/payroll/export': org('payroll.manage'),
  'GET /integrations/payroll/export/{id}': org('payroll.manage'),

  'GET /modules': org('settings.manage'),
  'PUT /modules/{code}': org('settings.manage'),
  'PUT /modules/{code}/org/{org}': org('settings.manage'),
  'DELETE /modules/{code}/org/{org}': org('settings.manage'),
  'GET /modules/org/{org}': org('settings.manage'),

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
  'GET /on-call/periods': gap(['schedule.read'], 'on-call periods are department-owned but not scoped'),
  'POST /on-call/periods': gap(['oncall.manage'], 'on-call periods are department-owned but not scoped'),
  'GET /on-call/periods/{id}': gap(['schedule.read'], 'on-call periods are department-owned but not scoped'),
  'PUT /on-call/periods/{id}': gap(['oncall.manage'], 'on-call periods are department-owned but not scoped'),
  'DELETE /on-call/periods/{id}': gap(['oncall.manage'], 'on-call periods are department-owned but not scoped'),
  'POST /on-call/periods/{id}/assign': gap(['oncall.manage'], 'on-call periods are department-owned but not scoped'),
  'DELETE /on-call/periods/{id}/assign/{userId}': gap(['oncall.manage'], 'on-call periods are department-owned but not scoped'),
  'GET /on-call/periods/{id}/assignments': gap(['schedule.read'], 'on-call periods are department-owned but not scoped'),

  'GET /org/authority': self(),
  'GET /org/authority/{userId}': gap([], 'self, or org_unit.read for anyone in any unit'),
  'GET /org/history': self(),
  'GET /org/history/{userId}': gap([], 'self, or org_unit.read for anyone in any unit'),
  'GET /org/manager-chain': self(),
  'GET /org/manager-chain/{userId}': gap([], 'no permission check (#850)'),
  'GET /org/loans': { requires: [], owner: 'own loans; loan.approve sees loans touching their scope', scope: 'filtered' },
  'POST /org/loans': unit('loan.request'),
  'POST /org/loans/{id}/approve': unit('loan.approve'),
  'POST /org/loans/{id}/reject': unit('loan.approve'),
  'POST /org/loans/{id}/cancel': self('the requester only'),
  'GET /org/units': org('org_unit.read'),
  'POST /org/units': org('org_unit.manage'),
  'GET /org/units/tree': org('org_unit.read'),
  'GET /org/units/{id}': org('org_unit.read'),
  'PUT /org/units/{id}': org('org_unit.manage'),
  'DELETE /org/units/{id}': org('org_unit.manage'),
  'GET /org/units/{id}/members': org('org_unit.read'),
  'GET /org/units/{id}/members/detailed': org('org_unit.read'),
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

  'GET /permissions': org('role.manage'),
  'GET /policies': org('policy.read'),
  'POST /policies': org('policy.manage'),
  'GET /policies/{id}': org('policy.read'),
  'PUT /policies/{id}': org('policy.manage'),
  'DELETE /policies/{id}': org('policy.manage'),
  'GET /policies/approval-matrix': org(),
  'PUT /policies/approval-matrix/{changeType}': org('approval.manage'),
  'GET /policies/exceptions': gap([], 'exceptions of any unit'),
  'POST /policies/exceptions': gap([], 'target ids are not scope-checked'),
  'POST /policies/exceptions/{id}/approve': gap(['policy.approve'], 'any unit'),
  'POST /policies/exceptions/{id}/cancel': self('the requester only'),
  'POST /policies/exceptions/{id}/reject': gap(['policy.approve'], 'any unit'),
  'GET /policies/presets': org('policy.read'),
  'POST /policies/presets/{code}/apply': org('policy.manage'),
  'POST /policies/validate/assignment': org(),

  'GET /preferences/me': self(),
  'PUT /preferences/me': self(),
  'GET /preferences/{userId}': gap(['preferences.manage'], 'preferences of anyone in any unit'),
  'PUT /preferences/{userId}': gap(['preferences.manage'], 'preferences of anyone in any unit'),

  'GET /reports/attendance-anomalies': filtered('report.read'),
  'GET /reports/compliance-violations-trend': filtered('report.read'),
  'GET /reports/cost-by-department': filtered('report.read'),
  'GET /reports/cost-by-department/export': filtered('report.read'),
  'GET /reports/fairness/{scheduleId}': unit('report.read'),
  'GET /reports/fairness/{scheduleId}/export': unit('report.read'),
  'GET /reports/hours-worked': unit('report.read'),
  'GET /reports/hours-worked/export': unit('report.read'),

  'GET /responsibility-rules': org('responsibility.read'),
  'POST /responsibility-rules': org('responsibility.manage'),
  'GET /responsibility-rules/{id}': org('responsibility.read'),
  'PUT /responsibility-rules/{id}': org('responsibility.manage'),
  'DELETE /responsibility-rules/{id}': org('responsibility.manage'),
  'GET /responsibility-rules/{id}/conflicts': org('responsibility.read'),
  'POST /responsibility-rules/bulk': org('responsibility.manage'),
  'GET /responsibility-rules/matrix': org('responsibility.read'),
  'GET /responsibility-rules/my-responsibilities': self(),
  'GET /responsibility-rules/resolve': org('responsibility.read'),

  'GET /roles': org('role.manage'),
  'POST /roles': org('role.manage'),
  'GET /roles/{id}': org('role.manage'),
  'PUT /roles/{id}': org('role.manage'),
  'DELETE /roles/{id}': org('role.manage'),
  'GET /roles/{id}/timeline': org('role.manage'),
  'POST /roles/bulk-assign': org('role.manage'),
  'GET /roles/users/{userId}': org('role.manage'),
  'POST /roles/users/{userId}': org('role.manage'),
  'DELETE /roles/users/{userId}/{roleId}': org('role.manage'),
  'GET /roles/users/{userId}/timeline': org('role.manage'),

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

  'GET /settings': org('settings.manage'),
  'GET /settings/{category}/{key}': org('settings.manage'),
  'PUT /settings/{category}/{key}': org(),
  'POST /settings/{category}/{key}/reset': org(),
  'GET /settings/category/{category}': org('settings.manage'),
  'GET /settings/currency': org(),
  'PUT /settings/currency': org(),
  'GET /settings/time-period': org(),
  'PUT /settings/time-period': org(),

  'GET /shift-swap': self('own swaps; approvers see every unit'),
  'POST /shift-swap': self('the caller must own the offered assignment'),
  'GET /shift-swap/{id}': self('a party to the swap, or an approver'),
  'POST /shift-swap/{id}/approve': gap(['shiftswap.approve'], 'any unit'),
  'POST /shift-swap/{id}/cancel': self('the requester only'),
  'POST /shift-swap/{id}/decline': gap(['shiftswap.approve'], 'any unit'),
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
  'GET /shifts/templates': gap(['schedule.read'], 'templates are department-owned but not scoped'),
  'POST /shifts/templates': gap(['shift.manage'], 'templates are department-owned but not scoped'),
  'GET /shifts/templates/{id}': gap(['schedule.read'], 'templates are department-owned but not scoped'),
  'PUT /shifts/templates/{id}': gap(['shift.manage'], 'templates are department-owned but not scoped'),
  'DELETE /shifts/templates/{id}': gap(['shift.manage'], 'templates are department-owned but not scoped'),

  'GET /skill-gap': gap(['report.read'], 'organization-wide aggregate'),
  'GET /skills': org('employee.read'),
  'POST /skills': org('employee.manage'),
  'GET /skills/{id}': org('employee.read'),
  'PUT /skills/{id}': org('employee.manage'),
  'DELETE /skills/{id}': org('employee.manage'),

  'GET /sso/providers': org('settings.manage'),
  'POST /sso/providers': org('settings.manage'),
  'GET /sso/providers/{id}': org('settings.manage'),
  'PUT /sso/providers/{id}': org('settings.manage'),
  'DELETE /sso/providers/{id}': org('settings.manage'),
  'GET /system/info': pub(),

  'GET /time-off': { requires: [], owner: 'own requests; timeoff.approve sees their scope', scope: 'filtered' },
  'GET /time-off/export': { requires: [], owner: 'own requests; timeoff.approve sees their scope', scope: 'filtered' },
  'POST /time-off': self(),
  'GET /time-off/{id}': owned('the requester, or timeoff.approve over their unit'),
  'POST /time-off/{id}/approve': unit('timeoff.approve'),
  'POST /time-off/{id}/reject': unit('timeoff.approve'),
  'POST /time-off/{id}/cancel': self('the requester only'),

  'GET /timeline': filtered('timeline.read'),
  'GET /timeline/sources': org('timeline.read'),

  'GET /users': gap([], 'user.read in the handler; account administration lists every unit'),
  'POST /users': org(),
  'GET /users/{id}': gap([], 'self, or user.read for anyone in any unit'),
  'PUT /users/{id}': unit(),
  'DELETE /users/{id}': unit(),

  'GET /webhooks': org('settings.manage'),
  'POST /webhooks': org('settings.manage'),
  'PUT /webhooks/{id}': org('settings.manage'),
  'DELETE /webhooks/{id}': org('settings.manage'),
  'GET /webhooks/{id}/deliveries': org('settings.manage'),
};

/** Mounted routes outside the versioned API (not in openapi.json), by full path. */
export const EXTRA_OPERATIONS: Record<string, AuthzRule> = {
  'GET /metrics': pub('bearer METRICS_TOKEN when configured'),
  'GET /api/openapi.json': pub(),
  'GET /api/docs': pub(),
  'GET /api/docs-assets/swagger-init.js': pub(),
};
