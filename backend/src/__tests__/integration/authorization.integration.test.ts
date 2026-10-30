/**
 * Authorization matrix suite (#909) — every mounted operation against the real
 * app and a real MySQL, for each kind of caller.
 *
 * What it proves, and how:
 *
 *  1. COMPLETENESS. The operation list is the OpenAPI spec (which must hold
 *     every mounted operation) cross-checked against the Express router tree:
 *     every route the app mounts is reached by some declared operation, and
 *     every operation has an entry in `authorizationMatrix.ts`. A new route
 *     without an entry fails here.
 *  2. THE DECLARED GATE IS THE REAL ONE. Each operation's middleware chain is
 *     read off the router (`helpers/routeChain`) and must carry exactly the
 *     declared `requirePermission` codes and `authenticate` — and an operation
 *     carrying a scope guard must be declared `unit`.
 *  3. THE GATE WORKS. Every non-public operation answers 401 to an
 *     unauthenticated caller, and every permission-gated one answers 403 to a
 *     caller lacking the permission (an Employee, or a role-less account where
 *     the Employee holds it).
 *  4. SCOPE WORKS. Every `unit` operation is probed by a Manager scoped to unit
 *     A with unit B's ids — in the path AND in the body — and must answer 404
 *     (see AccessPolicy for why not 403). A delegatee holding Manager codes for
 *     unit A only is probed the same way (#814), list endpoints must not return
 *     unit B's rows, and the same calls on unit A's rows succeed, so the scope
 *     check is not simply refusing everything.
 *
 * Run with: npm run test:integration (provisions and drops its own database).
 *
 * @author Luca Ostinelli
 */

const ITEST_DB = `${process.env.ITEST_DB_NAME || 'staff_scheduler_itest'}_authz`;
process.env.DB_NAME = ITEST_DB;
process.env.NODE_ENV = 'test';
// Redis is not this suite's subject; see api.integration.test.ts.
process.env.REDIS_ENABLED = 'false';

import mysql from 'mysql2/promise';
import bcrypt from 'bcrypt';
import request from 'supertest';
import type { Express } from 'express';
import { migrationUpSql } from '../helpers/schema';
import { allRoutes, resolveRoute } from '../helpers/routeChain';
import { AUTHORIZATION_MATRIX, EXTRA_OPERATIONS, AuthzRule } from './authorizationMatrix';

const DB = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
};
const PASSWORD = 'authz-password-123';
const API = '/api/v1';
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/**
 * `scopedAdmin` holds the Administrator role for unit A only: the prober for
 * permissions no Manager holds (e.g. `report.manage`): the scope binds every
 * code the same way. (`role.manage` is the one org-wide exception for account
 * writes — see UserAuthorityService.)
 */
type Principal = 'admin' | 'scopedAdmin' | 'scopedManager' | 'unscopedManager' | 'employee' | 'nobody' | 'delegatee';

/** Ids of the fixture rows; `A*` lie in the scoped manager's unit, `B*` outside it. */
interface Fixtures {
  unitA: number; unitA1: number; unitB: number;
  deptA: number; deptB: number;
  schedA: number; schedB: number;
  shiftA: number; shiftA2: number; shiftB: number;
  asgA: number; asgB: number;
  empA: number; empB: number; unassigned: number;
  toA: number; toB: number;
  attB: number; loanB: number; cpB: number; skill: number;
  users: Record<Principal, number>;
}

interface Probe {
  as?: Principal;
  params?: Record<string, number | string>;
  body?: unknown;
  query?: Record<string, string | number>;
  /** Expected status; 404 unless stated. */
  status?: number;
  check?: (body: any) => void;
}

const D1 = '2031-03-03';
const D2 = '2031-03-30';

/**
 * Cross-unit probes: unit B's ids, as the Manager scoped to unit A. Every `unit`
 * entry of the matrix must appear here.
 */
