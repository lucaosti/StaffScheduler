/**
 * Administrator actor: company-wide configuration, review work, and the
 * dedicated destructive step.
 *
 *   configure — the day-one setup an administrator performs before people
 *               start using the system: skills and contracts, policies and a
 *               compliance preset, approval routing, responsibility rules,
 *               roles, settings, modules, field policies, translations, SSO
 *               and webhook integrations, kiosks and geofences, accounts
 *               imported by CSV and vCard. Each entity it creates is read back
 *               and edited through the API.
 *   review    — once per round: change requests (approve-and-apply or
 *               reject), cost plans, payroll export, audit log, escalation.
 *   kiosk     — the shared tablet: a device credential, not a user session,
 *               punching employees in and out by employee code.
 *   twoFactor — one employee enrols TOTP, logs in with a code, and turns it
 *               off with a recovery code — the codes computed as an
 *               authenticator app would.
 *   modules   — a module switched off company-wide must disappear (404) for
 *               a head who could use it a moment earlier, and come back.
 *   destroy   — every DELETE the run has not already exercised, against
 *               entities created for the purpose, so nothing the rest of the
 *               simulation depends on is removed. Kept to its own step at the
 *               end because a deletion mid-run would change what later
 *               rounds verify.
 *
 * @author Luca Ostinelli
 */

import { totp } from '../../src/utils/totp';
import { HttpResult } from './httpClient';
import { login } from './httpAuth';
import { RoundContext } from './employeeActor';
import { SIM_PASSWORD } from './setup';
import { Actor, World } from './world';

const listOf = <T>(data: unknown): T[] => {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object') {
    for (const v of Object.values(data as Record<string, unknown>)) if (Array.isArray(v)) return v as T[];
  }
  return [];
};

/** Entities the administrator created, kept for later steps. */
export interface AdminState {
  exceptionPolicyId: number | null;
  contractId: number | null;
  skillId: number | null;
  kioskToken: string | null;
  kioskId: number | null;
  /** Created only so the destroy step can delete them. */
  disposable: Array<[string, string]>;
}

