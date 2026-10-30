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
  attB: number; loanB: number; cpB: number; skill: number; swapAB: number;
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
    'POST /users': [{
      body: { email: 'authz-new3@example.com', password: 'longenough1', firstName: 'N', lastName: 'U', departmentIds: [f.deptB] },
    }],
    'GET /users/{id}': [{ params: { id: f.empB } }],

    // A CSV row naming another unit's schedule or department lands nothing.
    'POST /import/shifts': [
      { body: { csv: `scheduleId,departmentId,date,startTime,endTime,minStaff,maxStaff\n${f.schedB},${f.deptA},${D1},09:00,17:00,1,2` } },
      { body: { csv: `scheduleId,departmentId,date,startTime,endTime,minStaff,maxStaff\n${f.schedA},${f.deptB},${D1},09:00,17:00,1,2` } },
    ],

    'POST /departments': [
      { body: { name: 'Authz new B', orgUnitId: f.unitB } },
      // A department in no unit would be one the scoped manager could never reach again.
      { body: { name: 'Authz new none' } },
    ],
    'PUT /departments/{id}': [
      // Moving one's own department — and its schedules — into another unit.
      { params: { id: f.deptA }, body: { orgUnitId: f.unitB } },
      { as: 'scopedAdmin', params: { id: f.deptB }, body: { name: 'Renamed' } },
    ],
    'DELETE /departments/{id}': [{ as: 'scopedAdmin', params: { id: f.deptB } }],
    'POST /departments/{id}/users': [
      { params: { id: f.deptA }, body: { userId: f.empB } },
      { as: 'scopedAdmin', params: { id: f.deptB }, body: { userId: f.empA } },
    ],
    'DELETE /departments/{id}/users/{userId}': [{ as: 'scopedAdmin', params: { id: f.deptB, userId: f.empB } }],

    // Approving a swap rewrites both assignments, so both must be the approver's.
    'POST /shift-swap/{id}/approve': [{ params: { id: f.swapAB }, body: {} }],
    'POST /shift-swap/{id}/decline': [{ params: { id: f.swapAB }, body: {} }],

    'GET /directory/users/{id}': [{ params: { id: f.empB } }],
    'GET /directory/users/{id}/vcard': [{ params: { id: f.empB } }],
    'GET /org/units/{id}/members': [{ params: { id: f.unitB } }],
    'GET /org/units/{id}/members/detailed': [{ params: { id: f.unitB } }],
  };
};

/**
 * Delegations of codes that act organization-wide cannot be bounded by a unit,
 * so a scoped one is refused (#814 review): `role.manage` "for ward A" would
 * still assign any role to anyone.
 */
const UNSCOPABLE_DELEGATION_CODES = ['role.manage', 'settings.manage', 'audit.read'];

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
  ['POST /import/shifts', { body: { csv: `scheduleId,departmentId,date,startTime,endTime,minStaff,maxStaff\n${f.schedA},${f.deptA},${D1},10:00,12:00,1,2` }, status: 200 }],
  ['POST /users', { body: { email: 'authz-new4@example.com', password: 'longenough1', firstName: 'N', lastName: 'U', departmentIds: [f.deptA] }, status: 201 }],
  ['PUT /departments/{id}', { params: { id: f.deptA }, body: { description: 'in unit' }, status: 200 }],
  ['GET /users/{id}', { params: { id: f.empA }, status: 200 }],
];

interface ListProbe {
  as?: Principal;
  query?: Record<string, string>;
  /** True when the response carries a unit-B row. */
  leaks: (res: request.Response) => boolean;
  /** True when it carries the unit-A row it should (omitted where no fixture exists). */
  has?: (res: request.Response) => boolean;
}

/**
 * Unit B markers in a response body: its schedule, department and person
 * (fixtures name people after their e-mail), or a violation code only B has.
 */