const crossUnitProbes = (f: Fixtures): Record<string, Probe[]> => {
  const sched = (params: Record<string, number | string> = {}) => ({ params: { id: f.schedB, ...params } });
  const failedRow = { status: 207, check: (b: any) => expect(b.data.failed).toBe(1) };
  return {
    'POST /assignments': [
      { body: { shiftId: f.shiftB, userId: f.empA } },
      { body: { shiftId: f.shiftA2, userId: f.empB } },
    ],
    'POST /assignments/bulk': [{ body: { assignments: [{ shiftId: f.shiftB, userId: f.empA }] } }],
    'POST /assignments/batch': [
      { body: { assignments: [{ shiftId: f.shiftB, userId: f.empA }] }, ...failedRow },
      { body: { assignments: [{ shiftId: f.shiftA2, userId: f.empB }] }, ...failedRow },
    ],
    'GET /assignments/{id}': [{ params: { id: f.asgB } }],
    'PUT /assignments/{id}': [{ params: { id: f.asgB }, body: { notes: 'x' } }],
    'DELETE /assignments/{id}': [{ params: { id: f.asgB }, body: {} }],
    'PATCH /assignments/{id}/complete': [{ params: { id: f.asgB } }],
    'PATCH /assignments/{id}/confirm': [{ params: { id: f.asgB } }],
    'PATCH /assignments/{id}/decline': [{ params: { id: f.asgB } }],
    'GET /assignments/department/{departmentId}': [{ params: { departmentId: f.deptB } }],
    'GET /assignments/shift/{shiftId}': [{ params: { shiftId: f.shiftB } }],
    'GET /assignments/shift/{shiftId}/available-employees': [{ params: { shiftId: f.shiftB } }],
    'GET /assignments/user/{userId}': [{ params: { userId: f.empB } }],

    'GET /attendance/{id}': [{ params: { id: f.attB } }],
    'POST /attendance/{id}/approve': [{ params: { id: f.attB }, body: {} }],
    'POST /attendance/{id}/reject': [{ params: { id: f.attB }, body: {} }],
    'GET /attendance/cost-estimate': [{ query: { startDate: D1, endDate: D2, departmentId: f.deptB } }],

    'POST /cost-plans': [{ as: 'scopedAdmin', body: { departmentId: f.deptB, startDate: D1, endDate: D2, targetAmount: 10 } }],
    'GET /cost-plans/{id}': [{ params: { id: f.cpB } }],
    'PUT /cost-plans/{id}': [{ as: 'scopedAdmin', params: { id: f.cpB }, body: { targetAmount: 5 } }],
    'DELETE /cost-plans/{id}': [{ as: 'scopedAdmin', params: { id: f.cpB } }],

    'PUT /directory/users/{id}/fields': [{ params: { id: f.empB }, body: { fields: [{ key: 'k', value: 'v' }] } }],
    'DELETE /directory/users/{id}/fields/{key}': [{ params: { id: f.empB, key: 'k' } }],

    'POST /employees': [{
      body: { email: 'authz-new@example.com', password: 'longenough1', firstName: 'N', lastName: 'E', departmentIds: [f.deptB] },
    }],
    'POST /employees/batch': [{
      body: { employees: [{ email: 'authz-new2@example.com', password: 'longenough1', firstName: 'N', lastName: 'E', departmentIds: [f.deptB] }] },
      ...failedRow,
    }],
    'GET /employees/{id}': [{ params: { id: f.empB } }],
    'PUT /employees/{id}': [{ params: { id: f.empB }, body: { firstName: 'Moved' } }],
    'DELETE /employees/{id}': [{ params: { id: f.empB } }],
    'GET /employees/{id}/skills': [{ params: { id: f.empB } }],
    'POST /employees/{id}/skills': [{ params: { id: f.empB }, body: { skillId: f.skill, proficiencyLevel: 3 } }],
    'DELETE /employees/{id}/skills/{skillId}': [{ params: { id: f.empB, skillId: f.skill } }],
    'GET /employees/department/{departmentId}': [{ params: { departmentId: f.deptB } }],

    'POST /org/loans': [
      { body: { userId: f.empB, fromOrgUnitId: f.unitB, toOrgUnitId: f.unitA, startDate: D1, endDate: D2 } },
      { body: { userId: f.empB, fromOrgUnitId: f.unitA, toOrgUnitId: f.unitA1, startDate: D1, endDate: D2 } },
    ],
    'POST /org/loans/{id}/approve': [{ params: { id: f.loanB }, body: {} }],
    'POST /org/loans/{id}/reject': [{ params: { id: f.loanB }, body: {} }],
    'POST /org/units/{id}/members': [
      { params: { id: f.unitB }, body: { userId: f.empA } },
      // Pulling another unit's person into one's own unit (#813 review).
      { params: { id: f.unitA }, body: { userId: f.empB } },
    ],
    'DELETE /org/units/{id}/members/{userId}': [{ params: { id: f.unitB, userId: f.empB } }],
    'PATCH /org/units/{id}/members/{userId}/primary': [{ params: { id: f.unitB, userId: f.empB } }],

    'GET /reports/fairness/{scheduleId}': [{ params: { scheduleId: f.schedB } }],
    'GET /reports/fairness/{scheduleId}/export': [{ params: { scheduleId: f.schedB } }],
    'GET /reports/hours-worked': [{ query: { startDate: D1, endDate: D2, departmentId: f.deptB } }],
    'GET /reports/hours-worked/export': [{ query: { startDate: D1, endDate: D2, departmentId: f.deptB } }],

    'POST /schedules': [
      { body: { name: 'X', startDate: D1, endDate: D2, departmentId: f.deptB } },
      { body: { name: 'X', startDate: D1, endDate: D2, departmentId: f.deptA, previousScheduleId: f.schedB } },
    ],
    'GET /schedules/{id}': [sched()],
    'PUT /schedules/{id}': [
      { ...sched(), body: { name: 'Y' } },
      // Moving one's own schedule into another unit.
      { params: { id: f.schedA }, body: { departmentId: f.deptB } },
    ],
    'DELETE /schedules/{id}': [sched()],
    'PATCH /schedules/{id}/archive': [sched()],
    'POST /schedules/{id}/duplicate': [{ ...sched(), body: { name: 'Copy', startDate: D1, endDate: D2 } }],
    'POST /schedules/{id}/generate': [sched()],
    'GET /schedules/{id}/optimization': [sched()],
    'DELETE /schedules/{id}/optimization': [sched()],
    'GET /schedules/{id}/predecessor-candidates': [sched()],
    'PATCH /schedules/{id}/publish': [{ ...sched(), body: {} }],
    'GET /schedules/{id}/replan-proposals': [sched()],
    'POST /schedules/{id}/replan-proposals/{proposalId}/apply': [{ ...sched({ proposalId: 1 }), body: {} }],
    'POST /schedules/{id}/replan-proposals/{proposalId}/reject': [{ ...sched({ proposalId: 1 }), body: {} }],
    'GET /schedules/{id}/shifts': [sched()],
    'GET /schedules/department/{departmentId}': [{ params: { departmentId: f.deptB } }],
    'GET /schedules/user/{userId}': [{ params: { userId: f.empB } }],

    'POST /shifts': [
      { body: { scheduleId: f.schedB, departmentId: f.deptA, date: D1, startTime: '09:00', endTime: '17:00', minStaff: 1, maxStaff: 2 } },
      { body: { scheduleId: f.schedA, departmentId: f.deptB, date: D1, startTime: '09:00', endTime: '17:00', minStaff: 1, maxStaff: 2 } },
    ],
    'GET /shifts/{id}': [{ params: { id: f.shiftB } }],
    'PUT /shifts/{id}': [{ params: { id: f.shiftB }, body: { notes: 'x' } }],
    'DELETE /shifts/{id}': [{ params: { id: f.shiftB } }],
    'GET /shifts/department/{departmentId}': [{ params: { departmentId: f.deptB } }],
    'GET /shifts/schedule/{scheduleId}': [{ params: { scheduleId: f.schedB } }],
    'GET /shifts/staffing-suggestion': [{ query: { departmentId: f.deptB, date: D1, startTime: '09:00', endTime: '17:00' } }],

    'GET /time-off/{id}': [{ params: { id: f.toB } }],
    'POST /time-off/{id}/approve': [{ params: { id: f.toB }, body: {} }],
    'POST /time-off/{id}/reject': [{ params: { id: f.toB }, body: {} }],

    'PUT /users/{id}': [
      { params: { id: f.empB }, body: { firstName: 'Moved' } },
    ],
    'DELETE /users/{id}': [{ params: { id: f.empB } }],
  };
};