export async function configure(world: World, tag: string): Promise<AdminState> {
  const admin = world.admin;
  const c = admin.client;
  const dept = world.departments[0];
  const someone = dept.employees[0] ?? dept.head;
  const state: AdminState = { exceptionPolicyId: null, contractId: null, skillId: null, kioskToken: null, kioskId: null, disposable: [] };
  const ok = <T>(res: HttpResult<T>, what: string): res is HttpResult<T> & { body: { data: T } } =>
    world.expectOk(admin, res, `admin.${what}`);
  world.log.section('CONFIGURE: administrator sets the company up');

  // Public and system surface.
  ok(await c.get('/health'), 'health');
  ok(await c.get('/health/ready'), 'health.ready');
  ok(await c.get('/system/info'), 'system.info');
  ok(await c.get('/auth/sso/providers'), 'sso.public_providers');
  ok(await c.get('/events/stream', undefined, { headersOnly: true }), 'events.stream');

  // Skills, attached to an employee.
  const skill = await c.post<{ id: number }>('/skills', { name: `SIM skill ${tag}`, description: '[SIM]' });
  if (ok(skill, 'skill.create')) {
    state.skillId = skill.body.data.id;
    ok(await c.get(`/skills/${state.skillId}`), 'skill.get');
    ok(await c.put(`/skills/${state.skillId}`, { description: '[SIM] edited' }), 'skill.update');
    ok(await c.get('/skills', { activeOnly: 'true' }), 'skill.list');
    world.outcome(admin, await c.post(`/employees/${someone.userId}/skills`, { skillId: state.skillId, proficiencyLevel: 3 }), 'employee_skill.add');
    ok(await c.get(`/employees/${someone.userId}/skills`), 'employee_skill.list');
  }
  const spareSkill = await c.post<{ id: number }>('/skills', { name: `SIM spare skill ${tag}` });
  if (ok(spareSkill, 'skill.create_spare')) state.disposable.push(['DELETE', `/skills/${spareSkill.body.data.id}`]);

  // Employment contract, assigned to an employee.
  const contract = await c.post<{ id: number }>('/employment-contracts', { name: `SIM contract ${tag}`, maxHoursPerWeek: 48, minHoursBetweenShifts: 8 });
  if (ok(contract, 'contract.create')) {
    state.contractId = contract.body.data.id;
    ok(await c.get(`/employment-contracts/${state.contractId}`), 'contract.get');
    ok(await c.put(`/employment-contracts/${state.contractId}`, { description: '[SIM] edited' }), 'contract.update');
    ok(await c.get('/employment-contracts'), 'contract.list');
    world.outcome(
      admin,
      await c.post(`/employment-contracts/users/${someone.userId}`, { contractId: state.contractId, effectiveFrom: new Date().toISOString().slice(0, 10) }),
      'contract.assign'
    );
  }

  // Shift templates per department.
  for (const d of world.departments) {
    const tpl = await d.head.client.post<{ id: number }>('/shifts/templates', {
      name: `SIM morning ${tag}`,
      departmentId: d.departmentId,
      startTime: '07:00:00',
      endTime: '15:00:00',
      minStaff: 1,
      maxStaff: 3,
    });
    if (world.expectOk(d.head, tpl, 'shift_template.create')) {
      world.expectOk(d.head, await d.head.client.get(`/shifts/templates/${tpl.body.data.id}`), 'shift_template.get');
      world.expectOk(d.head, await d.head.client.put(`/shifts/templates/${tpl.body.data.id}`, { description: '[SIM] edited' }), 'shift_template.update');
      state.disposable.push(['DELETE', `/shifts/templates/${tpl.body.data.id}`]);
    }
    world.expectOk(d.head, await d.head.client.get('/shifts/templates'), 'shift_template.list');
  }

  // Policies: a preset, a global policy employees may ask an exception to,
  // and the read side.
  const presets = await c.get<Array<{ key: string }>>('/policies/presets');
  if (ok(presets, 'policy.presets')) {
    const first = listOf<{ key: string }>(presets.body.data)[0];
    if (first) ok(await c.post(`/policies/presets/${encodeURIComponent(first.key)}/apply`), 'policy.preset.apply');
  }
  const policy = await c.post<{ id: number }>('/policies', {
    scopeType: 'global',
    scopeId: null,
    policyKey: `sim.dress_code.${tag}`,
    policyValue: { strict: true },
    description: '[SIM] a policy employees ask exceptions to',
  });
  if (world.outcome(admin, policy, 'policy.create') && policy.body.data) {
    state.exceptionPolicyId = policy.body.data.id;
    ok(await c.get(`/policies/${state.exceptionPolicyId}`), 'policy.get');
    ok(await c.put(`/policies/${state.exceptionPolicyId}`, { description: '[SIM] edited' }), 'policy.update');
  }
  ok(await c.get('/policies'), 'policy.list');
  const sparePolicy = await c.post<{ id: number }>('/policies', { scopeType: 'org_unit', scopeId: dept.orgUnitId, policyKey: `sim.spare.${tag}`, policyValue: 1 });
  if (world.outcome(admin, sparePolicy, 'policy.create_spare') && sparePolicy.body.data) state.disposable.push(['DELETE', `/policies/${sparePolicy.body.data.id}`]);

  // Approval routing: matrix re-saved as it is, a custom workflow.
  const matrix = await c.get<Array<{ changeType: string; approverScope: string; autoApproveForOwner?: boolean }>>('/policies/approval-matrix');
  if (ok(matrix, 'approval_matrix.list')) {
    const row = listOf<{ changeType: string; approverScope: string; autoApproveForOwner?: boolean }>(matrix.body.data).find((r) => r.changeType === 'Membership.Update');
    if (row) {
      ok(await c.put(`/policies/approval-matrix/${row.changeType}`, { approverScope: row.approverScope, autoApproveForOwner: row.autoApproveForOwner ?? true }), 'approval_matrix.update');
    }
  }
  ok(await c.get('/approval-workflows'), 'workflow.list');
  ok(await c.get('/approval-workflows/TimeOff.Request'), 'workflow.get');
  const wf = await c.post<{ id: number }>('/approval-workflows', {
    changeType: `Sim.Request.${tag}`,
    description: '[SIM] custom workflow',
    steps: [{ stepOrder: 1, approverScope: 'unit_manager', escalateAfterHours: 48 }],
  });
  if (ok(wf, 'workflow.create')) {
    ok(await c.put(`/approval-workflows/${wf.body.data.id}`, { description: '[SIM] edited' }), 'workflow.update');
    state.disposable.push(['DELETE', `/approval-workflows/${wf.body.data.id}`]);
  }

  // Responsibility rules.
  ok(await c.get('/responsibility-rules'), 'responsibility.list');
  ok(await c.get('/responsibility-rules/matrix'), 'responsibility.matrix');
  ok(await c.get('/responsibility-rules/resolve', { permissionCode: 'timeoff.approve', orgUnitId: dept.orgUnitId }), 'responsibility.resolve');
  const rule = await c.post<{ id: number }>('/responsibility-rules', {
    subjectType: 'org_unit',
    subjectId: dept.orgUnitId,
    permissionCode: 'attendance.approve',
    responsibleOrgUnitId: dept.orgUnitId,
    description: '[SIM] rule',
  });
  if (world.outcome(admin, rule, 'responsibility.create') && rule.body.data) {
    ok(await c.get(`/responsibility-rules/${rule.body.data.id}`), 'responsibility.get');
    ok(await c.get(`/responsibility-rules/${rule.body.data.id}/conflicts`), 'responsibility.conflicts');
    ok(await c.put(`/responsibility-rules/${rule.body.data.id}`, { description: '[SIM] edited' }), 'responsibility.update');
    state.disposable.push(['DELETE', `/responsibility-rules/${rule.body.data.id}`]);
  }
  const bulk = await c.post<{ created?: Array<{ id: number }> }>('/responsibility-rules/bulk', {
    subjectType: 'org_unit',
    subjectIds: [dept.orgUnitId],
    permissionCodes: ['oncall.manage'],
    responsibleOrgUnitId: dept.orgUnitId,
    description: '[SIM] bulk',
  });
  world.outcome(admin, bulk, 'responsibility.bulk');

  // Roles: a custom role granted and revoked, timelines.
  ok(await c.get('/permissions'), 'permission.list');
  const role = await c.post<{ id: number }>('/roles', { name: `SIM auditor ${tag}`, description: '[SIM]', permissionCodes: ['audit.read'] });
  if (ok(role, 'role.create')) {
    const roleId = role.body.data.id;
    ok(await c.get(`/roles/${roleId}`), 'role.get');
    ok(await c.put(`/roles/${roleId}`, { description: '[SIM] edited', permissionCodes: ['audit.read', 'report.read'] }), 'role.update');
    ok(await c.post('/roles/bulk-assign', { roleId, userIds: [someone.userId], justification: '[SIM]' }), 'role.bulk_assign');
    ok(await c.get(`/roles/users/${someone.userId}`), 'role.of_user');
    ok(await c.get(`/roles/users/${someone.userId}/timeline`), 'role.user_timeline');
    ok(await c.get(`/roles/${roleId}/timeline`), 'role.timeline');
    state.disposable.push(['DELETE', `/roles/users/${someone.userId}/${roleId}`]);
    state.disposable.push(['DELETE', `/roles/${roleId}`]);
  }

  // Settings and modules.
  ok(await c.get('/settings'), 'settings.list');
  ok(await c.get('/settings/category/general'), 'settings.category');
  ok(await c.get('/settings/general/currency'), 'settings.get');
  ok(await c.put('/settings/currency', { currency: 'EUR' }), 'settings.currency');
  ok(await c.put('/settings/time-period', { timePeriod: 'monthly' }), 'settings.time_period');
  ok(await c.put('/settings/scheduling/max_shifts_per_week', { value: '6' }), 'settings.put');
  ok(await c.post('/settings/scheduling/max_shifts_per_week/reset'), 'settings.reset');
  ok(await c.get('/modules'), 'modules.list');
  const org = encodeURIComponent(`SIM Org ${tag}`);
  ok(await c.put(`/modules/forecasting/org/${org}`, { isEnabled: false, justification: '[SIM]' }), 'modules.org_override');
  ok(await c.get(`/modules/org/${org}`), 'modules.org');
  state.disposable.push(['DELETE', `/modules/forecasting/org/${org}`]);

  // Employee field policy, translations, integrations.
  ok(await c.get('/employee-field-policies'), 'field_policy.list');
  const fieldKey = `custom:sim_badge_${tag.replace(/[^a-z0-9]/gi, '_')}`;
  ok(await c.put('/employee-field-policies', { fieldKey, isRequired: false, maxLength: 32, helpText: '[SIM]' }), 'field_policy.put');
  state.disposable.push(['DELETE', `/employee-field-policies?fieldKey=${encodeURIComponent(fieldKey)}`]);
  ok(await c.get('/i18n/overrides', { locale: 'en' }), 'i18n.public');
  ok(await c.get('/i18n/overrides/admin'), 'i18n.list');
  const i18n = await c.post<{ id: number }>('/i18n/overrides/admin', { organizationName: `SIM Org ${tag}`, locale: 'en', overrides: { 'sim.greeting': 'Hello' } });
  if (ok(i18n, 'i18n.create')) {
    ok(await c.get(`/i18n/overrides/admin/${i18n.body.data.id}`), 'i18n.get');
    ok(await c.put(`/i18n/overrides/admin/${i18n.body.data.id}`, { overrides: { 'sim.greeting': 'Hi' } }), 'i18n.update');
    state.disposable.push(['DELETE', `/i18n/overrides/admin/${i18n.body.data.id}`]);
  }
  const sso = await c.post<{ id: number }>('/sso/providers', {
    organizationName: `SIM Org ${tag}`,
    name: `SIM IdP ${tag}`,
    issuer: 'https://idp.simulation.invalid',
    clientId: 'sim-client',
    clientSecret: 'sim-secret',
    authorizationUrl: 'https://idp.simulation.invalid/authorize',
    tokenUrl: 'https://idp.simulation.invalid/token',
    jwksUrl: 'https://idp.simulation.invalid/jwks',
  });
  if (ok(sso, 'sso.create')) {
    const id = sso.body.data.id;
    ok(await c.get('/sso/providers'), 'sso.list');
    ok(await c.get(`/sso/providers/${id}`), 'sso.get');
    ok(await c.put(`/sso/providers/${id}`, { name: `SIM IdP ${tag} (edited)` }), 'sso.update');
    // The login leg redirects to the IdP (3xx); the callback needs a real
    // IdP's signed token, so a bogus code must be refused — not accepted.
    const anon = world.newClient();
    world.outcome(admin, await anon.get(`/auth/sso/${id}/login`), 'sso.login');
    const cb = await anon.get(`/auth/sso/${id}/callback`, { code: 'bogus', state: 'bogus' });
    if (cb.status >= 200 && cb.status < 300) world.dbFinding(`SSO provider #${id}`, 'the callback accepted a forged code');
    else if (cb.status >= 500) world.dbFinding(`SSO provider #${id}`, `the callback answered ${cb.status} to a forged code`);
    state.disposable.push(['DELETE', `/sso/providers/${id}`]);
  }
  await webhooks(world, tag, state);

  // Department devices: a kiosk (its token is the kiosk actor's credential)
  // and a geofence.
  const kiosk = await c.post<{ id: number; token: string }>(`/departments/${dept.departmentId}/kiosks`, { name: `SIM kiosk ${tag}` });
  if (ok(kiosk, 'kiosk.create')) {
    state.kioskToken = kiosk.body.data.token;
    state.kioskId = kiosk.body.data.id;
    ok(await c.get(`/departments/${dept.departmentId}/kiosks`), 'kiosk.list');
  }
  const fence = await c.post<{ id: number }>(`/departments/${dept.departmentId}/geofences`, {
    name: `SIM fence ${tag}`,
    polygon: [
      { lat: 45.0, lng: 9.0 },
      { lat: 45.0, lng: 9.01 },
      { lat: 45.01, lng: 9.01 },
    ],
  });
  if (ok(fence, 'geofence.create')) {
    ok(await c.get(`/departments/${dept.departmentId}/geofences`), 'geofence.list');
    ok(await c.put(`/departments/${dept.departmentId}/geofences/${fence.body.data.id}`, { isActive: false }), 'geofence.update');
    state.disposable.push(['DELETE', `/departments/${dept.departmentId}/geofences/${fence.body.data.id}`]);
  }

  // Directory and people reads.
  ok(await c.get('/users'), 'user.list');
  ok(await c.get(`/users/${someone.userId}`), 'user.get');
  ok(await c.put(`/users/${someone.userId}`, { phone: '+390000000000' }), 'user.update');
  ok(await c.get('/employees', { pageSize: 20 }), 'employee.list');
  ok(await c.get('/employees/export', { format: 'csv' }), 'employee.export');
  ok(await c.put(`/employees/${someone.userId}`, { position: '[SIM] senior' }), 'employee.update');
  ok(await c.get(`/directory/users/${someone.userId}`), 'directory.get');
  ok(await c.put(`/directory/users/${someone.userId}/fields`, { fields: [{ key: 'sim_locker', value: 'L-42' }] }), 'directory.fields');
  state.disposable.push(['DELETE', `/directory/users/${someone.userId}/fields/sim_locker`]);
  ok(await c.get(`/directory/users/${someone.userId}/vcard`), 'directory.vcard');
  ok(await c.get('/directory/vcard.vcf', { ids: `${someone.userId},${dept.head.userId}` }), 'directory.vcards');
  ok(await c.put(`/departments/${dept.departmentId}`, { description: `[SIM] ${dept.name} (edited)` }), 'department.update');
  ok(await c.get('/org/units/tree'), 'org.tree');
  ok(await c.get(`/org/units/${dept.orgUnitId}`), 'org.unit');
  ok(await c.patch(`/org/units/${dept.orgUnitId}/members/${someone.userId}/primary`), 'org.set_primary');

  return state;
}

