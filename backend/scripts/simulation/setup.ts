/**
 * Simulation org setup — built by the administrator, through the API.
 *
 * The structure an HR administrator would create on day one: per department
 * spec (`name:count`) an org unit, a head whose Manager role is SCOPED to that
 * unit, a department bridged to the unit, and a roster created through
 * `POST /employees/batch` and placed in the unit. Every step is a real
 * request with the administrator's own session, so the setup itself
 * exercises employee creation, role grants, org-unit membership and
 * department membership.
 *
 * Everything the simulation creates is named `SIM <name>` and every
 * synthetic account is `sim.<slug>.<n>@simulation.local` — deterministic, so
 * a second run on the same database reuses what exists and creates only what
 * is missing, and nothing collides with demo-seed data. The previous setup
 * adopted demo-seeded department members into the roster; with HTTP actors
 * that is impossible (their passwords are not the simulation's), and it made
 * the roster depend on whichever seed the database happened to carry.
 *
 * Heads are scoped managers on purpose: a company-wide Manager grant (what the
 * previous setup inserted) can reach every unit, so no out-of-scope attempt
 * could ever be denied and the scope probes would test nothing.
 *
 * @author Luca Ostinelli
 */

import { login, refresh } from './httpAuth';
import { runWithConcurrency } from './concurrency';
import { Actor, World } from './world';

// Every synthetic account shares this password; actors log in with it.
export const SIM_PASSWORD = 'simulation-not-a-real-login';

/** Org-unit and department name prefix for everything the simulation owns. */
export const SIM_PREFIX = 'SIM ';

export interface DepartmentSpec {
  name: string;
  count: number;
}

interface RoleRow {
  id: number;
  name: string;
}

interface Named {
  id: number;
  name: string;
}

interface EmployeeRow {
  id: number;
  email: string;
}

const BATCH = 200; // MAX_BATCH_SIZE of batchCreateEmployeesBody

export const slugOf = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '');

const listOf = <T>(data: unknown, key?: string): T[] => {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    for (const k of [key, 'items', 'rows', 'data', 'employees', 'roles', 'departments', 'units'].filter(Boolean) as string[]) {
      if (Array.isArray(obj[k])) return obj[k] as T[];
    }
  }
  return [];
};

async function roleIds(world: World): Promise<{ manager: number; employee: number }> {
  const res = await world.admin.client.get('/roles');
  if (!world.expectOk(world.admin, res, 'setup.roles')) throw new Error('cannot list roles');
  const roles = listOf<RoleRow>(res.body.data);
  const find = (name: string): number => {
    const role = roles.find((r) => r.name === name);
    if (!role) throw new Error(`role "${name}" not found`);
    return role.id;
  };
  return { manager: find('Manager'), employee: find('Employee') };
}

async function ensureUnit(world: World, name: string): Promise<number> {
  const admin = world.admin;
  const list = await admin.client.get('/org/units');
  world.expectOk(admin, list, 'setup.org_units.list');
  const existing = listOf<Named>(list.body.data).find((u) => u.name === name);
  if (existing) return existing.id;
  const created = await admin.client.post<Named>('/org/units', { name, description: `[SIM] ${name}`, parentId: null });
  if (!world.expectOk(admin, created, 'setup.org_units.create')) throw new Error(`cannot create unit ${name}`);
  return created.body.data.id;
}

async function ensureDepartment(world: World, name: string, orgUnitId: number, headId: number): Promise<number> {
  const admin = world.admin;
  const list = await admin.client.get('/departments', { search: name });
  world.expectOk(admin, list, 'setup.departments.list');
  const existing = listOf<Named>(list.body.data).find((d) => d.name === name);
  if (existing) return existing.id;
  const created = await admin.client.post<Named>('/departments', {
    name,
    description: `[SIM] ${name}`,
    managerId: headId,
    orgUnitId,
  });
  if (!world.expectOk(admin, created, 'setup.departments.create')) throw new Error(`cannot create department ${name}`);
  return created.body.data.id;
}

async function findUserByEmail(world: World, email: string): Promise<number | null> {
  const res = await world.admin.client.get('/employees', { search: email, pageSize: 5 });
  world.expectOk(world.admin, res, 'setup.employees.search');
  const row = listOf<EmployeeRow>(res.body.data).find((e) => e.email === email);
  return row ? row.id : null;
}

/** Creates the given accounts in batches; returns email → id for all of them. */
async function createAccounts(
  world: World,
  accounts: Array<{ email: string; firstName: string; lastName: string; employeeId: string; position: string }>,
  employeeRoleId: number,
  departmentId: number | null
): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  for (let i = 0; i < accounts.length; i += BATCH) {
    const chunk = accounts.slice(i, i + BATCH);
    const res = await world.admin.client.post<{ results: Array<{ index: number; success: boolean; data?: { id: number }; error?: unknown }> }>(
      '/employees/batch',
      {
        employees: chunk.map((a) => ({
          ...a,
          password: SIM_PASSWORD,
          roleIds: [employeeRoleId],
          hourlyRate: 20,
          ...(departmentId ? { departmentIds: [departmentId] } : {}),
        })),
      }
    );
    if (!world.expectOk(world.admin, res, 'setup.employees.batch')) throw new Error('employee batch failed');
    for (const row of res.body.data.results) {
      if (row.success && row.data) ids.set(chunk[row.index].email, row.data.id);
      else world.log.info(`batch row ${chunk[row.index].email} not created: ${JSON.stringify(row.error)}`);
    }
  }
  return ids;
}