/** The delegatee holds Manager codes for unit A only, through a delegation (#814). */
const delegateeProbes = (f: Fixtures): Array<[string, Probe]> => [
  ['GET /schedules/{id}', { params: { id: f.schedB } }],
  ['PUT /shifts/{id}', { params: { id: f.shiftB }, body: { notes: 'x' } }],
  ['POST /assignments', { body: { shiftId: f.shiftB, userId: f.empA } }],
  ['GET /employees/{id}', { params: { id: f.empB } }],
  ['POST /time-off/{id}/approve', { params: { id: f.toB }, body: {} }],
  ['GET /schedules/{id}', { params: { id: f.schedA }, status: 200 }],
  ['GET /shifts/{id}', { params: { id: f.shiftA }, status: 200 }],
];

/** The same kind of calls on unit A's rows succeed: scope narrows, it does not refuse. */
const inUnitProbes = (f: Fixtures): Array<[string, Probe]> => [
  ['GET /schedules/{id}', { params: { id: f.schedA }, status: 200 }],
  ['GET /shifts/schedule/{scheduleId}', { params: { scheduleId: f.schedA }, status: 200 }],
  ['PUT /shifts/{id}', { params: { id: f.shiftA }, body: { notes: 'in unit' }, status: 200 }],
  ['POST /assignments', { body: { shiftId: f.shiftA2, userId: f.empA }, status: 201 }],
  ['GET /assignments/{id}', { params: { id: f.asgA }, status: 200 }],
  ['GET /employees/{id}', { params: { id: f.empA }, status: 200 }],
  ['GET /time-off/{id}', { params: { id: f.toA }, status: 200 }],
  ['GET /reports/hours-worked', { query: { startDate: D1, endDate: D2, departmentId: f.deptA }, status: 200 }],
  // A person who belongs nowhere may be placed in one's own unit.
  ['POST /org/units/{id}/members', { params: { id: f.unitA1 }, body: { userId: f.unassigned }, status: 201 }],
];