/**
 * Webhooks belong to an organization, and the bootstrap administrator has
 * none (the demo seed is single-tenant). So the administrator appoints an
 * integration administrator of a named organization — through the API — and
 * that person, with their own session, manages the subscription.
 */
async function webhooks(world: World, tag: string, state: AdminState): Promise<void> {
  const c = world.admin.client;
  const roles = await c.get<Array<{ id: number; name: string }>>('/roles');
  const adminRole = listOf<{ id: number; name: string }>(roles.body.data).find((r) => r.name === 'Administrator');
  if (!adminRole) return world.dbFinding('roles', 'no Administrator role listed');
  const email = `sim.integrations.${tag}@simulation.local`;
  const created = await c.post<{ id: number }>('/employees', { email, password: SIM_PASSWORD, firstName: 'Integration', lastName: 'Admin', roleIds: [adminRole.id] });
  if (!world.expectOk(world.admin, created, 'admin.integration_admin.create')) return;
  world.expectOk(world.admin, await c.put(`/users/${created.body.data.id}`, { organizationName: `SIM Org ${tag}` }), 'admin.integration_admin.org');
  const owner = await login(world, 'ADMIN', email, SIM_PASSWORD);
  const oc = owner.client;
  const hook = await oc.post<{ id: number }>('/webhooks', { url: 'https://hooks.simulation.invalid/sim', eventTypes: ['schedule.published'] });
  if (world.expectOk(owner, hook, 'webhook.create')) {
    const id = hook.body.data.id;
    world.expectOk(owner, await oc.get('/webhooks'), 'webhook.list');
    world.expectOk(owner, await oc.put(`/webhooks/${id}`, { isActive: false }), 'webhook.update');
    world.expectOk(owner, await oc.get(`/webhooks/${id}/deliveries`, { limit: 5 }), 'webhook.deliveries');
    // Another organization's administrator must not see or touch it.
    world.expectDenied(world.admin, await c.put(`/webhooks/${id}`, { isActive: true }), "administrator of another organization edits a webhook");
    world.expectOk(owner, await oc.delete(`/webhooks/${id}`), 'webhook.delete');
  }
  state.disposable.push(['DELETE', `/employees/${created.body.data.id}`]);
}