const B_MARKERS = ['Sched B', 'Dept B', 'authz-emp-b', 'AUTHZ_B'];
const textLeaks = (res: request.Response) => B_MARKERS.some((m) => (res.text ?? '').includes(m));
const idsOf = (res: request.Response, key = 'id'): number[] => (res.body?.data ?? []).map((r: any) => r[key]);

/**
 * List and aggregate endpoints — every `filtered` operation of the matrix must
 * appear — as the scoped Manager unless stated: unit A's rows in, unit B's out.
 */
const listProbes = (f: Fixtures): Record<string, ListProbe[]> => {
  const range = { startDate: D1, endDate: D2 };
  return {
    'GET /schedules': [{ leaks: (r) => idsOf(r).includes(f.schedB), has: (r) => idsOf(r).includes(f.schedA) }],
    'GET /shifts': [{ leaks: (r) => idsOf(r).includes(f.shiftB), has: (r) => idsOf(r).includes(f.shiftA) }],
    'GET /shifts/export': [{ leaks: textLeaks }],
    'GET /assignments': [{ leaks: (r) => idsOf(r).includes(f.asgB), has: (r) => idsOf(r).includes(f.asgA) }],
    'GET /assignments/export': [{ leaks: textLeaks }],
    'GET /employees': [{ leaks: (r) => idsOf(r).includes(f.empB), has: (r) => idsOf(r).includes(f.empA) }],
    'GET /employees/export': [{ leaks: textLeaks }],
    'GET /time-off': [{ leaks: (r) => idsOf(r).includes(f.toB), has: (r) => idsOf(r).includes(f.toA) }],
    'GET /time-off/export': [{ leaks: textLeaks }],
    'GET /attendance': [{ leaks: (r) => idsOf(r).includes(f.attB) }],
    'GET /attendance/export': [{ leaks: textLeaks }],
    'GET /org/loans': [{ leaks: (r) => idsOf(r).includes(f.loanB) }],
    'GET /cost-plans': [{ leaks: (r) => idsOf(r).includes(f.cpB) }],
    'GET /reports/cost-by-department': [{
      query: range,
      leaks: (r) => idsOf(r, 'departmentId').includes(f.deptB),
      has: (r) => idsOf(r, 'departmentId').includes(f.deptA),
    }],
    'GET /reports/cost-by-department/export': [{ query: range, leaks: textLeaks }],
    'GET /reports/attendance-anomalies': [{ query: range, leaks: (r) => idsOf(r, 'attendanceRecordId').includes(f.attB) }],
    'GET /reports/compliance-violations-trend': [{ query: { startDate: '2031-03-01', endDate: '2031-03-31' }, leaks: textLeaks }],
    'GET /timeline': [
      { query: { from: '2031-03-01', to: '2031-03-31' }, leaks: textLeaks },
      // Delegated timeline.read_all for unit A lifts the membership bound only there (#814 review).
      { as: 'delegatee', query: { from: '2031-03-01', to: '2031-03-31' }, leaks: textLeaks },
    ],
  };
};

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
  // The scoped manager runs department A, so the department routes' own
  // manager-of-this-department check passes and only scope is left to refuse.
  await admin.query('UPDATE departments SET manager_id = ? WHERE id = ?', [users.scopedManager, deptA]);
  await admin.query('INSERT INTO user_departments (user_id, department_id) VALUES (?, ?)', [users.scopedManager, deptA]);

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
  // A unit-B shift within the calendar feed's window (which ends a year from today).
  const shiftBSoon = await insert(
    `INSERT INTO shifts (schedule_id, department_id, date, start_time, end_time, min_staff, max_staff, status)
     VALUES (?, ?, CURDATE() + INTERVAL 2 DAY, '09:00:00', '17:00:00', 1, 3, 'open')`,
    [schedB, deptB]
  );
  await insert(`INSERT INTO shift_assignments (shift_id, user_id, status) VALUES (?, ?, 'pending')`, [shiftBSoon, empB]);
  const shiftASoon = await insert(
    `INSERT INTO shifts (schedule_id, department_id, date, start_time, end_time, min_staff, max_staff, status)
     VALUES (?, ?, CURDATE() + INTERVAL 2 DAY, '09:00:00', '17:00:00', 1, 3, 'open')`,
    [schedA, deptA]
  );
  await insert(`INSERT INTO shift_assignments (shift_id, user_id, status) VALUES (?, ?, 'pending')`, [shiftASoon, empA]);
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
  // A swap between unit A's and unit B's assignment, and a violation only B has.
  const swapAB = await insert(
    `INSERT INTO shift_swap_requests (requester_user_id, requester_assignment_id, target_user_id, target_assignment_id, status)
     VALUES (?, ?, ?, ?, 'pending')`,
    [empA, asgA, empB, asgB]
  );
  await insert(`INSERT INTO compliance_violations (user_id, code, message, detected_at) VALUES (?, 'AUTHZ_B', 'b', '2031-03-05 10:00:00')`, [empB]);
  await admin.query('INSERT INTO user_skills (user_id, skill_id, proficiency_level) VALUES (?, ?, 3)', [empB, skill]);

  f = {
    unitA, unitA1, unitB, deptA, deptB, schedA, schedB, shiftA, shiftA2, shiftB, asgA, asgB,
    empA, empB, unassigned, toA, toB, attB, loanB, cpB, skill, swapAB, users,
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
    permissionCodes: ['schedule.read', 'schedule.manage', 'shift.manage', 'assignment.manage', 'employee.read', 'timeoff.approve', 'timeline.read', 'timeline.read_all'],
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

  // Per method, not per route object: one `router.route()` may answer several
  // methods, and a second method added to it must still need its own entry.
  it('reaches every route and method the app mounts', () => {
    const reached = new Map<object, Set<string>>();
    const resolveAll = (entries: Array<[string, string]>) => {
      for (const [method, path] of entries) {
        const found = resolveRoute(app, method, path);
        expect({ op: `${method} ${path}`, found: Boolean(found) }).toEqual({ op: `${method} ${path}`, found: true });
        if (found) reached.set(found.route, (reached.get(found.route) ?? new Set()).add(method.toLowerCase()));
      }
    };
    resolveAll(specOperations().map((op) => {
      const [m, p] = op.split(' ');
      return [m, `${API}${concretePath(p)}`];
    }));
    resolveAll(Object.keys(EXTRA_OPERATIONS).map((op) => op.split(' ') as [string, string]));
    const unreached = allRoutes(app).flatMap((r) =>
      r.methods.filter((m) => !reached.get(r.route)?.has(m)).map((m) => `${m.toUpperCase()} ${r.path}`)
    );
    expect(unreached).toEqual([]);
  });

  it('gives every org-wide, shared and gap entry a reason, and every gap the follow-up issue', () => {
    const wrong = Object.entries({ ...AUTHORIZATION_MATRIX, ...EXTRA_OPERATIONS }).flatMap(([op, rule]) => {
      if (['org', 'shared', 'gap'].includes(rule.scope) && !rule.note?.trim()) return [`${op}: ${rule.scope} without a reason`];
      if (rule.scope === 'gap' && !rule.note!.includes('#926')) return [`${op}: gap not referencing #926`];
      return [];
    });
    expect(wrong).toEqual([]);
  });

  it('probes every filtered operation as a list', () => {
    const probes = listProbes(f);
    const wrong = Object.entries(AUTHORIZATION_MATRIX).flatMap(([op, rule]) => [
      ...(rule.scope === 'filtered' && !probes[op]?.length ? [`${op} is filtered but has no list probe`] : []),
    ]);
    for (const op of Object.keys(probes)) {
      if (AUTHORIZATION_MATRIX[op]?.scope !== 'filtered') wrong.push(`${op} is list-probed but not declared filtered`);
    }
    expect(wrong).toEqual([]);
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

  /**
   * Which codes a unit scope can bound, derived from this table rather than
   * kept by hand: a code is bounded when it admits unit-scoped or filtered
   * operations and admits no `org` one. DelegationService refuses a scoped
   * delegation of any other code (#814 review), so the production list must be
   * exactly this — a new org-wide operation behind a bounded code removes it.
   */
  it('derives the codes a scoped delegation may carry from the table', () => {
    const { UNIT_SCOPED_PERMISSIONS } = require('../../services/access/AccessPolicy') as { UNIT_SCOPED_PERMISSIONS?: ReadonlySet<string> };
    const bounded = new Set<string>(HANDLER_SCOPED_CODES);
    const orgWide = new Set<string>();
    for (const [op, rule] of Object.entries(AUTHORIZATION_MATRIX)) {
      const codes = [
        ...(rule.requires === 'public' ? [] : rule.requires),
        ...chainOf(op).flatMap((h) => ((h.accessRule as { permissions?: string[] } | undefined)?.permissions ?? [])),
      ];
      if (rule.scope === 'unit' || rule.scope === 'filtered') codes.forEach((c) => bounded.add(c));
      if (rule.scope === 'org') codes.forEach((c) => orgWide.add(c));
    }
    const derived = [...bounded].filter((c) => !orgWide.has(c)).sort();
    expect([...(UNIT_SCOPED_PERMISSIONS ?? [])].sort()).toEqual(derived);
    for (const code of UNSCOPABLE_DELEGATION_CODES) expect(derived).not.toContain(code);
  });
});

/** Codes the handler (not the route chain) bounds by scope: `timeline.read_all` lifts only the membership bound. */
const HANDLER_SCOPED_CODES = ['timeline.read_all'];

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
    const wrong: string[] = [];
    for (const [op, probes] of Object.entries(listProbes(f))) {
      for (const probe of probes) {
        const as = probe.as ?? 'scopedManager';
        const res = await call(as, op, { query: probe.query });
        if (res.status !== 200) wrong.push(`${op} as ${as} → ${res.status}`);
        else if (probe.leaks(res)) wrong.push(`${op} as ${as} leaks unit B`);
        else if (probe.has && !probe.has(res)) wrong.push(`${op} as ${as} misses unit A`);
      }
    }
    expect(wrong).toEqual([]);
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

  it('refuses a scoped delegation of a code that acts organization-wide', async () => {
    for (const code of UNSCOPABLE_DELEGATION_CODES) {
      const res = await request(app).post(`${API}/delegations`).set('Cookie', cookies.admin!).send({
        delegateeId: f.users.nobody,
        permissionCodes: [code],
        expiresAt: '2037-12-31 00:00:00',
        scopeOrgUnitId: f.unitA,
      });
      expect({ code, status: res.status, error: res.body.error?.code }).toEqual({ code, status: 422, error: 'DELEGATION_INVALID' });
    }
  });

  it('bounds the aggregate calendar feed by a delegated scope', async () => {
    const token = await request(app).post(`${API}/calendar/tokens`).set('Cookie', cookies.delegatee!).send({ label: 'authz' });
    expect(token.status).toBe(201);
    const feed = await request(app).get(`${API}/calendar/aggregate.ics`).query({ token: token.body.data.token, futureDays: 30 });
    expect(feed.status).toBe(200);
    expect({ hasA: feed.text.includes('Dept A'), hasB: feed.text.includes('Dept B') }).toEqual({ hasA: true, hasB: false });
    // Control: the same feed for an unscoped reader does carry unit B.
    const adminToken = await request(app).post(`${API}/calendar/tokens`).set('Cookie', cookies.admin!).send({ label: 'authz' });
    const all = await request(app).get(`${API}/calendar/aggregate.ics`).query({ token: adminToken.body.data.token, futureDays: 30 });
    expect(all.text).toContain('Dept B');
  });
});