async function ensureHead(world: World, spec: DepartmentSpec, orgUnitId: number, roles: { manager: number; employee: number }): Promise<number> {
  const admin = world.admin;
  const slug = slugOf(spec.name);
  const email = `sim.${slug}.head@simulation.local`;
  let headId = await findUserByEmail(world, email);
  if (headId === null) {
    const created = await createAccounts(
      world,
      [{ email, firstName: 'Head', lastName: spec.name, employeeId: `SIM-${slug}-HEAD`, position: `[SIM] ${spec.name} head` }],
      roles.employee,
      null
    );
    headId = created.get(email) ?? null;
    if (headId === null) throw new Error(`cannot create head for ${spec.name}`);
  }
  // Manager scoped to the unit (see the header). Re-granting an existing
  // grant is a 409, which is fine on a rerun.
  const grant = await admin.client.post(`/roles/users/${headId}`, {
    roleId: roles.manager,
    scopeOrgUnitId: orgUnitId,
    justification: '[SIM] department head',
  });
  world.outcome(admin, grant, 'setup.grant_manager');
  const member = await admin.client.post(`/org/units/${orgUnitId}/members`, { userId: headId, isPrimary: true });
  world.outcome(admin, member, 'setup.head_membership');
  const unit = await admin.client.put(`/org/units/${orgUnitId}`, { managerUserId: headId });
  world.expectOk(admin, unit, 'setup.unit_manager');
  return headId;
}

export async function setupSimOrgs(world: World, specs: DepartmentSpec[], concurrency: number): Promise<void> {
  world.log.section('SETUP: simulated organization (administrator, over HTTP)');
  const roles = await roleIds(world);

  for (const spec of specs) {
    const name = `${SIM_PREFIX}${spec.name}`;
    const slug = slugOf(spec.name);
    const orgUnitId = await ensureUnit(world, name);
    const headId = await ensureHead(world, spec, orgUnitId, roles);
    const departmentId = await ensureDepartment(world, name, orgUnitId, headId);
    world.outcome(world.admin, await world.admin.client.post(`/departments/${departmentId}/users`, { userId: headId }), 'setup.head_department');

    // Roster: reuse what a previous run created, create the rest.
    const existingRes = await world.admin.client.get(`/employees/department/${departmentId}`);
    world.expectOk(world.admin, existingRes, 'setup.roster.list');
    const existing = new Map(listOf<EmployeeRow>(existingRes.body.data).map((e) => [e.email, e.id]));
    const wanted = Array.from({ length: spec.count }, (_, i) => {
      const n = String(i + 1).padStart(5, '0');
      return {
        email: `sim.${slug}.${n}@simulation.local`,
        firstName: 'Sim',
        lastName: `${spec.name} ${n}`,
        employeeId: `SIM-${slug}-${n}`,
        position: `[SIM] ${spec.name}`,
      };
    });
    const missing = wanted.filter((w) => !existing.has(w.email));
    const created = await createAccounts(world, missing, roles.employee, departmentId);
    // Placed concurrently, as an HR team working in parallel would. A failure
    // is a finding, and is then retried on its own: a person left without a
    // primary unit would make every later request of theirs unroutable, and
    // the run would report that consequence instead of continuing to test.
    const failed: typeof missing = [];
    await runWithConcurrency(missing.filter((m) => created.has(m.email)), concurrency, async (m) => {
      const res = await world.admin.client.post(`/org/units/${orgUnitId}/members`, { userId: created.get(m.email), isPrimary: true });
      if (!world.expectOk(world.admin, res, 'setup.employee_membership')) failed.push(m);
    });
    for (const m of failed) {
      const res = await world.admin.client.post(`/org/units/${orgUnitId}/members`, { userId: created.get(m.email), isPrimary: true });
      world.expectOk(world.admin, res, 'setup.employee_membership.retry');
    }
    world.log.info(
      `Department "${name}": unit #${orgUnitId}, department #${departmentId}, head #${headId}, ` +
        `${existing.size} existing + ${created.size} new employee account(s).`
    );

    world.departments.push({
      name,
      departmentId,
      orgUnitId,
      head: { kind: 'MANAGER', userId: headId, email: `sim.${slug}.head@simulation.local` } as Actor,
      employees: wanted.map((w) => ({ kind: 'EMPLOYEE', userId: created.get(w.email) ?? existing.get(w.email) ?? 0, email: w.email }) as Actor),
    });
  }
}

/** Logs every head and employee in with their own browser profile. */
export async function loginEveryone(world: World, concurrency: number): Promise<void> {
  world.log.section('LOGIN: every actor opens their own session');
  for (const dept of world.departments) {
    const placement = { orgUnitId: dept.orgUnitId, departmentId: dept.departmentId };
    // Each session is rotated once right away, as the SPA does on mount: it
    // proves the refresh cookie came back scoped to the refresh path.
    dept.head = await login(world, 'MANAGER', dept.head.email, SIM_PASSWORD, placement);
    await refresh(world, dept.head);
    dept.employees = await runWithConcurrency(dept.employees, concurrency, async (e) => {
      const actor = await login(world, 'EMPLOYEE', e.email, SIM_PASSWORD, placement);
      await refresh(world, actor);
      return actor;
    });
    const scope = dept.head.allowedOrgUnitIds;
    world.log.info(
      `${dept.name}: head #${dept.head.userId} reach=${scope === null ? 'company-wide' : JSON.stringify(scope)}, ` +
        `${dept.employees.length} employee session(s).`
    );
    if (scope === null) {
      world.dbFinding(`head of ${dept.name}`, 'a unit-scoped Manager grant was reported as company-wide reach');
    }
  }
}