/** Accounts imported by CSV and vCard, recorded for verification. */
export async function importAccounts(world: World, tag: string, ledgerImported: Set<string>): Promise<void> {
  const c = world.admin.client;
  const csvEmail = `sim.import.${tag}@simulation.local`;
  const csv = await c.post('/import/employees', { csv: `email,firstName,lastName,role\n${csvEmail},Imported,CSV,Employee`, defaultPassword: SIM_PASSWORD });
  if (world.expectOk(world.admin, csv, 'admin.import.csv')) ledgerImported.add(csvEmail);
  const vcfEmail = `sim.vcard.${tag}@simulation.local`;
  const vcf = `BEGIN:VCARD\nVERSION:3.0\nFN:Imported VCard\nN:VCard;Imported;;;\nEMAIL:${vcfEmail}\nEND:VCARD`;
  world.expectOk(world.admin, await c.post('/directory/import-vcard/preview', { vcf }), 'admin.import.vcard_preview');
  if (world.expectOk(world.admin, await c.post('/directory/import-vcard', { vcf, defaultPassword: SIM_PASSWORD }), 'admin.import.vcard')) {
    ledgerImported.add(vcfEmail);
  }
}

/** The administrator's review work for a round. */
export async function review(world: World, ctx: RoundContext, thorough: boolean): Promise<void> {
  const admin = world.admin;
  const c = admin.client;
  const { ledger } = ctx;

  // A request may already be approved through its approval step (the unit
  // manager's queue); the administrator then applies it. Pending ones are
  // reviewed here: one rejected for every two approved-and-applied, the
  // rejection first so a run with a single pending request still has one.
  const crs = await c.get<{ items: Array<{ id: number; status: string }> }>('/change-requests', { limit: 100 });
  if (world.expectOk(admin, crs, 'admin.change_request.list')) {
    let i = 0;
    for (const cr of listOf<{ id: number; status: string }>(crs.body.data)) {
      if (!ledger.changeRequests.has(cr.id)) continue;
      if (cr.status === 'approved') {
        if (world.outcome(admin, await c.post(`/change-requests/${cr.id}/apply`, { justification: '[SIM] applied' }), 'change_request.apply')) {
          ledger.changeRequests.set(cr.id, 'applied');
        }
        continue;
      }
      if (cr.status !== 'pending') continue;
      if (i++ % 3 === 0) {
        if (world.outcome(admin, await c.post(`/change-requests/${cr.id}/reject`, { rejectionReason: '[SIM] not now' }), 'change_request.reject')) {
          ledger.changeRequests.set(cr.id, 'rejected');
        }
      } else if (world.outcome(admin, await c.post(`/change-requests/${cr.id}/approve`, { justification: '[SIM] fine' }), 'change_request.approve')) {
        ledger.changeRequests.set(cr.id, 'approved');
        if (world.outcome(admin, await c.post(`/change-requests/${cr.id}/apply`, { justification: '[SIM] applied' }), 'change_request.apply')) {
          ledger.changeRequests.set(cr.id, 'applied');
        }
      }
    }
  }

  for (const d of world.departments) {
    const plan = await c.post<{ id: number }>('/cost-plans', {
      departmentId: d.departmentId,
      startDate: ctx.periodStart,
      endDate: ctx.periodEnd,
      targetAmount: 1000 * (ctx.round + 1),
    });
    if (world.outcome(admin, plan, 'cost_plan.create') && plan.body.data) {
      ledger.costPlans.set(plan.body.data.id, 1000 * (ctx.round + 1));
      if (thorough) {
        world.expectOk(admin, await c.get(`/cost-plans/${plan.body.data.id}`), 'admin.cost_plan.get');
        if (world.expectOk(admin, await c.put(`/cost-plans/${plan.body.data.id}`, { targetAmount: 1234.5 }), 'admin.cost_plan.update')) {
          ledger.costPlans.set(plan.body.data.id, 1234.5);
        }
      }
    }
  }

  // Policy exceptions still pending (the administrator owns the policy):
  // decided on the exception's own routes, approve and reject alternating.
  const ex = await c.get<Array<{ id: number; status: string }>>('/policies/exceptions', { status: 'pending' });
  if (world.expectOk(admin, ex, 'admin.policy_exception.list')) {
    let k = 0;
    for (const e of listOf<{ id: number; status: string }>(ex.body.data)) {
      if (!ledger.policyExceptions.has(e.id) || e.status !== 'pending') continue;
      const approve = k++ % 2 === 0;
      const res = await c.post(`/policies/exceptions/${e.id}/${approve ? 'approve' : 'reject'}`, { notes: '[SIM] reviewed' });
      if (world.outcome(admin, res, 'policy_exception.decide')) ledger.policyExceptions.set(e.id, approve ? 'approved' : 'rejected');
    }
  }

  world.expectOk(admin, await c.post('/approval-workflows/escalate'), 'admin.escalate');
  if (thorough) {
    const exp = await c.post<{ id: number }>('/integrations/payroll/export', { startDate: ctx.periodStart, endDate: ctx.periodEnd });
    if (world.expectOk(admin, exp, 'admin.payroll.create')) {
      world.expectOk(admin, await c.get(`/integrations/payroll/export/${exp.body.data.id}`), 'admin.payroll.get');
    }
    world.expectOk(admin, await c.get('/integrations/payroll/export'), 'admin.payroll.list');
    const audit = await c.get<Array<{ id: number }>>('/audit-logs', { pageSize: 5 });
    if (world.expectOk(admin, audit, 'admin.audit.list')) {
      const first = listOf<{ id: number }>(audit.body.data)[0];
      if (first) world.expectOk(admin, await c.get(`/audit-logs/${first.id}`), 'admin.audit.get');
    }
    world.expectOk(admin, await c.get('/audit-logs/export', { format: 'csv' }), 'admin.audit.export');
    world.expectOk(admin, await c.get('/org/units'), 'admin.org.units');
  }
}