/** List endpoints, as the scoped Manager: unit A's rows in, unit B's out. */
const listProbes = (f: Fixtures): Array<{ path: string; query?: Record<string, string>; ids: (body: any) => number[]; has: number; lacks: number }> => [
  { path: '/schedules', ids: (b) => b.data.map((s: any) => s.id), has: f.schedA, lacks: f.schedB },
  { path: '/shifts', ids: (b) => b.data.map((s: any) => s.id), has: f.shiftA, lacks: f.shiftB },
  { path: '/assignments', ids: (b) => b.data.map((a: any) => a.id), has: f.asgA, lacks: f.asgB },
  { path: '/employees', ids: (b) => b.data.map((u: any) => u.id), has: f.empA, lacks: f.empB },
  { path: '/time-off', ids: (b) => b.data.map((t: any) => t.id), has: f.toA, lacks: f.toB },
  { path: '/attendance', ids: (b) => b.data.map((a: any) => a.id), has: -1, lacks: f.attB },
  { path: '/org/loans', ids: (b) => b.data.map((l: any) => l.id), has: -1, lacks: f.loanB },
  { path: '/cost-plans', ids: (b) => b.data.map((c: any) => c.id), has: -1, lacks: f.cpB },
  {
    path: '/reports/cost-by-department',
    query: { startDate: D1, endDate: D2 },
    ids: (b) => b.data.map((r: any) => r.departmentId),
    has: f.deptA,
    lacks: f.deptB,
  },
];

let admin: mysql.Connection;
let app: Express;
let closeAppPool: () => Promise<void>;
let f: Fixtures;
const cookies: Partial<Record<Principal, string>> = {};
let spec: { paths: Record<string, Record<string, unknown>> };

const insert = async (sql: string, params: unknown[] = []): Promise<number> => {
  const [res] = await admin.query<mysql.ResultSetHeader>(sql, params);
  return res.insertId;
};