/** The shared tablet: punches by employee code with a device token. */
export async function kioskShift(world: World, token: string, people: Actor[], codeOf: (a: Actor) => string, ledger: RoundContext['ledger']): Promise<void> {
  const kiosk = world.newClient();
  const headers = { 'X-Kiosk-Token': token };
  for (const person of people) {
    for (const leg of ['in', 'out']) {
      const res = await kiosk.post<{ action: string; record: { id: number } }>('/attendance/kiosk/punch', { employeeId: codeOf(person) }, { headers });
      if (res.status >= 500) world.dbFinding(`kiosk punch ${leg} for #${person.userId}`, `server answered ${res.status}`);
      else if (res.status === 200 && res.body.data?.record?.id) ledger.attendanceOwners.set(res.body.data.record.id, person.userId);
      world.log.count(`kiosk.punch.${res.status}`);
    }
  }
  const forged = await kiosk.post('/attendance/kiosk/punch', { employeeId: codeOf(people[0]) }, { headers: { 'X-Kiosk-Token': 'not-a-device' } });
  if (forged.status === 200) world.dbFinding('kiosk punch', 'a forged device token was accepted');
  else world.log.verify(true, 'kiosk forged token', `refused with ${forged.status}`);
}

/** TOTP enrolment, a second-factor login, and disabling with a recovery code. */
export async function twoFactor(world: World, person: Actor): Promise<void> {
  const c = person.client;
  const setup = await c.post<{ secret: string }>('/auth/2fa/setup', { methodType: 'totp' });
  if (!world.expectOk(person, setup, '2fa.setup')) return;
  const secret = setup.body.data.secret;
  const enable = await c.post<{ recoveryCodes?: string[] }>('/auth/2fa/enable', { code: totp(secret), methodType: 'totp' });
  if (!world.expectOk(person, enable, '2fa.enable')) return;
  const recovery = enable.body.data.recoveryCodes ?? [];

  // Without a code the login must be refused; with the next step's code it
  // must succeed (the current step was consumed by `enable` — replay is
  // refused by design).
  const anon = world.newClient();
  const noCode = await anon.post('/auth/login', { email: person.email, password: SIM_PASSWORD }, { noRefresh: true });
  if (noCode.status === 200) world.dbFinding(`2FA of ${world.label(person)}`, 'login without a code succeeded on a 2FA account');
  world.outcome(person, await anon.post('/auth/login/challenge', { email: person.email, password: SIM_PASSWORD, methodType: 'totp' }), '2fa.login_challenge');
  world.outcome(person, await c.post('/auth/2fa/challenge', { methodType: 'totp' }), '2fa.challenge');
  // The next step's code (inside the ±1 window, after the step `enable`
  // consumed) must open a session; the same code a second time must not.
  const next = totp(secret, { nowSeconds: Math.floor(Date.now() / 1000) + 30 });
  try {
    const second = await login(world, 'EMPLOYEE', person.email, SIM_PASSWORD, { orgUnitId: person.orgUnitId, departmentId: person.departmentId }, next);
    world.log.verify(true, `2FA login of ${world.label(person)}`, `session for #${second.userId} opened with a TOTP code`);
  } catch (err) {
    world.dbFinding(`2FA login of ${world.label(person)}`, `a fresh TOTP code was refused: ${(err as Error).message}`);
  }
  const replay = await world.newClient().post('/auth/login', { email: person.email, password: SIM_PASSWORD, code: next }, { noRefresh: true });
  if (replay.status === 200) world.dbFinding(`2FA login of ${world.label(person)}`, 'a TOTP code was accepted twice');
  else world.log.verify(true, `2FA replay for ${world.label(person)}`, `replayed code refused with ${replay.status}`);
  world.outcome(person, await c.post('/auth/2fa/verify', { code: next, methodType: 'totp' }), '2fa.verify');
  if (recovery.length === 0) {
    world.dbFinding(`2FA of ${world.label(person)}`, 'enable returned no recovery codes');
    return;
  }
  world.expectOk(person, await c.post('/auth/2fa/disable', { code: recovery[0], methodType: 'totp' }), '2fa.disable');
}

/** A module switched off must vanish for a head and come back when on. */
export async function moduleToggle(world: World, head: Actor, departmentId: number, start: string, end: string): Promise<void> {
  const c = world.admin.client;
  const path = '/reports/hours-worked';
  const query = { departmentId, startDate: start, endDate: end };
  if (!world.expectOk(world.admin, await c.put('/modules/reporting', { isEnabled: false, justification: '[SIM] maintenance' }), 'admin.module.disable')) return;
  const off = await head.client.get(path, query);
  if (off.status !== 404) world.dbFinding('module reporting disabled', `a head still reached ${path} (status ${off.status})`);
  else world.log.verify(true, 'module gate', 'reporting disabled → 404 for the head');
  world.expectOk(world.admin, await c.put('/modules/reporting', { isEnabled: true, justification: '[SIM] back' }), 'admin.module.enable');
  world.expectOk(head, await head.client.get(path, query), 'report.after_module_enable');
}

/** Web push and native device registration for one person. */
export async function pushRegistration(world: World, person: Actor): Promise<void> {
  const c = person.client;
  world.outcome(person, await c.get('/notifications/push/public-key'), 'push.public_key');
  const endpoint = `https://push.simulation.invalid/${person.userId}`;
  world.expectOk(person, await c.post('/notifications/push/subscribe', { endpoint, keys: { p256dh: 'BSimulationKey', auth: 'simAuth' } }), 'push.subscribe');
  world.expectOk(person, await c.delete('/notifications/push/subscribe', { endpoint }), 'push.unsubscribe');
  const token = `sim-device-${person.userId}`;
  world.expectOk(person, await c.post('/notifications/push/device-token', { platform: 'android', token }), 'push.device.register');
  world.expectOk(person, await c.delete('/notifications/push/device-token', { token }), 'push.device.unregister');
}