const createUser = async (email: string, unitId: number | null, role: string | null, scope: number | null = null): Promise<number> => {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const id = await insert(
    `INSERT INTO users (email, password_hash, first_name, last_name, is_active, hourly_rate) VALUES (?, ?, 'Authz', ?, 1, 20)`,
    [email, hash, email]
  );
  if (unitId !== null) await insert('INSERT INTO user_org_units (user_id, org_unit_id, is_primary) VALUES (?, ?, 1)', [id, unitId]);
  if (role !== null) {
    await admin.query(
      `INSERT INTO user_roles (user_id, role_id, scope_org_unit_id) SELECT ?, id, ? FROM roles WHERE name = ?`,
      [id, scope, role]
    );
  }
  return id;
};

const login = async (email: string): Promise<string> => {
  const res = await request(app).post(`${API}/auth/login`).send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  const setCookie = res.headers['set-cookie'] as unknown as string[];
  return setCookie.map((c) => c.split(';')[0]).join('; ');
};

const concretePath = (specPath: string, params: Record<string, number | string> = {}): string =>
  specPath.replace(/\{([^}]+)\}/g, (_m, name: string) => String(params[name] ?? 1));

const call = (as: Principal | null, op: string, probe: Probe = {}) => {
  const [method, specPath] = op.split(' ');
  let req = request(app)[method.toLowerCase() as 'get'](`${API}${concretePath(specPath, probe.params)}`);
  if (as) req = req.set('Cookie', cookies[as]!);
  if (probe.query) req = req.query(probe.query);
  if (method !== 'GET') req = req.send((probe.body ?? {}) as object);
  return req;
};

const specOperations = (): string[] =>
  Object.entries(spec.paths).flatMap(([p, ops]) =>
    Object.keys(ops).filter((m) => METHODS.includes(m)).map((m) => `${m.toUpperCase()} ${p}`)
  );