/** Calendar feeds beyond the personal one: department and aggregate. */
export async function calendarFeeds(world: World, head: Actor, departmentId: number): Promise<void> {
  const token = await head.client.post<{ token: string }>('/calendar/tokens', { label: '[SIM] team calendar' });
  if (!world.expectOk(head, token, 'calendar.token.create')) return;
  const anon = world.newClient();
  world.expectOk(head, await anon.get(`/calendar/department/${departmentId}.ics`, { token: token.body.data.token }), 'calendar.department');
  world.expectOk(head, await anon.get('/calendar/aggregate.ics', { token: token.body.data.token, departmentId: String(departmentId), futureDays: 30 }), 'calendar.aggregate');
}

/**
 * The destructive step: deletes everything created for the purpose, plus
 * temporary people, units, departments and schedules made here. Each deletion
 * with a read route is read back (404 expected).
 */
export async function destroy(world: World, state: AdminState, tag: string, scheduleToCopy: number | null): Promise<void> {
  const admin = world.admin;
  const c = admin.client;
  const dept = world.departments[0];
  world.log.section('DESTROY: dedicated step for destructive administrative operations');

  // Temporary people and structure.
  const user = await c.post<{ id: number }>('/users', {
    email: `sim.temp.user.${tag}@simulation.local`,
    password: SIM_PASSWORD,
    firstName: 'Temp',
    lastName: 'User',
  });
  if (world.expectOk(admin, user, 'admin.user.create')) state.disposable.push(['DELETE', `/users/${user.body.data.id}`]);
  const emp = await c.post<{ id: number }>('/employees', {
    email: `sim.temp.employee.${tag}@simulation.local`,
    password: SIM_PASSWORD,
    firstName: 'Temp',
    lastName: 'Employee',
    departmentIds: [dept.departmentId],
  });
  if (world.expectOk(admin, emp, 'admin.employee.create')) {
    const id = emp.body.data.id;
    if (state.skillId) {
      world.outcome(admin, await c.post(`/employees/${id}/skills`, { skillId: state.skillId, proficiencyLevel: 1 }), 'admin.employee_skill.add');
      state.disposable.push(['DELETE', `/employees/${id}/skills/${state.skillId}`]);
    }
    world.outcome(admin, await c.post(`/org/units/${dept.orgUnitId}/members`, { userId: id, isPrimary: false }), 'admin.member.add');
    state.disposable.push(['DELETE', `/org/units/${dept.orgUnitId}/members/${id}`]);
    world.outcome(admin, await c.post(`/departments/${dept.departmentId}/users`, { userId: id }), 'admin.department_user.add');
    state.disposable.push(['DELETE', `/departments/${dept.departmentId}/users/${id}`]);
    state.disposable.push(['DELETE', `/employees/${id}`]);
  }
  const unit = await c.post<{ id: number }>('/org/units', { name: `SIM temp unit ${tag}`, parentId: dept.orgUnitId });
  if (world.expectOk(admin, unit, 'admin.unit.create')) state.disposable.push(['DELETE', `/org/units/${unit.body.data.id}`]);
  const tempDept = await c.post<{ id: number }>('/departments', { name: `SIM temp department ${tag}` });
  if (world.expectOk(admin, tempDept, 'admin.department.create')) state.disposable.push(['DELETE', `/departments/${tempDept.body.data.id}`]);
  if (state.kioskId) state.disposable.push(['DELETE', `/departments/${dept.departmentId}/kiosks/${state.kioskId}`]);

  // Schedules: one copy deleted (with hand-made assignments removed first),
  // one archived.
  if (scheduleToCopy) {
    const copy = await dept.head.client.post<{ id: number }>(`/schedules/${scheduleToCopy}/duplicate`, {
      name: `[SIM] copy ${tag}`,
      startDate: '2099-01-01',
      endDate: '2099-01-07',
    });
    if (world.expectOk(dept.head, copy, 'schedule.duplicate')) {
      const copyId = copy.body.data.id;

      // Cancellation: the worker runs one solve at a time, so of two
      // generations queued back to back the second is still waiting and must
      // cancel cleanly; the first may already be running, where a refusal is
      // an outcome but a 5xx is a finding. The waiting copy is then archived.
      // Done before the manual assignments below, so the solve cannot replace
      // rows this step later deletes.
      const spare = await dept.head.client.post<{ id: number }>(`/schedules/${scheduleToCopy}/duplicate`, {
        name: `[SIM] archived copy ${tag}`,
        startDate: '2099-02-01',
        endDate: '2099-02-07',
      });
      if (world.expectOk(dept.head, spare, 'schedule.duplicate')) {
        const spareId = spare.body.data.id;
        const first = await dept.head.client.post(`/schedules/${copyId}/generate`);
        const second = await dept.head.client.post(`/schedules/${spareId}/generate`);
        if (first.status === 202 && second.status === 202) {
          world.expectOk(dept.head, await dept.head.client.delete(`/schedules/${spareId}/optimization`), 'schedule.optimization.cancel_waiting');
          world.outcome(dept.head, await dept.head.client.delete(`/schedules/${copyId}/optimization`), 'schedule.optimization.cancel_running');
          // Let a solve that could not be cancelled finish first.
          for (let i = 0; i < 600; i++) {
            const st = await dept.head.client.get<{ state: string }>(`/schedules/${copyId}/optimization`);
            if (st.status !== 200 || st.body.data?.state === 'completed' || st.body.data?.state === 'failed') break;
            await new Promise((r) => setTimeout(r, 500));
          }
        }
        world.expectOk(dept.head, await dept.head.client.patch(`/schedules/${spareId}/archive`), 'schedule.archive');
      }

      const shifts = await c.get<Array<{ id: number }>>(`/schedules/${copyId}/shifts`);
      world.expectOk(admin, shifts, 'admin.schedule.shifts');
      const firstShift = listOf<{ id: number }>(shifts.body.data)[0];
      if (firstShift) world.expectOk(admin, await c.get(`/shifts/${firstShift.id}`), 'admin.shift.get');
      const shift = listOf<{ id: number }>(shifts.body.data)[0];
      const a = dept.employees[0];
      if (shift && a) {
        const bulkRes = await dept.head.client.post('/assignments/bulk', { assignments: [{ shiftId: shift.id, userId: a.userId, notes: '[SIM] bulk' }] });
        world.outcome(dept.head, bulkRes, 'assignment.bulk');
        const b = dept.employees[1];
        if (b) world.outcome(dept.head, await dept.head.client.post('/assignments/batch', { assignments: [{ shiftId: shift.id, userId: b.userId, reason: '[SIM]' }] }), 'assignment.batch');
        const list = await dept.head.client.get<Array<{ id: number; userId: number }>>(`/assignments/shift/${shift.id}`);
        for (const row of listOf<{ id: number; userId: number }>(list.body.data)) {
          // Only a confirmed assignment can be completed, and only its
          // assignee confirms it.
          const assignee = dept.employees.find((e) => e.userId === row.userId);
          if (assignee) world.outcome(assignee, await assignee.client.patch(`/assignments/${row.id}/confirm`), 'assignment.confirm');
          world.outcome(dept.head, await dept.head.client.patch(`/assignments/${row.id}/complete`), 'assignment.complete');
          state.disposable.push(['DELETE', `/assignments/${row.id}`]);
        }
        state.disposable.push(['DELETE', `/shifts/${shift.id}`]);
      }
      state.disposable.push(['DELETE', `/schedules/${copyId}`]);
    }
  }

  // On-call period created only to be deleted.
  const period = await dept.head.client.post<{ id: number }>('/on-call/periods', { departmentId: dept.departmentId, date: '2099-01-01', startTime: '00:00:00', endTime: '06:00:00' });
  if (world.expectOk(dept.head, period, 'on_call.create_disposable')) state.disposable.push(['DELETE', `/on-call/periods/${period.body.data.id}`]);
  const plan = await c.post<{ id: number }>('/cost-plans', { departmentId: dept.departmentId, startDate: '2099-01-01', endDate: '2099-01-31', targetAmount: 1 });
  if (world.expectOk(admin, plan, 'admin.cost_plan.create_disposable')) state.disposable.push(['DELETE', `/cost-plans/${plan.body.data.id}`]);

  // Children before parents: the list was built parent-last where it matters.
  for (const [method, path] of state.disposable) {
    const asHead = path.startsWith('/shifts') || path.startsWith('/schedules') || path.startsWith('/assignments') || path.startsWith('/on-call');
    const who = asHead ? dept.head : admin;
    const [p, q] = path.split('?');
    const query = q ? Object.fromEntries(new URLSearchParams(q)) : undefined;
    const res = await who.client.request(method, p, undefined, { query });
    if (!world.expectOk(who, res, `destroy ${p}`)) continue;
    // Read it back where the entity has a read route: gone is 404. People
    // are deactivated rather than erased, so a 200 there is logged, not failed.
    if (!query && world.recorder.resolve('GET', p) === world.recorder.resolve('DELETE', p)?.replace(/^DELETE/, 'GET')) {
      const back = await who.client.get(p);
      if (back.status === 404) world.log.verify(true, `destroy ${p}`, 'reads back as 404');
      else world.log.info(`destroy ${p}: reads back with ${back.status} (soft delete or still referenced)`);
    }
  }
}