beforeAll(async () => {
  admin = await mysql.createConnection({ ...DB, multipleStatements: true });
  await admin.query(`DROP DATABASE IF EXISTS \`${ITEST_DB}\``);
  await admin.query(`CREATE DATABASE \`${ITEST_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await admin.query(`USE \`${ITEST_DB}\``);
  await admin.query(migrationUpSql());

  const unitA = await insert(`INSERT INTO org_units (name, is_active) VALUES ('Unit A', 1)`);
  const unitA1 = await insert(`INSERT INTO org_units (name, parent_id, is_active) VALUES ('Unit A1', ?, 1)`, [unitA]);
  const unitB = await insert(`INSERT INTO org_units (name, is_active) VALUES ('Unit B', 1)`);
  const unitC = await insert(`INSERT INTO org_units (name, is_active) VALUES ('Unit C', 1)`);
  const deptA = await insert(`INSERT INTO departments (name, is_active, org_unit_id) VALUES ('Dept A', 1, ?)`, [unitA]);
  const deptB = await insert(`INSERT INTO departments (name, is_active, org_unit_id) VALUES ('Dept B', 1, ?)`, [unitB]);

  const users: Record<Principal, number> = {
    admin: await createUser('authz-admin@example.com', null, 'Administrator'),
    scopedAdmin: await createUser('authz-admin-a@example.com', unitA, 'Administrator', unitA),
    scopedManager: await createUser('authz-mgr-a@example.com', unitA, 'Manager', unitA),
    unscopedManager: await createUser('authz-mgr-all@example.com', null, 'Manager'),
    employee: await createUser('authz-emp-a@example.com', unitA, 'Employee'),
    nobody: await createUser('authz-nobody@example.com', null, null),
    delegatee: await createUser('authz-delegatee@example.com', unitA, null),
  };
  const empA = users.employee;
  const empB = await createUser('authz-emp-b@example.com', unitB, 'Employee');
  const unassigned = await createUser('authz-unassigned@example.com', null, null);
  await admin.query('INSERT INTO user_departments (user_id, department_id) VALUES (?, ?), (?, ?)', [empA, deptA, empB, deptB]);

  const schedA = await insert(
    `INSERT INTO schedules (name, start_date, end_date, department_id, status, created_by) VALUES ('Sched A', ?, ?, ?, 'draft', ?)`,
    [D1, D2, deptA, users.admin]
  );
  const schedB = await insert(
    `INSERT INTO schedules (name, start_date, end_date, department_id, status, created_by) VALUES ('Sched B', ?, ?, ?, 'draft', ?)`,
    [D1, D2, deptB, users.admin]
  );
  const shift = (sched: number, dept: number, date: string) => insert(
    `INSERT INTO shifts (schedule_id, department_id, date, start_time, end_time, min_staff, max_staff, status)
     VALUES (?, ?, ?, '09:00:00', '17:00:00', 1, 3, 'open')`,
    [sched, dept, date]
  );
  const shiftA = await shift(schedA, deptA, '2031-03-05');
  const shiftA2 = await shift(schedA, deptA, '2031-03-12');
  const shiftB = await shift(schedB, deptB, '2031-03-05');
  const asgA = await insert(`INSERT INTO shift_assignments (shift_id, user_id, status) VALUES (?, ?, 'pending')`, [shiftA, empA]);
  const asgB = await insert(`INSERT INTO shift_assignments (shift_id, user_id, status) VALUES (?, ?, 'pending')`, [shiftB, empB]);
  const toA = await insert(`INSERT INTO time_off_requests (user_id, start_date, end_date, type) VALUES (?, ?, ?, 'vacation')`, [empA, D1, D1]);
  const toB = await insert(`INSERT INTO time_off_requests (user_id, start_date, end_date, type) VALUES (?, ?, ?, 'vacation')`, [empB, D1, D1]);
  const attB = await insert(`INSERT INTO attendance_records (user_id, clock_in, status) VALUES (?, '2031-03-05 09:00:00', 'pending')`, [empB]);
  const loanB = await insert(
    `INSERT INTO employee_loans (user_id, from_org_unit_id, to_org_unit_id, start_date, end_date, status, requested_by)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    [empB, unitC, unitB, D1, D2, users.admin]
  );
  const cpB = await insert(
    `INSERT INTO cost_plans (department_id, start_date, end_date, target_amount, set_by_user_id) VALUES (?, ?, ?, 100, ?)`,
    [deptB, D1, D2, users.admin]
  );
  const skill = await insert(`INSERT INTO skills (name) VALUES ('Authz skill')`);
  await admin.query('INSERT INTO user_skills (user_id, skill_id, proficiency_level) VALUES (?, ?, 3)', [empB, skill]);

  f = {
    unitA, unitA1, unitB, deptA, deptB, schedA, schedB, shiftA, shiftA2, shiftB, asgA, asgB,
    empA, empB, unassigned, toA, toB, attB, loanB, cpB, skill, users,
  };

  const { database } = require('../../config/database');
  const { buildApp } = require('../../app');
  app = buildApp(database.getPool(), { silent: true });
  closeAppPool = () => database.close();
  spec = require('../../../openapi/openapi.json');

  for (const [principal, email] of Object.entries({
    admin: 'authz-admin@example.com',
    scopedAdmin: 'authz-admin-a@example.com',
    scopedManager: 'authz-mgr-a@example.com',
    unscopedManager: 'authz-mgr-all@example.com',
    employee: 'authz-emp-a@example.com',
    nobody: 'authz-nobody@example.com',
    delegatee: 'authz-delegatee@example.com',
  })) {
    cookies[principal as Principal] = await login(email);
  }

  // The unscoped Manager delegates Manager codes to the delegatee for unit A only.
  const delegation = await request(app).post(`${API}/delegations`).set('Cookie', cookies.unscopedManager!).send({
    delegateeId: users.delegatee,
    permissionCodes: ['schedule.read', 'schedule.manage', 'shift.manage', 'assignment.manage', 'employee.read', 'timeoff.approve'],
    expiresAt: '2037-12-31 00:00:00',
    scopeOrgUnitId: unitA,
  });
  expect({ status: delegation.status, body: delegation.body }).toMatchObject({ status: 201 });
}, 120_000);

afterAll(async () => {
  if (closeAppPool) await closeAppPool();
  const { closeRedis } = require('../../config/redis') as typeof import('../../config/redis');
  await closeRedis();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS \`${ITEST_DB}\``);
    await admin.end();
  }
}, 30_000);

describe('the matrix covers every mounted operation', () => {
  it('declares exactly the operations the spec publishes', () => {
    const ops = specOperations();
    expect(ops.filter((op) => !AUTHORIZATION_MATRIX[op])).toEqual([]);
    expect(Object.keys(AUTHORIZATION_MATRIX).filter((op) => !ops.includes(op))).toEqual([]);
  });

  it('reaches every route the app mounts', () => {
    const reached = new Set<object>();
    const resolveAll = (entries: Array<[string, string]>) => {
      for (const [method, path] of entries) {
        const found = resolveRoute(app, method, path);
        expect({ op: `${method} ${path}`, found: Boolean(found) }).toEqual({ op: `${method} ${path}`, found: true });
        if (found) reached.add(found.route);
      }
    };
    resolveAll(specOperations().map((op) => {
      const [m, p] = op.split(' ');
      return [m, `${API}${concretePath(p)}`];
    }));
    resolveAll(Object.keys(EXTRA_OPERATIONS).map((op) => op.split(' ') as [string, string]));
    const unreached = allRoutes(app).filter((r) => !reached.has(r.route)).map((r) => `${r.methods.join(',')} ${r.path}`);
    expect(unreached).toEqual([]);
  });
});

describe('each operation carries exactly its declared gate', () => {
  const { authenticate } = require('../../middleware/auth') as typeof import('../../middleware/auth');
  const chainOf = (op: string) => {
    const [m, p] = op.split(' ');
    return resolveRoute(app, m, `${API}${concretePath(p)}`)!.chain;
  };

  it('authenticate and requirePermission match the table', () => {
    const mismatches: string[] = [];
    for (const [op, rule] of Object.entries(AUTHORIZATION_MATRIX)) {
      const chain = chainOf(op);
      const authed = chain.includes(authenticate as never);
      const codes = chain.map((h) => h.requiredPermission).filter((c): c is string => Boolean(c)).sort();
      const declared = rule.requires === 'public' ? [] : [...rule.requires].sort();
      if (authed !== (rule.requires !== 'public') || codes.join() !== declared.join()) {
        mismatches.push(`${op}: route has ${authed ? 'auth' : 'public'} [${codes}], table says ${JSON.stringify(rule.requires)}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('every operation with a scope guard is declared unit-scoped, and every unit operation is probed', () => {
    const probes = crossUnitProbes(f);
    const wrong: string[] = [];
    for (const [op, rule] of Object.entries(AUTHORIZATION_MATRIX)) {
      const guarded = chainOf(op).some((h) => h.accessRule);
      if (guarded && rule.scope !== 'unit') wrong.push(`${op} has a scope guard but is declared ${rule.scope}`);
      if (rule.scope === 'unit' && !probes[op]?.length) wrong.push(`${op} is unit-scoped but has no cross-unit probe`);
    }
    for (const op of Object.keys(probes)) {
      if (AUTHORIZATION_MATRIX[op]?.scope !== 'unit') wrong.push(`${op} is probed but not declared unit-scoped`);
    }
    expect(wrong).toEqual([]);
  });
});

describe('the gate refuses callers without it', () => {
  it('answers 401 to an unauthenticated caller on every non-public operation', async () => {
    const wrong: string[] = [];
    for (const [op, rule] of Object.entries(AUTHORIZATION_MATRIX)) {
      if (rule.requires === 'public') continue;
      const res = await call(null, op);
      if (res.status !== 401) wrong.push(`${op} → ${res.status}`);
    }
    expect(wrong).toEqual([]);
  });

  it('answers 403 to a caller lacking the required permission', async () => {
    const verify = await request(app).get(`${API}/auth/verify`).set('Cookie', cookies.employee!);
    const employeeHolds = new Set<string>(verify.body.data.permissions);
    const wrong: string[] = [];
    for (const [op, rule] of Object.entries(AUTHORIZATION_MATRIX) as Array<[string, AuthzRule]>) {
      if (rule.requires === 'public' || rule.requires.length === 0) continue;
      const as: Principal = rule.requires.every((c) => employeeHolds.has(c)) ? 'nobody' : 'employee';
      const res = await call(as, op);
      if (res.status !== 403) wrong.push(`${op} as ${as} → ${res.status}`);
    }
    expect(wrong).toEqual([]);
  });
});

describe('org-unit scope (#813)', () => {
  it('refuses another unit\'s ids, in paths and in bodies, with 404', async () => {
    const wrong: string[] = [];
    for (const [op, probes] of Object.entries(crossUnitProbes(f))) {
      for (const probe of probes) {
        const res = await call(probe.as ?? 'scopedManager', op, probe);
        const expected = probe.status ?? 404;
        if (res.status !== expected) {
          wrong.push(`${op} ${JSON.stringify(probe.params ?? {})} ${JSON.stringify(probe.body ?? probe.query ?? {})} → ${res.status} ${JSON.stringify(res.body?.error ?? {})}`);
        } else if (probe.check) {
          try {
            probe.check(res.body);
          } catch {
            wrong.push(`${op} ${JSON.stringify(probe.body ?? {})} → ${JSON.stringify(res.body?.data ?? res.body)}`);
          }
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('lets the scoped manager act on their own unit', async () => {
    for (const [op, probe] of inUnitProbes(f)) {
      const res = await call('scopedManager', op, probe);
      expect({ op, status: res.status }).toEqual({ op, status: probe.status });
    }
  });

  it('filters list endpoints to the caller\'s units', async () => {
    for (const probe of listProbes(f)) {
      let req = request(app).get(`${API}${probe.path}`).set('Cookie', cookies.scopedManager!);
      if (probe.query) req = req.query(probe.query);
      const res = await req;
      expect({ path: probe.path, status: res.status }).toEqual({ path: probe.path, status: 200 });
      const ids = probe.ids(res.body);
      expect({ path: probe.path, leaks: ids.includes(probe.lacks) }).toEqual({ path: probe.path, leaks: false });
      if (probe.has !== -1) expect({ path: probe.path, has: ids.includes(probe.has) }).toEqual({ path: probe.path, has: true });
    }
  });

  it('leaves unscoped callers unrestricted', async () => {
    for (const as of ['admin', 'unscopedManager'] as Principal[]) {
      const res = await call(as, 'GET /schedules/{id}', { params: { id: f.schedB } });
      expect({ as, status: res.status }).toEqual({ as, status: 200 });
    }
  });
});

describe('delegation scope (#814)', () => {
  it('applies delegated permissions only inside the delegation\'s scope', async () => {
    for (const [op, probe] of delegateeProbes(f)) {
      const res = await call('delegatee', op, probe);
      expect({ op, id: probe.params ?? probe.body, status: res.status }).toEqual({ op, id: probe.params ?? probe.body, status: probe.status ?? 404 });
    }
    const list = await request(app).get(`${API}/schedules`).set('Cookie', cookies.delegatee!);
    expect(list.status).toBe(200);
    expect(list.body.data.map((s: { id: number }) => s.id)).toEqual([f.schedA]);
  });

  it('refuses a scoped delegator a delegation wider than their own scope with 422', async () => {
    const base = {
      delegateeId: f.users.nobody,
      permissionCodes: ['schedule.read'],
      expiresAt: '2037-12-31 00:00:00',
    };
    for (const scopeOrgUnitId of [null, f.unitB]) {
      const res = await request(app).post(`${API}/delegations`).set('Cookie', cookies.scopedManager!).send({ ...base, scopeOrgUnitId });
      expect({ scopeOrgUnitId, status: res.status, code: res.body.error?.code }).toEqual({ scopeOrgUnitId, status: 422, code: 'DELEGATION_INVALID' });
    }
    const inside = await request(app).post(`${API}/delegations`).set('Cookie', cookies.scopedManager!).send({ ...base, scopeOrgUnitId: f.unitA1 });
    expect(inside.status).toBe(201);
  });
});
