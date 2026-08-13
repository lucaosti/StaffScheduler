/**
 * API integration tests against a REAL MySQL server.
 *
 * Unlike the unit suites (which mock the pool), these tests execute the actual
 * SQL against the actual schema, so column drift between the migrations in
 * `db/migrations` and service queries fails here instead of in production. Historical example:
 * `SELECT id, role FROM users` survived 1900+ mocked tests after the `role`
 * column was dropped — this suite exists so that class of bug cannot recur.
 *
 * Run with: npm run test:integration
 * Requires: reachable MySQL with credentials in DB_HOST/DB_PORT/DB_USER/
 * DB_PASSWORD (privileges to CREATE/DROP the dedicated test database).
 * The suite provisions and drops `staff_scheduler_itest` on its own; it never
 * touches the configured application database.
 *
 * @author Luca Ostinelli
 */

// The app-side pool must point at the throwaway integration database. Env must
// be set before `../../config` is first required, so all app modules are
// loaded lazily inside beforeAll (static imports would hoist above this).
const ITEST_DB = process.env.ITEST_DB_NAME || 'staff_scheduler_itest';
process.env.DB_NAME = ITEST_DB;
process.env.NODE_ENV = 'test';
// This suite verifies DB integration; Redis is not its subject and the shared
// caches fall back to in-process state transparently. Disabling it here means
// the real app under test never opens an ioredis socket, so Jest exits cleanly
// instead of hanging on the client's reconnection timer. The Redis path is
// covered by cacheStore.test.ts, and the e2e job asserts the started backend
// reports redis connected against a real Redis service.
process.env.REDIS_ENABLED = 'false';

import mysql from 'mysql2/promise';
import bcrypt from 'bcrypt';
import request from 'supertest';
import type { Express } from 'express';
import { migrationUpSql } from '../helpers/schema';
import { expectErrorEnvelope, expectSuccessEnvelope } from '../helpers/openapiEnvelope';

const DB = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
};

const ADMIN_EMAIL = 'itest-admin@example.com';
const ADMIN_PASSWORD = 'itest-password-123';
const DELEGATEE_EMAIL = 'itest-delegatee@example.com';
const DELEGATEE_PASSWORD = 'itest-password-456';

let admin: mysql.Connection;
let app: Express;
let closeAppPool: () => Promise<void>;
let userId: number;
let delegateeId: number;
let shiftId: number;
let departmentId: number;
let scheduleId: number;
let orgUnitId: number;

const loginCookie = async (email: string, password: string): Promise<string> => {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  const setCookie = res.headers['set-cookie'];
  expect(setCookie).toBeDefined();
  return (Array.isArray(setCookie) ? setCookie : [setCookie])
    .map((c: string) => c.split(';')[0])
    .join('; ');
};

const authCookie = (): Promise<string> => loginCookie(ADMIN_EMAIL, ADMIN_PASSWORD);

beforeAll(async () => {
  admin = await mysql.createConnection({ ...DB, multipleStatements: true });
  await admin.query(`DROP DATABASE IF EXISTS \`${ITEST_DB}\``);
  await admin.query(
    `CREATE DATABASE \`${ITEST_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await admin.query(`USE \`${ITEST_DB}\``);
  await admin.query(migrationUpSql());

  // Fixtures: an administrator, a department, a published schedule, one shift.
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 4);
  const [userRes] = await admin.query<mysql.ResultSetHeader>(
    `INSERT INTO users (email, password_hash, first_name, last_name, is_active, hourly_rate)
     VALUES (?, ?, 'Itest', 'Admin', 1, 20)`,
    [ADMIN_EMAIL, passwordHash]
  );
  userId = userRes.insertId;
  await admin.query(
    `INSERT INTO user_roles (user_id, role_id)
     SELECT ?, id FROM roles WHERE name = 'Administrator'`,
    [userId]
  );
  // A second, role-less user: the target of the delegation-flow tests.
  const delegateeHash = await bcrypt.hash(DELEGATEE_PASSWORD, 4);
  const [delegateeRes] = await admin.query<mysql.ResultSetHeader>(
    `INSERT INTO users (email, password_hash, first_name, last_name, is_active)
     VALUES (?, ?, 'Itest', 'Delegatee', 1)`,
    [DELEGATEE_EMAIL, delegateeHash]
  );
  delegateeId = delegateeRes.insertId;
  const [deptRes] = await admin.query<mysql.ResultSetHeader>(
    `INSERT INTO departments (name, description, is_active) VALUES ('Itest Dept', 'integration', 1)`
  );
  departmentId = deptRes.insertId;
  const [orgRes] = await admin.query<mysql.ResultSetHeader>(
    `INSERT INTO org_units (name, description, parent_id, manager_user_id, is_active)
     VALUES ('Itest Unit', 'integration', NULL, NULL, 1)`
  );
  orgUnitId = orgRes.insertId;
  await admin.query(
    `INSERT INTO user_departments (user_id, department_id) VALUES (?, ?)`,
    [userId, deptRes.insertId]
  );
  const [schedRes] = await admin.query<mysql.ResultSetHeader>(
    `INSERT INTO schedules (name, start_date, end_date, department_id, status, created_by)
     VALUES ('Itest Schedule', CURDATE(), CURDATE() + INTERVAL 27 DAY, ?, 'published', ?)`,
    [deptRes.insertId, userId]
  );
  const [shiftRes] = await admin.query<mysql.ResultSetHeader>(
    `INSERT INTO shifts (schedule_id, department_id, date, start_time, end_time, min_staff, max_staff, status)
     VALUES (?, ?, CURDATE() + INTERVAL 1 DAY, '09:00:00', '17:00:00', 1, 3, 'open')`,
    [schedRes.insertId, deptRes.insertId]
  );
  shiftId = shiftRes.insertId;
  scheduleId = schedRes.insertId;

  // Load the app only now, with DB_NAME already pointing at the itest DB.
  const { database } = require('../../config/database');
  const { buildApp } = require('../../app');
  app = buildApp(database.getPool(), { silent: true });
  closeAppPool = () => database.close();
}, 90_000);

afterAll(async () => {
  if (closeAppPool) await closeAppPool();
  // Close any Redis client the app created, so no reconnection timer keeps
  // the process alive after the suite (belt-and-suspenders with REDIS_ENABLED
  // above). Loaded lazily to respect the env-before-config ordering.
  const { closeRedis } = require('../../config/redis') as typeof import('../../config/redis');
  await closeRedis();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS \`${ITEST_DB}\``);
    await admin.end();
  }
}, 30_000);

describe('auth (real DB)', () => {
  it('rejects a wrong password with 401', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: ADMIN_EMAIL, password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('LOGIN_FAILED');
    // Contract: a real error response must match the documented ApiError shape.
    expectErrorEnvelope(res.body);
  });

  it('logs in, serves an authenticated request, and revokes on logout', async () => {
    const cookie = await authCookie();

    const me = await request(app).get('/api/v1/auth/verify').set('Cookie', cookie);
    expect(me.status).toBe(200);
    // Contract: a real success response must carry the { success, data } envelope.
    expectSuccessEnvelope(me.body);
    expect(me.body.data.email).toBe(ADMIN_EMAIL);
    expect(me.body.data.permissions).toContain('assignment.manage');

    const out = await request(app).post('/api/v1/auth/logout').set('Cookie', cookie);
    expect(out.status).toBe(200);

    const afterLogout = await request(app).get('/api/v1/auth/verify').set('Cookie', cookie);
    expect(afterLogout.status).toBe(401);
  });

  // End-to-end refresh-token rotation and reuse detection against the real
  // refresh_tokens table — the security-critical path #284 introduced.
  const extractCookie = (res: request.Response, name: string): string | undefined => {
    const setCookie = res.headers['set-cookie'];
    const arr = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    return arr.map((c: string) => c.split(';')[0]).find((c) => c.startsWith(`${name}=`));
  };

  it('rotates the refresh token and detects reuse of a spent one', async () => {
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(login.status).toBe(200);
    const firstRefresh = extractCookie(login, 'refresh_token');
    expect(firstRefresh).toBeDefined();

    // A valid refresh rotates: it succeeds and returns a new refresh cookie.
    const refresh1 = await request(app).post('/api/v1/auth/refresh').set('Cookie', firstRefresh!);
    expect(refresh1.status).toBe(200);
    expect(refresh1.body.data.user.email).toBe(ADMIN_EMAIL);
    const secondRefresh = extractCookie(refresh1, 'refresh_token');
    expect(secondRefresh).toBeDefined();
    expect(secondRefresh).not.toBe(firstRefresh);

    // Replaying the now-spent first token is reuse: it is rejected AND revokes
    // the whole family, so the legitimately-rotated second token stops working.
    const reuse = await request(app).post('/api/v1/auth/refresh').set('Cookie', firstRefresh!);
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('REFRESH_INVALID');

    const afterReuse = await request(app).post('/api/v1/auth/refresh').set('Cookie', secondRefresh!);
    expect(afterReuse.status).toBe(401);
  });
});

describe('assignments (real DB) — regression for the users.role column drift', () => {
  it('POST /api/assignments creates an assignment end-to-end', async () => {
    const cookie = await authCookie();
    const res = await request(app)
      .post('/api/v1/assignments')
      .set('Cookie', cookie)
      .send({ shiftId, userId });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.shiftId).toBe(shiftId);

    const [rows] = await admin.query<mysql.RowDataPacket[]>(
      `SELECT status FROM shift_assignments WHERE shift_id = ? AND user_id = ?`,
      [shiftId, userId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending');
  });

  it('rejects a duplicate assignment for the same shift and user', async () => {
    const cookie = await authCookie();
    const res = await request(app)
      .post('/api/v1/assignments')
      .set('Cookie', cookie)
      .send({ shiftId, userId });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('delegations (real DB) — regression for the missing delegation.manage catalog entry', () => {
  let delegationId: number;

  it('lets an administrator create a delegation of their own permissions', async () => {
    const cookie = await authCookie();
    // MySQL DATETIME format: strict mode rejects the ISO 'T'/'Z' variants.
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ');
    const res = await request(app)
      .post('/api/v1/delegations')
      .set('Cookie', cookie)
      .send({ delegateeId, permissionCodes: ['schedule.read'], expiresAt });
    expect(res.status).toBe(201);
    delegationId = res.body.data.id;
  });

  it('the delegatee holds the delegated permission at authentication time', async () => {
    const cookie = await loginCookie(DELEGATEE_EMAIL, DELEGATEE_PASSWORD);
    const me = await request(app).get('/api/v1/auth/verify').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.data.permissions).toContain('schedule.read');
  });

  it('revoking the delegation removes the permission', async () => {
    const adminCookie = await authCookie();
    const del = await request(app)
      .delete(`/api/v1/delegations/${delegationId}`)
      .set('Cookie', adminCookie);
    expect(del.status).toBe(200);

    const cookie = await loginCookie(DELEGATEE_EMAIL, DELEGATEE_PASSWORD);
    const me = await request(app).get('/api/v1/auth/verify').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.data.permissions).not.toContain('schedule.read');
  });
});

describe('directory and dashboard (real DB)', () => {
  it('GET /api/users returns the seeded admin via the unscoped path', async () => {
    const cookie = await authCookie();
    const res = await request(app).get('/api/v1/users').set('Cookie', cookie);
    expect(res.status).toBe(200);
    const emails = (res.body.data as Array<{ email: string }>).map((u) => u.email);
    expect(emails).toContain(ADMIN_EMAIL);
  });

  it('GET /api/dashboard/stats executes all aggregates against the real schema', async () => {
    const cookie = await authCookie();
    const res = await request(app).get('/api/v1/dashboard/stats').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.totalEmployees).toBeGreaterThanOrEqual(1);
    expect(res.body.data.monthlyCost).not.toBeUndefined();
  });
});

/**
 * Every GET that needs no fixture, executed against the real schema.
 *
 * WHY A SWEEP RATHER THAN PER-ENDPOINT TESTS: the mocked unit suites assert
 * that a service composes a particular SQL string, not that MySQL accepts it.
 * That is how `SELECT id, role FROM users` survived 1900+ mocked tests after
 * the `role` column was dropped — the failure mode this file was created for.
 * Before this sweep the suite covered eight of the API's 222 endpoints, so the
 * guarantee held for a fraction of the SQL in the system.
 *
 * The assertion is deliberately weak — any status below 500 — because the
 * subject is not the response body but whether the statement runs at all. An
 * unknown column, a bad JOIN or a violated constraint surfaces as a 500 here;
 * a 200, a 403 or a 404 all mean MySQL understood the query. Anything stronger
 * would need per-endpoint fixtures and would make the sweep expensive to keep
 * green for no extra protection against this class.
 */
describe('every fixture-free GET runs against the real schema', () => {
  const ENDPOINTS = [
    '/approval-workflows',
    '/assignments',
    '/attendance',
    '/audit-logs',
    '/audit-logs/export',
    '/change-requests',
    '/dashboard/stats',
    '/delegations',
    '/departments',
    '/directory/me',
    '/employees',
    '/employment-contracts',
    '/employee-pairings',
    '/timeline?from=2033-04-01&to=2033-04-07',
    '/timeline/sources',
    '/skills',
    '/skills?activeOnly=true',
    '/modules',
    '/notifications',
    '/notifications/unread-count',
    '/on-call/me',
    '/on-call/periods',
    '/org/loans',
    '/org/manager-chain',
    '/org/units',
    '/org/units/tree',
    '/pending-approvals',
    '/pending-approvals/count',
    '/permissions',
    '/policies',
    '/policies/approval-matrix',
    '/policies/exceptions',
    '/preferences/me',
    '/responsibility-rules',
    '/responsibility-rules/matrix',
    '/responsibility-rules/my-responsibilities',
    '/roles',
    '/schedules',
    '/settings',
    '/settings/currency',
    '/settings/time-period',
    '/shift-swap',
    '/shifts',
    '/shifts/templates',
    '/system/info',
    '/time-off',
    '/users',
  ];

  it.each(ENDPOINTS)('GET %s does not fail on the SQL', async (endpoint) => {
    const cookie = await authCookie();
    const res = await request(app).get(`/api/v1${endpoint}`).set('Cookie', cookie);
    // Surface the error envelope: a bare "expected < 500, received 500" says
    // nothing about which column or join is wrong, which is the whole point.
    expect({ endpoint, status: res.status, error: res.body?.error }).toMatchObject({
      status: expect.any(Number),
    });
    if (res.status >= 500) {
      throw new Error(
        `GET /api${endpoint} returned ${res.status}: ${JSON.stringify(res.body?.error ?? res.body)}`
      );
    }
  });

  // The reporting endpoints require a date range, so they are swept separately
  // rather than excluded — their SQL is among the most join-heavy in the app.
  it.each(['/reports/hours-worked', '/reports/cost-by-department'])(
    'GET %s does not fail on the SQL',
    async (endpoint) => {
      const cookie = await authCookie();
      const res = await request(app)
        .get(`/api/v1${endpoint}?startDate=2020-01-01&endDate=2030-12-31`)
        .set('Cookie', cookie);
      if (res.status >= 500) {
        throw new Error(
          `GET /api${endpoint} returned ${res.status}: ${JSON.stringify(res.body?.error ?? res.body)}`
        );
      }
    }
  );
});

/**
 * Mutations, executed against the real schema.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE GET SWEEP: the GET sweep proved its worth
 * immediately — four listings had been returning 500 in every deployment
 * because a mocked pool cannot tell a composed SQL string from one MySQL will
 * accept. Writes are where the remaining risk sits, and it is a different kind:
 * INSERT and UPDATE are what violate foreign keys, CHECK constraints, NOT NULL
 * columns and unique indexes, none of which a mock models at all.
 *
 * WHY THE BODIES ARE REAL RATHER THAN GENERATED: a sweep that sends an invalid
 * body gets a 400 from the validation middleware and never reaches the
 * database, so it would assert nothing while appearing to cover the endpoint.
 * Each payload below is built from the suite's fixtures precisely so the
 * statement runs.
 *
 * The assertion stays "below 500" for the same reason as the GET sweep: a 201,
 * a 403 and a 409 all mean MySQL executed the statement and the application
 * decided the outcome. Only a 500 means the query itself was wrong.
 */
describe('mutations run against the real schema', () => {
  const unique = (prefix: string): string => `${prefix}-${Date.now()}-${Math.floor(process.hrtime()[1] / 1000)}`;

  /**
   * Bodies are thunks, not literals. `it.each` evaluates its table when the
   * module is collected — before `beforeAll` has inserted the fixtures — so a
   * literal referencing `departmentId` captured `undefined` and the request was
   * rejected by validation before reaching any SQL. That is exactly the silent
   * non-coverage the 400 assertion below exists to catch, and it caught it.
   */
  const cases = (): Array<{
    name: string;
    method: 'post' | 'put' | 'patch';
    path: string;
    body?: () => Record<string, unknown>;
  }> => [
    { name: 'POST /departments', method: 'post', path: '/departments', body: () => ({ name: unique('Dept') }) },
    { name: 'POST /org/units', method: 'post', path: '/org/units', body: () => ({ name: unique('Unit') }) },
    { name: 'POST /roles', method: 'post', path: '/roles', body: () => ({ name: unique('Role') }) },
    {
      name: 'POST /users',
      method: 'post',
      path: '/users',
      body: () => ({
        email: `${unique('user')}@example.com`,
        password: 'Password1!',
        firstName: 'Sweep',
        lastName: 'User',
      }),
    },
    {
      name: 'POST /employees',
      method: 'post',
      path: '/employees',
      body: () => ({
        email: `${unique('emp')}@example.com`,
        password: 'Password1!',
        firstName: 'Sweep',
        lastName: 'Employee',
        departmentIds: [departmentId],
      }),
    },
    {
      name: 'POST /schedules',
      method: 'post',
      path: '/schedules',
      body: () => ({
        name: unique('Schedule'),
        startDate: '2030-01-01',
        endDate: '2030-01-28',
        departmentId,
      }),
    },
    {
      name: 'POST /shifts',
      method: 'post',
      path: '/shifts',
      body: () => ({
        scheduleId,
        departmentId,
        date: '2030-01-02',
        startTime: '09:00',
        endTime: '17:00',
        minStaff: 1,
        maxStaff: 3,
      }),
    },
    {
      name: 'POST /shifts/templates',
      method: 'post',
      path: '/shifts/templates',
      body: () => ({
        name: unique('Template'),
        departmentId,
        startTime: '09:00',
        endTime: '17:00',
        minStaff: 1,
        maxStaff: 3,
      }),
    },
    {
      name: 'POST /assignments',
      method: 'post',
      path: '/assignments',
      body: () => ({ shiftId, userId: delegateeId }),
    },
    {
      name: 'POST /time-off',
      method: 'post',
      path: '/time-off',
      body: () => ({ startDate: '2030-02-01', endDate: '2030-02-03', type: 'vacation' }),
    },
    {
      name: 'POST /on-call/periods',
      method: 'post',
      path: '/on-call/periods',
      body: () => ({ departmentId, date: '2030-03-01', startTime: '18:00', endTime: '23:00' }),
    },
    {
      name: 'POST /policies',
      method: 'post',
      path: '/policies',
      body: () => ({ scopeType: 'global', policyKey: unique('policy_key'), policyValue: 1 }),
    },
    {
      name: 'POST /responsibility-rules',
      method: 'post',
      path: '/responsibility-rules',
      body: () => ({
        subjectType: 'department',
        permissionCode: 'schedule.read',
        responsibleOrgUnitId: orgUnitId,
      }),
    },
    {
      name: 'POST /approval-workflows',
      method: 'post',
      path: '/approval-workflows',
      body: () => ({
        changeType: unique('change_type').slice(0, 40),
        steps: [{ stepOrder: 1, approverScope: 'unit_manager' }],
      }),
    },
    {
      name: 'POST /policies/validate/assignment',
      method: 'post',
      path: '/policies/validate/assignment',
      body: () => ({ shiftId, userId: delegateeId }),
    },
    { name: 'POST /calendar/token', method: 'post', path: '/calendar/token' },
    { name: 'POST /attendance/clock-in', method: 'post', path: '/attendance/clock-in', body: () => ({}) },
    { name: 'PATCH /notifications/read-all', method: 'patch', path: '/notifications/read-all' },
    { name: 'PUT /preferences/me', method: 'put', path: '/preferences/me', body: () => ({ maxHoursPerWeek: 40 }) },
    { name: 'PUT /settings/currency', method: 'put', path: '/settings/currency', body: () => ({ currency: 'EUR' }) },
    {
      name: 'PUT /settings/time-period',
      method: 'put',
      path: '/settings/time-period',
      body: () => ({ timePeriod: 'monthly' }),
    },
  ];

  it.each(cases().map((c) => [c.name, c] as const))('%s does not fail on the SQL', async (_name, testCase) => {
    const cookie = await authCookie();
    const req = request(app)[testCase.method](`/api/v1${testCase.path}`).set('Cookie', cookie);
    const res = await (testCase.body === undefined ? req : req.send(testCase.body()));

    if (res.status >= 500) {
      throw new Error(
        `${testCase.method.toUpperCase()} /api${testCase.path} returned ${res.status}: ` +
          JSON.stringify(res.body?.error ?? res.body)
      );
    }
    // A 400 means the body never reached the database, so the case would be
    // covering nothing — that is a defect in the fixture, not in the endpoint.
    expect({ endpoint: testCase.name, status: res.status, error: res.body?.error }).not.toMatchObject({
      status: 400,
    });
  });
});

/**
 * PUT / PATCH / DELETE against the real schema, on real rows.
 *
 * WHY A SEPARATE BLOCK FROM THE POST SWEEP: the fixture-free sweeps could pass a
 * body with no path parameter. UPDATE and DELETE need a row that exists — a
 * bogus id would short-circuit at the handler's existence check and never reach
 * the mutation SQL, which is the SQL this is here to exercise. So each case
 * creates its own disposable row through the admin connection (independent of
 * the API under test) and then drives the endpoint against that id.
 *
 * Disposable rather than shared: a DELETE case must not remove a row a later
 * case depends on, and an UPDATE must not leave shared state a later assertion
 * reads. Every case is self-contained, so the block is order-independent.
 *
 * The assertion is the same "below 500" as the sweeps: a 200, a 403, a 404 and
 * a 409 all mean MySQL executed the statement and the application decided the
 * outcome. Only a 500 means the query itself was wrong. A 400 also fails the
 * case — it means validation rejected the body and no SQL ran, so the fixture
 * is wrong rather than the endpoint.
 */
describe('path-parameter mutations run against the real schema', () => {
  const tag = (): string => `${Date.now()}${process.hrtime()[1]}`;

  // Each factory INSERTs one row and returns its id, using the admin connection
  // so setup never depends on the code under test.
  const make = {
    async department(): Promise<number> {
      const [r] = await admin.query<mysql.ResultSetHeader>(
        `INSERT INTO departments (name, is_active) VALUES (?, 1)`,
        [`d-${tag()}`]
      );
      return r.insertId;
    },
    async role(): Promise<number> {
      const [r] = await admin.query<mysql.ResultSetHeader>(
        `INSERT INTO roles (name, is_system) VALUES (?, 0)`,
        [`r-${tag()}`]
      );
      return r.insertId;
    },
    async orgUnit(): Promise<number> {
      const [r] = await admin.query<mysql.ResultSetHeader>(
        `INSERT INTO org_units (name, is_active) VALUES (?, 1)`,
        [`u-${tag()}`]
      );
      return r.insertId;
    },
    async user(): Promise<number> {
      const [r] = await admin.query<mysql.ResultSetHeader>(
        `INSERT INTO users (email, password_hash, first_name, last_name, is_active)
         VALUES (?, 'x', 'Disp', 'User', 1)`,
        [`disp-${tag()}@example.com`]
      );
      return r.insertId;
    },
    async schedule(): Promise<number> {
      const [r] = await admin.query<mysql.ResultSetHeader>(
        `INSERT INTO schedules (name, start_date, end_date, department_id, status, created_by)
         VALUES (?, CURDATE(), CURDATE() + INTERVAL 7 DAY, ?, 'draft', ?)`,
        [`s-${tag()}`, departmentId, userId]
      );
      return r.insertId;
    },
    async shift(schedule: number): Promise<number> {
      const [r] = await admin.query<mysql.ResultSetHeader>(
        `INSERT INTO shifts (schedule_id, department_id, date, start_time, end_time, min_staff, max_staff, status)
         VALUES (?, ?, CURDATE() + INTERVAL 2 DAY, '09:00:00', '17:00:00', 1, 3, 'open')`,
        [schedule, departmentId]
      );
      return r.insertId;
    },
    async assignment(shift: number, user: number): Promise<number> {
      const [r] = await admin.query<mysql.ResultSetHeader>(
        `INSERT INTO shift_assignments (shift_id, user_id, status) VALUES (?, ?, 'pending')`,
        [shift, user]
      );
      return r.insertId;
    },
    async template(): Promise<number> {
      const [r] = await admin.query<mysql.ResultSetHeader>(
        `INSERT INTO shift_templates (name, department_id, start_time, end_time, min_staff, max_staff, is_active)
         VALUES (?, ?, '09:00:00', '17:00:00', 1, 3, 1)`,
        [`t-${tag()}`, departmentId]
      );
      return r.insertId;
    },
    async onCallPeriod(): Promise<number> {
      const [r] = await admin.query<mysql.ResultSetHeader>(
        `INSERT INTO on_call_periods (department_id, date, start_time, end_time, status)
         VALUES (?, CURDATE() + INTERVAL 3 DAY, '18:00:00', '23:00:00', 'open')`,
        [departmentId]
      );
      return r.insertId;
    },
    async policy(): Promise<number> {
      const [r] = await admin.query<mysql.ResultSetHeader>(
        `INSERT INTO policies (scope_type, scope_id, policy_key, policy_value, imposed_by_user_id, is_active)
         VALUES ('global', NULL, ?, '1', ?, 1)`,
        [`pk-${tag()}`, userId]
      );
      return r.insertId;
    },
    async responsibilityRule(): Promise<number> {
      const [r] = await admin.query<mysql.ResultSetHeader>(
        `INSERT INTO responsibility_rules (subject_type, subject_id, permission_code, responsible_org_unit_id, is_active)
         VALUES ('department', ?, 'schedule.read', ?, 1)`,
        [departmentId, orgUnitId]
      );
      return r.insertId;
    },
    async approvalWorkflow(): Promise<number> {
      const [r] = await admin.query<mysql.ResultSetHeader>(
        `INSERT INTO approval_workflows (change_type, require_all) VALUES (?, 0)`,
        [`ct-${tag()}`.slice(0, 40)]
      );
      return r.insertId;
    },
    async skill(): Promise<number> {
      const [r] = await admin.query<mysql.ResultSetHeader>(
        `INSERT INTO skills (name, is_active) VALUES (?, 1)`,
        [`sk-${tag()}`]
      );
      return r.insertId;
    },
    async attendanceRecord(): Promise<number> {
      // An open (not clocked-out) record for the admin, so clock-out and the
      // approve/reject actions have a real row to act on. shift_assignment_id
      // is nullable, so no shift fixture is needed.
      const [r] = await admin.query<mysql.ResultSetHeader>(
        `INSERT INTO attendance_records (user_id, clock_in, status)
         VALUES (?, NOW(), 'pending')`,
        [userId]
      );
      return r.insertId;
    },
    async notification(): Promise<number> {
      const [r] = await admin.query<mysql.ResultSetHeader>(
        `INSERT INTO notifications (user_id, type, title, is_read) VALUES (?, 'info', 'disp', 0)`,
        [userId]
      );
      return r.insertId;
    },
    async delegation(): Promise<number> {
      const [r] = await admin.query<mysql.ResultSetHeader>(
        `INSERT INTO delegations (delegator_id, delegatee_id, permission_codes, expires_at, is_active)
         VALUES (?, ?, '["schedule.read"]', CURDATE() + INTERVAL 30 DAY, 1)`,
        [userId, delegateeId]
      );
      return r.insertId;
    },
  };

  interface Case {
    name: string;
    method: 'put' | 'patch' | 'delete' | 'post';
    setup: () => Promise<{ path: string; body?: Record<string, unknown> }>;
  }

  const cases: Case[] = [
    // Departments
    { name: 'PUT /departments/:id', method: 'put', setup: async () => ({ path: `/departments/${await make.department()}`, body: { name: `d-${tag()}` } }) },
    { name: 'DELETE /departments/:id', method: 'delete', setup: async () => ({ path: `/departments/${await make.department()}` }) },
    // Roles
    { name: 'PUT /roles/:id', method: 'put', setup: async () => ({ path: `/roles/${await make.role()}`, body: { name: `r-${tag()}` } }) },
    { name: 'DELETE /roles/:id', method: 'delete', setup: async () => ({ path: `/roles/${await make.role()}` }) },
    // Org units
    { name: 'PUT /org/units/:id', method: 'put', setup: async () => ({ path: `/org/units/${await make.orgUnit()}`, body: { name: `u-${tag()}` } }) },
    { name: 'DELETE /org/units/:id', method: 'delete', setup: async () => ({ path: `/org/units/${await make.orgUnit()}` }) },
    // Users
    { name: 'PUT /users/:id', method: 'put', setup: async () => ({ path: `/users/${await make.user()}`, body: { firstName: 'Renamed' } }) },
    { name: 'DELETE /users/:id', method: 'delete', setup: async () => ({ path: `/users/${await make.user()}` }) },
    // Employees (users)
    { name: 'PUT /employees/:id', method: 'put', setup: async () => ({ path: `/employees/${await make.user()}`, body: { firstName: 'Renamed' } }) },
    { name: 'DELETE /employees/:id', method: 'delete', setup: async () => ({ path: `/employees/${await make.user()}` }) },
    // Schedules
    { name: 'PUT /schedules/:id', method: 'put', setup: async () => ({ path: `/schedules/${await make.schedule()}`, body: { name: `s-${tag()}` } }) },
    { name: 'DELETE /schedules/:id', method: 'delete', setup: async () => ({ path: `/schedules/${await make.schedule()}` }) },
    { name: 'PATCH /schedules/:id/publish', method: 'patch', setup: async () => ({ path: `/schedules/${await make.schedule()}/publish` }) },
    { name: 'PATCH /schedules/:id/archive', method: 'patch', setup: async () => ({ path: `/schedules/${await make.schedule()}/archive` }) },
    // Shifts
    { name: 'PUT /shifts/:id', method: 'put', setup: async () => { const s = await make.schedule(); return { path: `/shifts/${await make.shift(s)}`, body: { minStaff: 2 } }; } },
    { name: 'DELETE /shifts/:id', method: 'delete', setup: async () => { const s = await make.schedule(); return { path: `/shifts/${await make.shift(s)}` }; } },
    // Shift templates
    { name: 'PUT /shifts/templates/:id', method: 'put', setup: async () => ({ path: `/shifts/templates/${await make.template()}`, body: { minStaff: 2 } }) },
    { name: 'DELETE /shifts/templates/:id', method: 'delete', setup: async () => ({ path: `/shifts/templates/${await make.template()}` }) },
    // Assignments
    { name: 'PUT /assignments/:id', method: 'put', setup: async () => { const s = await make.schedule(); const sh = await make.shift(s); return { path: `/assignments/${await make.assignment(sh, delegateeId)}`, body: { status: 'confirmed' } }; } },
    { name: 'PATCH /assignments/:id/confirm', method: 'patch', setup: async () => { const s = await make.schedule(); const sh = await make.shift(s); return { path: `/assignments/${await make.assignment(sh, delegateeId)}/confirm` }; } },
    { name: 'PATCH /assignments/:id/decline', method: 'patch', setup: async () => { const s = await make.schedule(); const sh = await make.shift(s); return { path: `/assignments/${await make.assignment(sh, delegateeId)}/decline` }; } },
    { name: 'PATCH /assignments/:id/complete', method: 'patch', setup: async () => { const s = await make.schedule(); const sh = await make.shift(s); return { path: `/assignments/${await make.assignment(sh, delegateeId)}/complete` }; } },
    { name: 'DELETE /assignments/:id', method: 'delete', setup: async () => { const s = await make.schedule(); const sh = await make.shift(s); return { path: `/assignments/${await make.assignment(sh, delegateeId)}` }; } },
    // On-call
    { name: 'PUT /on-call/periods/:id', method: 'put', setup: async () => ({ path: `/on-call/periods/${await make.onCallPeriod()}`, body: { status: 'cancelled' } }) },
    { name: 'DELETE /on-call/periods/:id', method: 'delete', setup: async () => ({ path: `/on-call/periods/${await make.onCallPeriod()}` }) },
    // Policies
    { name: 'PUT /policies/:id', method: 'put', setup: async () => ({ path: `/policies/${await make.policy()}`, body: { isActive: false } }) },
    { name: 'DELETE /policies/:id', method: 'delete', setup: async () => ({ path: `/policies/${await make.policy()}` }) },
    // Responsibility rules
    { name: 'PUT /responsibility-rules/:id', method: 'put', setup: async () => ({ path: `/responsibility-rules/${await make.responsibilityRule()}`, body: { isActive: false } }) },
    { name: 'DELETE /responsibility-rules/:id', method: 'delete', setup: async () => ({ path: `/responsibility-rules/${await make.responsibilityRule()}` }) },
    // Approval workflows
    { name: 'DELETE /approval-workflows/:id', method: 'delete', setup: async () => ({ path: `/approval-workflows/${await make.approvalWorkflow()}` }) },
    // Notifications
    { name: 'PATCH /notifications/:id/read', method: 'patch', setup: async () => ({ path: `/notifications/${await make.notification()}/read` }) },
    // Delegations
    { name: 'DELETE /delegations/:id', method: 'delete', setup: async () => ({ path: `/delegations/${await make.delegation()}` }) },
    // Preferences
    { name: 'PUT /preferences/:userId', method: 'put', setup: async () => ({ path: `/preferences/${await make.user()}`, body: { maxHoursPerWeek: 40 } }) },
    // Settings
    { name: 'PUT /settings/:category/:key', method: 'put', setup: async () => ({ path: `/settings/scheduling/max_hours_week`, body: { value: '40' } }) },
    // Modules (org override on a seeded module code)
    { name: 'PUT /modules/:code', method: 'put', setup: async () => ({ path: `/modules/scheduling`, body: { isEnabled: true } }) },
    // Employee skills
    { name: 'POST /employees/:id/skills', method: 'post' as const, setup: async () => ({ path: `/employees/${await make.user()}/skills`, body: { skillId: await make.skill(), proficiencyLevel: 3 } }) },
    { name: 'DELETE /employees/:id/skills/:skillId', method: 'delete', setup: async () => {
      const u = await make.user(); const sk = await make.skill();
      await admin.query(`INSERT INTO user_skills (user_id, skill_id, proficiency_level) VALUES (?, ?, 3)`, [u, sk]);
      return { path: `/employees/${u}/skills/${sk}` };
    } },
    // Directory fields
    { name: 'PUT /directory/users/:id/fields', method: 'put', setup: async () => ({ path: `/directory/users/${await make.user()}/fields`, body: { fields: [{ key: 'nickname', value: 'itest' }] } }) },
    { name: 'DELETE /directory/users/:id/fields/:key', method: 'delete', setup: async () => {
      const u = await make.user();
      await admin.query(`INSERT INTO user_custom_fields (user_id, field_key, field_value, is_public) VALUES (?, 'nickname', 'x', 1)`, [u]);
      return { path: `/directory/users/${u}/fields/nickname` };
    } },
    // Module org override
    { name: 'PUT /modules/:code/org/:org', method: 'put', setup: async () => ({ path: `/modules/scheduling/org/itest-org`, body: { isEnabled: true } }) },
    { name: 'DELETE /modules/:code/org/:org', method: 'delete', setup: async () => {
      await admin.query(`INSERT INTO organization_module_overrides (organization_name, module_code, is_enabled) VALUES ('itest-org2', 'scheduling', 1) ON DUPLICATE KEY UPDATE is_enabled = 1`);
      return { path: `/modules/scheduling/org/itest-org2` };
    } },
    // Settings reset, approval matrix
    { name: 'POST /settings/:category/:key/reset', method: 'post' as const, setup: async () => ({ path: `/settings/scheduling/max_hours_week/reset` }) },
    { name: 'PUT /policies/approval-matrix/:changeType', method: 'put', setup: async () => ({ path: `/policies/approval-matrix/TimeOff.Request`, body: { approverScope: 'unit_manager' } }) },
    // Bulk operations
    { name: 'POST /roles/bulk-assign', method: 'post' as const, setup: async () => ({ path: `/roles/bulk-assign`, body: { roleId: await make.role(), userIds: [await make.user()] } }) },
    { name: 'POST /responsibility-rules/bulk', method: 'post' as const, setup: async () => ({ path: `/responsibility-rules/bulk`, body: { subjectType: 'department', subjectIds: [departmentId], permissionCodes: ['schedule.read'], responsibleOrgUnitId: orgUnitId } }) },
    { name: 'POST /assignments/bulk', method: 'post' as const, setup: async () => { const s = await make.schedule(); const sh = await make.shift(s); return { path: `/assignments/bulk`, body: { assignments: [{ shiftId: sh, userId: delegateeId }] } }; } },
    // On-call assignment
    { name: 'POST /on-call/periods/:id/assign', method: 'post' as const, setup: async () => ({ path: `/on-call/periods/${await make.onCallPeriod()}/assign`, body: { userId: delegateeId } }) },
    { name: 'DELETE /on-call/periods/:id/assign/:userId', method: 'delete', setup: async () => {
      const per = await make.onCallPeriod();
      await admin.query(`INSERT INTO on_call_assignments (period_id, user_id, status) VALUES (?, ?, 'pending')`, [per, delegateeId]);
      return { path: `/on-call/periods/${per}/assign/${delegateeId}` };
    } },
    // Schedule duplicate / optimization clear
    { name: 'POST /schedules/:id/duplicate', method: 'post' as const, setup: async () => ({ path: `/schedules/${await make.schedule()}/duplicate`, body: { name: `dup-${tag()}`, startDate: '2032-01-01', endDate: '2032-01-07' } }) },
    { name: 'DELETE /schedules/:id/optimization', method: 'delete', setup: async () => ({ path: `/schedules/${await make.schedule()}/optimization` }) },
    // Global actions
    { name: 'POST /approval-workflows/escalate', method: 'post' as const, setup: async () => ({ path: `/approval-workflows/escalate` }) },
    { name: 'POST /calendar/token/rotate', method: 'post' as const, setup: async () => ({ path: `/calendar/token/rotate` }) },
    // Attendance
    { name: 'POST /attendance/:id/clock-out', method: 'post' as const, setup: async () => ({ path: `/attendance/${await make.attendanceRecord()}/clock-out`, body: {} }) },
    { name: 'POST /attendance/:id/approve', method: 'post' as const, setup: async () => ({ path: `/attendance/${await make.attendanceRecord()}/approve`, body: {} }) },
    { name: 'POST /attendance/:id/reject', method: 'post' as const, setup: async () => ({ path: `/attendance/${await make.attendanceRecord()}/reject`, body: {} }) },
    // Join-table membership: distinct INSERT/DELETE SQL with cheap fixtures.
    { name: 'POST /departments/:id/users', method: 'post' as const, setup: async () => ({ path: `/departments/${departmentId}/users`, body: { userId: await make.user() } }) },
    { name: 'DELETE /departments/:id/users/:userId', method: 'delete', setup: async () => {
      const u = await make.user();
      await admin.query(`INSERT INTO user_departments (user_id, department_id) VALUES (?, ?)`, [u, departmentId]);
      return { path: `/departments/${departmentId}/users/${u}` };
    } },
    { name: 'POST /org/units/:id/members', method: 'post' as const, setup: async () => ({ path: `/org/units/${orgUnitId}/members`, body: { userId: await make.user() } }) },
    { name: 'DELETE /org/units/:id/members/:userId', method: 'delete', setup: async () => {
      const u = await make.user();
      await admin.query(`INSERT INTO user_org_units (user_id, org_unit_id, is_primary) VALUES (?, ?, 0)`, [u, orgUnitId]);
      return { path: `/org/units/${orgUnitId}/members/${u}` };
    } },
    { name: 'PATCH /org/units/:id/members/:userId/primary', method: 'patch', setup: async () => {
      const u = await make.user();
      await admin.query(`INSERT INTO user_org_units (user_id, org_unit_id, is_primary) VALUES (?, ?, 0)`, [u, orgUnitId]);
      return { path: `/org/units/${orgUnitId}/members/${u}/primary` };
    } },
    { name: 'POST /roles/users/:userId', method: 'post' as const, setup: async () => ({ path: `/roles/users/${await make.user()}`, body: { roleId: await make.role() } }) },
    { name: 'DELETE /roles/users/:userId/:roleId', method: 'delete', setup: async () => {
      const u = await make.user();
      const role = await make.role();
      await admin.query(`INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`, [u, role]);
      return { path: `/roles/users/${u}/${role}` };
    } },
  ];

  it.each(cases.map((c) => [c.name, c] as const))('%s does not fail on the SQL', async (_name, testCase) => {
    const cookie = await authCookie();
    const { path: reqPath, body } = await testCase.setup();
    const req = request(app)[testCase.method](`/api/v1${reqPath}`).set('Cookie', cookie);
    const res = await (body === undefined ? req : req.send(body));

    if (res.status >= 500) {
      throw new Error(
        `${testCase.method.toUpperCase()} /api${reqPath} returned ${res.status}: ` +
          JSON.stringify(res.body?.error ?? res.body)
      );
    }
    expect({ endpoint: testCase.name, status: res.status, error: res.body?.error }).not.toMatchObject({
      status: 400,
    });
  });
});


/**
 * Workflow actions (approve / reject / cancel / apply) against the real schema.
 *
 * WHY FILE THROUGH THE API RATHER THAN INSERT THE ROW: these actions read
 * across pending_approvals and the request table with joins, and an
 * approve/reject reaches an UPDATE only when the request is in a decidable
 * state. Hand-inserting a pending_approvals row would mean reproducing the
 * workflow/step wiring the filing path builds — brittle, and it would not
 * exercise that filing SQL. Filing through the endpoint creates the request in
 * its real state and, as a bonus, runs the filing INSERTs against the real
 * schema too.
 *
 * WHY <500 IS STILL THE BAR: a cancel by the owner reaches its UPDATE; an
 * approve with no pending-approval row returns 409, but the join-heavy read SQL
 * has already run, which is the schema-drift risk this exists to catch. Both
 * are the application deciding on a statement MySQL executed. Only a 500 means
 * the query itself was wrong.
 *
 * The pending-approvals/:id/* endpoints are deliberately not here: they need a
 * pending_approval routed to the actor, which needs an approval matrix
 * configured — a per-domain fixture rather than a filing call, tracked in the
 * #419 follow-up.
 */
describe('workflow actions run against the real schema', () => {
  let secondOrgUnit: number;
  const stamp = (): string => `${Date.now()}${process.hrtime()[1]}`;

  beforeAll(async () => {
    // The seeded approval workflows for TimeOff.Request and Loan.Request use
    // the `unit_manager` scope, so filing refuses (409) unless the requester
    // has a primary org unit whose manager can decide. Wire that here: the
    // admin manages orgUnitId and belongs to it primarily, and the loan's
    // target unit gets a manager too. Without this the fixture is undecidable,
    // which is a fixture gap — the app's guard against it is correct — not a
    // schema defect, which is what the `file` helper's loud failure showed.
    const [r] = await admin.query<mysql.ResultSetHeader>(
      `INSERT INTO org_units (name, manager_user_id, is_active) VALUES (?, ?, 1)`,
      [`wf-unit-${stamp()}`, userId]
    );
    secondOrgUnit = r.insertId;
    await admin.query(`UPDATE org_units SET manager_user_id = ? WHERE id = ?`, [userId, orgUnitId]);
    await admin.query(
      `INSERT INTO user_org_units (user_id, org_unit_id, is_primary) VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE is_primary = 1`,
      [userId, orgUnitId]
    );
    await admin.query(
      `INSERT INTO user_org_units (user_id, org_unit_id, is_primary) VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE is_primary = 1`,
      [delegateeId, orgUnitId]
    );
  });

  /** Files a request through its endpoint and returns the created id. */
  const file = async (path: string, body: Record<string, unknown>): Promise<number> => {
    const cookie = await authCookie();
    const res = await request(app).post(`/api/v1${path}`).set('Cookie', cookie).send(body);
    if (res.status >= 400) {
      throw new Error(`filing ${path} failed with ${res.status}: ${JSON.stringify(res.body?.error ?? res.body)}`);
    }
    const id = res.body?.data?.id;
    if (typeof id !== 'number') {
      throw new Error(`filing ${path} returned no numeric id: ${JSON.stringify(res.body)}`);
    }
    return id;
  };

  const fileTimeOff = (): Promise<number> =>
    file('/time-off', { startDate: '2031-01-01', endDate: '2031-01-03', type: 'vacation' });
  const fileChangeRequest = (): Promise<number> =>
    file('/change-requests', {
      changeType: 'GenericTest',
      targetEntityType: 'schedule',
      targetEntityId: scheduleId,
      proposedPayload: { note: 'itest' },
    });
  const filePolicyException = (): Promise<number> =>
    file('/policies/exceptions', { policyId: 1, targetType: 'user', targetId: delegateeId });
  const fileLoan = (): Promise<number> =>
    file('/org/loans', {
      userId: delegateeId,
      fromOrgUnitId: orgUnitId,
      toOrgUnitId: secondOrgUnit,
      startDate: '2031-02-01',
      endDate: '2031-02-28',
    });

  interface WfCase {
    name: string;
    action: (id: number) => Promise<request.Response>;
    file: () => Promise<number>;
  }

  const post = (path: string, body?: Record<string, unknown>) => async () => {
    const cookie = await authCookie();
    const req = request(app).post(`/api/v1${path}`).set('Cookie', cookie);
    return body === undefined ? req : req.send(body);
  };

  const wfCases: WfCase[] = [
    { name: 'POST /time-off/:id/approve', file: fileTimeOff, action: (id) => post(`/time-off/${id}/approve`, {})() },
    { name: 'POST /time-off/:id/reject', file: fileTimeOff, action: (id) => post(`/time-off/${id}/reject`, {})() },
    { name: 'POST /time-off/:id/cancel', file: fileTimeOff, action: (id) => post(`/time-off/${id}/cancel`)() },
    { name: 'POST /change-requests/:id/approve', file: fileChangeRequest, action: (id) => post(`/change-requests/${id}/approve`, {})() },
    { name: 'POST /change-requests/:id/reject', file: fileChangeRequest, action: (id) => post(`/change-requests/${id}/reject`, { rejectionReason: 'itest' })() },
    { name: 'POST /change-requests/:id/cancel', file: fileChangeRequest, action: (id) => post(`/change-requests/${id}/cancel`)() },
    { name: 'POST /change-requests/:id/apply', file: fileChangeRequest, action: (id) => post(`/change-requests/${id}/apply`, {})() },
    { name: 'POST /policies/exceptions/:id/approve', file: filePolicyException, action: (id) => post(`/policies/exceptions/${id}/approve`, {})() },
    { name: 'POST /policies/exceptions/:id/reject', file: filePolicyException, action: (id) => post(`/policies/exceptions/${id}/reject`, {})() },
    { name: 'POST /policies/exceptions/:id/cancel', file: filePolicyException, action: (id) => post(`/policies/exceptions/${id}/cancel`)() },
    { name: 'POST /org/loans/:id/approve', file: fileLoan, action: (id) => post(`/org/loans/${id}/approve`, {})() },
    { name: 'POST /org/loans/:id/reject', file: fileLoan, action: (id) => post(`/org/loans/${id}/reject`, {})() },
    { name: 'POST /org/loans/:id/cancel', file: fileLoan, action: (id) => post(`/org/loans/${id}/cancel`)() },
  ];

  /**
   * Files a time-off request and returns the id of the pending_approval it
   * created — now that the admin manages orgUnitId, the seeded TimeOff.Request
   * workflow routes the first step to the admin, so a real pending_approval
   * exists to act on. Read straight from the table via the admin connection so
   * the id is deterministic rather than scraped from a list response.
   */
  const filePendingApproval = async (): Promise<number> => {
    const requestId = await fileTimeOff();
    const [rows] = await admin.query<mysql.RowDataPacket[]>(
      `SELECT id FROM pending_approvals WHERE time_off_request_id = ? AND status = 'pending' LIMIT 1`,
      [requestId]
    );
    if (rows.length === 0) {
      throw new Error(`no pending_approval created for time_off_request ${requestId}`);
    }
    return rows[0].id as number;
  };

  /**
   * A structure-assigned pending approval: `keep`, `open-to-structure` and
   * `delegate` are reassignment actions a structure head takes, so they
   * require `assigned_to_org_unit_id` set and reject (400) a decision routed to
   * a single user — which is what the seeded TimeOff.Request step produces.
   * Reassign the created row to orgUnitId, whose manager is the admin, so the
   * precondition holds and the reassignment SQL runs.
   */
  const fileStructurePendingApproval = async (): Promise<number> => {
    const id = await filePendingApproval();
    await admin.query(
      `UPDATE pending_approvals SET assigned_to_user_id = NULL, assigned_to_org_unit_id = ? WHERE id = ?`,
      [orgUnitId, id]
    );
    return id;
  };

  const pendingCases: WfCase[] = [
    { name: 'POST /pending-approvals/:id/approve', file: filePendingApproval, action: (id) => post(`/pending-approvals/${id}/approve`, {})() },
    { name: 'POST /pending-approvals/:id/reject', file: filePendingApproval, action: (id) => post(`/pending-approvals/${id}/reject`, {})() },
    { name: 'POST /pending-approvals/:id/keep', file: fileStructurePendingApproval, action: (id) => post(`/pending-approvals/${id}/keep`)() },
    { name: 'POST /pending-approvals/:id/open-to-structure', file: fileStructurePendingApproval, action: (id) => post(`/pending-approvals/${id}/open-to-structure`)() },
    { name: 'POST /pending-approvals/:id/delegate', file: fileStructurePendingApproval, action: (id) => post(`/pending-approvals/${id}/delegate`, { targetUserId: delegateeId })() },
  ];

  it.each([...wfCases, ...pendingCases].map((c) => [c.name, c] as const))('%s does not fail on the SQL', async (_name, wfCase) => {
    const id = await wfCase.file();
    const res = await wfCase.action(id);
    if (res.status >= 500) {
      throw new Error(`${wfCase.name} returned ${res.status}: ${JSON.stringify(res.body?.error ?? res.body)}`);
    }
    expect({ endpoint: wfCase.name, status: res.status, error: res.body?.error }).not.toMatchObject({ status: 400 });
  });
});


/**
 * Shift-swap and CSV import against the real schema.
 *
 * Shift-swap is the multi-actor case: a swap is between two assignments held
 * by two different users, so the fixture creates two shifts, assigns one to
 * each of admin and delegatee, then files the swap and drives its actions. The
 * import endpoints take a CSV/vCard body and run batch INSERTs — worth
 * exercising against the real schema, with a one-row payload.
 */
describe('shift-swap and import run against the real schema', () => {
  const tag = (): string => `${Date.now()}${process.hrtime()[1]}`;

  const makeShift = async (): Promise<number> => {
    const [sc] = await admin.query<mysql.ResultSetHeader>(
      `INSERT INTO schedules (name, start_date, end_date, department_id, status, created_by)
       VALUES (?, CURDATE(), CURDATE() + INTERVAL 7 DAY, ?, 'draft', ?)`,
      [`swap-s-${tag()}`, departmentId, userId]
    );
    const [sh] = await admin.query<mysql.ResultSetHeader>(
      `INSERT INTO shifts (schedule_id, department_id, date, start_time, end_time, min_staff, max_staff, status)
       VALUES (?, ?, CURDATE() + INTERVAL 2 DAY, '09:00:00', '17:00:00', 1, 3, 'open')`,
      [sc.insertId, departmentId]
    );
    return sh.insertId;
  };

  const makeAssignment = async (shift: number, user: number): Promise<number> => {
    const [r] = await admin.query<mysql.ResultSetHeader>(
      `INSERT INTO shift_assignments (shift_id, user_id, status) VALUES (?, ?, 'confirmed')`,
      [shift, user]
    );
    return r.insertId;
  };

  /** Files a swap between a fresh admin assignment and a fresh delegatee one. */
  const fileSwap = async (): Promise<number> => {
    const mine = await makeAssignment(await makeShift(), userId);
    const theirs = await makeAssignment(await makeShift(), delegateeId);
    const cookie = await authCookie();
    const res = await request(app)
      .post('/api/v1/shift-swap')
      .set('Cookie', cookie)
      .send({ requesterAssignmentId: mine, targetAssignmentId: theirs });
    if (res.status >= 400) {
      throw new Error(`filing shift-swap failed with ${res.status}: ${JSON.stringify(res.body?.error ?? res.body)}`);
    }
    return res.body.data.id as number;
  };

  const drive = async (
    method: 'post',
    path: string,
    body?: Record<string, unknown>
  ): Promise<request.Response> => {
    const cookie = await authCookie();
    const req = request(app)[method](`/api/v1${path}`).set('Cookie', cookie);
    return body === undefined ? req : req.send(body);
  };

  interface SwapCase { name: string; run: () => Promise<request.Response>; }

  const cases: SwapCase[] = [
    { name: 'POST /shift-swap', run: async () => {
      const mine = await makeAssignment(await makeShift(), userId);
      const theirs = await makeAssignment(await makeShift(), delegateeId);
      return drive('post', '/shift-swap', { requesterAssignmentId: mine, targetAssignmentId: theirs });
    } },
    { name: 'POST /shift-swap/:id/approve', run: async () => drive('post', `/shift-swap/${await fileSwap()}/approve`, {}) },
    { name: 'POST /shift-swap/:id/decline', run: async () => drive('post', `/shift-swap/${await fileSwap()}/decline`, {}) },
    { name: 'POST /shift-swap/:id/cancel', run: async () => drive('post', `/shift-swap/${await fileSwap()}/cancel`) },
    { name: 'POST /import/employees', run: async () => drive('post', '/import/employees', {
      // `role` is a required column; without it the import returns 400 with
      // per-row errors — the SQL runs either way, but a clean 200 is a truer check.
      csv: `email,firstName,lastName,role\nimp-${tag()}@example.com,Imp,Ort,Employee`,
      defaultPassword: 'Password1!',
    }) },
    { name: 'POST /import/shifts', run: async () => drive('post', '/import/shifts', {
      csv: `scheduleId,departmentId,date,startTime,endTime,minStaff,maxStaff\n${scheduleId},${departmentId},2033-01-02,09:00,17:00,1,2`,
    }) },
    { name: 'POST /directory/import-vcard/preview', run: async () => drive('post', '/directory/import-vcard/preview', {
      vcf: `BEGIN:VCARD\nVERSION:3.0\nFN:Imp Ort\nEMAIL:vc-preview-${tag()}@example.com\nEND:VCARD`,
    }) },
    { name: 'POST /directory/import-vcard', run: async () => drive('post', '/directory/import-vcard', {
      vcf: `BEGIN:VCARD\nVERSION:3.0\nFN:Imp Ort\nEMAIL:vc-${tag()}@example.com\nEND:VCARD`,
      defaultPassword: 'Password1!',
    }) },
  ];

  it.each(cases.map((c) => [c.name, c] as const))('%s does not fail on the SQL', async (_name, testCase) => {
    const res = await testCase.run();
    if (res.status >= 500) {
      throw new Error(`${testCase.name} returned ${res.status}: ${JSON.stringify(res.body?.error ?? res.body)}`);
    }
    expect({ endpoint: testCase.name, status: res.status, error: res.body?.error }).not.toMatchObject({ status: 400 });
  });
});

/**
 * Overnight shifts, end to end against real MySQL.
 *
 * WHY THIS BLOCK IS MANDATORY RATHER THAN NICE TO HAVE: the fix for #465
 * introduced new SQL — `TIMESTAMP(s.date, s.start_time)` plus a computed
 * `INTERVAL ... SECOND` — and the unit suite can only prove that a string was
 * composed. Whether MySQL parses that expression, and whether it produces the
 * right answer, is exactly what a mocked pool cannot show. This is the same
 * class of gap that let three list endpoints return 500 in every deployment
 * while 2479 mocked tests passed.
 *
 * The assertions here are stronger than the sweeps above: those ask only "did
 * MySQL execute this", because their subject is SQL validity. Here the subject
 * is the ANSWER, so each case asserts which conflicts come back.
 */
describe('overnight shifts run against the real schema', () => {
  const tag = (): string => `${Date.now()}${process.hrtime()[1]}`;

  /** A shift on `date`, assigned to the admin fixture user. Returns its id. */
  const assignedShift = async (
    date: string,
    startTime: string,
    endTime: string
  ): Promise<number> => {
    const [sc] = await admin.query<mysql.ResultSetHeader>(
      `INSERT INTO schedules (name, start_date, end_date, department_id, status, created_by)
       VALUES (?, ?, ?, ?, 'draft', ?)`,
      [`on-${tag()}`, date, date, departmentId, userId]
    );
    const [sh] = await admin.query<mysql.ResultSetHeader>(
      `INSERT INTO shifts (schedule_id, department_id, date, start_time, end_time, min_staff, max_staff, status)
       VALUES (?, ?, ?, ?, ?, 1, 3, 'open')`,
      [sc.insertId, departmentId, date, startTime, endTime]
    );
    await admin.query(
      `INSERT INTO shift_assignments (shift_id, user_id, status) VALUES (?, ?, 'confirmed')`,
      [sh.insertId, userId]
    );
    return sh.insertId;
  };

  const conflictsFor = async (date: string, startTime: string, endTime: string) => {
    const { AssignmentValidator } = require('../../services/AssignmentValidator');
    const { database } = require('../../config/database');
    return new AssignmentValidator(database.getPool()).checkConflicts(
      userId,
      date,
      startTime,
      endTime
    );
  };

  it('accepts an overnight shift through the API', async () => {
    const cookie = await authCookie();
    const [sc] = await admin.query<mysql.ResultSetHeader>(
      `INSERT INTO schedules (name, start_date, end_date, department_id, status, created_by)
       VALUES (?, '2033-06-01', '2033-06-30', ?, 'draft', ?)`,
      [`on-api-${tag()}`, departmentId, userId]
    );
    // The request schema used to reject this outright with
    // "overnight shifts are not supported", while every downstream consumer
    // implemented them. A 400 here means that refusal came back.
    const res = await request(app)
      .post('/api/v1/shifts')
      .set('Cookie', cookie)
      .send({
        scheduleId: sc.insertId,
        departmentId,
        date: '2033-06-02',
        startTime: '22:00',
        endTime: '06:00',
        minStaff: 1,
        maxStaff: 2,
      });
    expect(res.status).toBeLessThan(400);
  });

  it('still rejects a zero-length shift', async () => {
    const cookie = await authCookie();
    const res = await request(app)
      .post('/api/v1/shifts')
      .set('Cookie', cookie)
      .send({
        scheduleId,
        departmentId,
        date: '2033-06-03',
        startTime: '08:00',
        endTime: '08:00',
        minStaff: 1,
        maxStaff: 2,
      });
    expect(res.status).toBe(400);
  });

  it('detects two overnight shifts overlapping on the same date', async () => {
    // 22:00-06:00 and 23:00-07:00 both dated the 10th genuinely overlap.
    // The old wall-clock query missed this: '22:00' < '07:00' is false as a
    // string comparison once the clock has wrapped.
    await assignedShift('2033-07-10', '22:00:00', '06:00:00');
    const conflicts = await conflictsFor('2033-07-10', '23:00', '07:00');
    expect(conflicts.length).toBeGreaterThan(0);
  });

  it('detects an overnight shift overlapping the following morning', async () => {
    // 22:00-06:00 on the 20th vs 02:00-08:00 on the 21st: a real overlap of
    // 02:00-06:00. The old query filtered on `s.date = '2033-07-21'` and never
    // looked at the row dated the 20th.
    await assignedShift('2033-07-20', '22:00:00', '06:00:00');
    const conflicts = await conflictsFor('2033-07-21', '02:00', '08:00');
    expect(conflicts.length).toBeGreaterThan(0);
  });

  it('does not report a conflict once the overnight shift has ended', async () => {
    // 22:00-06:00 on the 25th vs 09:00-17:00 on the 26th: adjacent, not
    // overlapping. Widening the date filter to the neighbouring days must not
    // turn every nearby shift into a conflict.
    await assignedShift('2033-07-25', '22:00:00', '06:00:00');
    const conflicts = await conflictsFor('2033-07-26', '09:00', '17:00');
    expect(conflicts).toEqual([]);
  });

  it('does not report a conflict for a shift ending before the overnight one starts', async () => {
    await assignedShift('2033-08-05', '22:00:00', '06:00:00');
    const conflicts = await conflictsFor('2033-08-05', '09:00', '17:00');
    expect(conflicts).toEqual([]);
  });
});

/**
 * Working-time limits must not be self-settable, verified against real MySQL.
 *
 * The unit suite asserts the router never passes the limit fields to the
 * service. That proves the contract, but not that the stored row is unchanged
 * — a schema strips unknown keys, so the request returns 200 either way, and a
 * test asserting "the call succeeded" passes against the defect. Reading the
 * row back afterwards is the only assertion that distinguishes them.
 */
describe('self-service preferences run against the real schema', () => {
  const readLimits = async (): Promise<{ max_hours_per_week: number; max_consecutive_days: number }> => {
    const [rows] = await admin.query<mysql.RowDataPacket[]>(
      'SELECT max_hours_per_week, max_consecutive_days FROM user_preferences WHERE user_id = ?',
      [userId]
    );
    return rows[0] as { max_hours_per_week: number; max_consecutive_days: number };
  };

  beforeAll(async () => {
    await admin.query(
      `INSERT INTO user_preferences (user_id, max_hours_per_week, min_hours_per_week, max_consecutive_days)
       VALUES (?, 32, 0, 4)
       ON DUPLICATE KEY UPDATE max_hours_per_week = 32, max_consecutive_days = 4`,
      [userId]
    );
  });

  it('stores the genuine preferences sent to /me', async () => {
    const cookie = await authCookie();
    const res = await request(app)
      .put('/api/v1/preferences/me')
      .set('Cookie', cookie)
      .send({ notes: 'prefers mornings' });
    expect(res.status).toBeLessThan(400);
  });

  it('leaves the working-time limits untouched when /me tries to set them', async () => {
    const cookie = await authCookie();
    const before = await readLimits();

    const res = await request(app)
      .put('/api/v1/preferences/me')
      .set('Cookie', cookie)
      .send({ maxHoursPerWeek: 80, maxConsecutiveDays: 14, notes: 'nice try' });

    // Accepted — the unknown keys are stripped, not rejected — so the status
    // says nothing. The stored row is what matters.
    expect(res.status).toBeLessThan(400);
    expect(await readLimits()).toEqual(before);
  });

  it('still lets a manager set them through /:userId', async () => {
    // The admin fixture holds preferences.manage, so narrowing the
    // self-service body must not have removed the capability itself.
    const cookie = await authCookie();
    const res = await request(app)
      .put(`/api/v1/preferences/${userId}`)
      .set('Cookie', cookie)
      .send({ maxHoursPerWeek: 36, maxConsecutiveDays: 5 });

    expect(res.status).toBeLessThan(400);
    const after = await readLimits();
    expect(Number(after.max_hours_per_week)).toBe(36);
    expect(Number(after.max_consecutive_days)).toBe(5);
  });
});

/**
 * The skills catalogue against real MySQL.
 *
 * The refusal to delete a skill in use is the point, and it can only be proven
 * here: the counts come from correlated subqueries over `user_skills` and
 * `shift_skills`, and the danger being guarded against is a cascade the
 * database would perform happily.
 */
describe('skills catalogue runs against the real schema', () => {
  const tag = (): string => `${Date.now()}${process.hrtime()[1]}`;

  it('creates, reads back with usage counts, and deletes when unused', async () => {
    const cookie = await authCookie();
    const created = await request(app)
      .post('/api/v1/skills')
      .set('Cookie', cookie)
      .send({ name: `Triage ${tag()}`, description: 'Assess and prioritise' });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ employeeCount: 0, shiftRequirementCount: 0 });

    const removed = await request(app)
      .delete(`/api/v1/skills/${created.body.data.id}`)
      .set('Cookie', cookie);
    // Nothing references it, so deleting is safe and a typo is not permanent.
    expect(removed.status).toBe(200);
  });

  it('refuses a duplicate name rather than letting the unique key surface as a 500', async () => {
    const cookie = await authCookie();
    const name = `Duplicate ${tag()}`;
    expect((await request(app).post('/api/v1/skills').set('Cookie', cookie).send({ name })).status).toBe(201);
    const again = await request(app).post('/api/v1/skills').set('Cookie', cookie).send({ name });
    expect(again.status).toBe(409);
  });

  it('refuses to delete a skill an employee holds, and counts it', async () => {
    const cookie = await authCookie();
    const created = await request(app)
      .post('/api/v1/skills')
      .set('Cookie', cookie)
      .send({ name: `Held ${tag()}` });
    const skillId = created.body.data.id;
    await admin.query(`INSERT INTO user_skills (user_id, skill_id) VALUES (?, ?)`, [userId, skillId]);

    const read = await request(app).get(`/api/v1/skills/${skillId}`).set('Cookie', cookie);
    expect(read.body.data.employeeCount).toBe(1);

    // The foreign key cascades, so without this guard the delete would succeed
    // and strip the skill from the person holding it.
    const refused = await request(app).delete(`/api/v1/skills/${skillId}`).set('Cookie', cookie);
    expect(refused.status).toBe(409);
  });

  it('retires a skill and hides it from the active list', async () => {
    const cookie = await authCookie();
    const created = await request(app)
      .post('/api/v1/skills')
      .set('Cookie', cookie)
      .send({ name: `Retired ${tag()}` });
    const skillId = created.body.data.id;

    const retired = await request(app)
      .put(`/api/v1/skills/${skillId}`)
      .set('Cookie', cookie)
      .send({ isActive: false });
    expect(retired.status).toBe(200);
    expect(retired.body.data.isActive).toBe(false);

    const active = await request(app).get('/api/v1/skills?activeOnly=true').set('Cookie', cookie);
    expect(active.body.data.map((s: { id: number }) => s.id)).not.toContain(skillId);
    const all = await request(app).get('/api/v1/skills').set('Cookie', cookie);
    // Still there, because existing requirements naming it stay meaningful.
    expect(all.body.data.map((s: { id: number }) => s.id)).toContain(skillId);
  });
});

/**
 * The timeline against real MySQL.
 *
 * The scoping is a join through `departments.org_unit_id` and a recursive
 * subtree walk, so whether MySQL agrees about which rows a person may see is
 * exactly what has to be proven here — a mocked pool can only show the clause
 * was composed.
 */
describe('timeline runs against the real schema', () => {
  const tag = (): string => `${Date.now()}${process.hrtime()[1]}`;

  const bars = async (cookie: string, query = 'from=2033-04-01&to=2033-04-07') => {
    const res = await request(app).get(`/api/v1/timeline?${query}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    return res.body.data;
  };

  let shiftId: number;

  beforeAll(async () => {
    const [sc] = await admin.query<mysql.ResultSetHeader>(
      `INSERT INTO schedules (name, start_date, end_date, department_id, status, created_by)
       VALUES (?, '2033-04-01', '2033-04-07', ?, 'published', ?)`,
      [`tl-${tag()}`, departmentId, userId]
    );
    const [sh] = await admin.query<mysql.ResultSetHeader>(
      `INSERT INTO shifts (schedule_id, department_id, date, start_time, end_time, min_staff, max_staff, status)
       VALUES (?, ?, '2033-04-02', '22:00:00', '06:00:00', 1, 3, 'open')`,
      [sc.insertId, departmentId]
    );
    shiftId = sh.insertId;
    await admin.query(
      `INSERT INTO shift_assignments (shift_id, user_id, status) VALUES (?, ?, 'confirmed')`,
      [shiftId, userId]
    );
  });

  it('returns a lane and an overnight bar spanning midnight', async () => {
    const cookie = await authCookie();
    const data = await bars(cookie);

    const lane = data.lanes.find((l: { id: string }) => l.id === String(userId));
    expect(lane).toBeDefined();
    const bar = data.bars.find((b: { laneId: string }) => b.laneId === String(userId));
    // One interval ending the following morning, not two fragments and not a
    // bar that ends before it begins.
    expect(bar.start).toBe('2033-04-02T22:00:00.000Z');
    expect(bar.end).toBe('2033-04-03T06:00:00.000Z');
  });

  it('never returns pay, notes or absence information', async () => {
    const cookie = await authCookie();
    const data = await bars(cookie);
    const serialised = JSON.stringify(data);
    // The fixture admin has an hourly_rate of 20; if the projection ever
    // widened, this is where it would show.
    expect(serialised).not.toContain('hourly_rate');
    expect(serialised).not.toContain('hourlyRate');
    expect(Object.keys(data.bars[0]).sort()).toEqual(
      ['end', 'label', 'laneId', 'source', 'start', 'status']
    );
  });

  it('draws only the sources asked for', async () => {
    const cookie = await authCookie();
    const data = await bars(cookie, 'from=2033-04-01&to=2033-04-07&sources=on-call');
    // The shift above is a `shifts` bar, so asking only for on-call must not
    // return it.
    expect(data.bars).toEqual([]);
    expect(data.sources).toEqual(['on-call']);
  });

  it('rejects a range longer than a quarter', async () => {
    const cookie = await authCookie();
    const res = await request(app)
      .get('/api/v1/timeline?from=2033-01-01&to=2033-12-31')
      .set('Cookie', cookie);
    expect(res.status).toBe(400);
  });

  it('lists the sources', async () => {
    const cookie = await authCookie();
    const res = await request(app).get('/api/v1/timeline/sources').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(expect.arrayContaining(['shifts', 'on-call']));
  });
});

/**
 * Which schedule a new one continues from.
 *
 * The boundary read is SQL — a join on `schedules` plus an `OR sc.id = ?` — so
 * whether MySQL agrees about which rows it selects is exactly what has to be
 * proven here. The `0` sentinel for "no predecessor" in particular: a NULL
 * would make the comparison unknown and silently drop the branch, which a
 * mocked pool cannot show.
 */
describe('schedule predecessors run against the real schema', () => {
  const tag = (): string => `${Date.now()}${process.hrtime()[1]}`;

  const makeSchedule = async (
    start: string,
    end: string,
    status: string,
    previous: number | null = null
  ): Promise<number> => {
    const [r] = await admin.query<mysql.ResultSetHeader>(
      `INSERT INTO schedules (name, start_date, end_date, department_id, status, created_by, previous_schedule_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [`pred-${tag()}`, start, end, departmentId, status, userId, previous]
    );
    return r.insertId;
  };

  it('lists candidates newest first, flagging the default', async () => {
    const cookie = await authCookie();
    const published = await makeSchedule('2040-03-01', '2040-03-31', 'published');
    const abandoned = await makeSchedule('2040-03-01', '2040-03-31', 'archived');
    const current = await makeSchedule('2040-04-01', '2040-04-30', 'draft');

    const res = await request(app)
      .get(`/api/v1/schedules/${current}/predecessor-candidates`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);

    const ids = res.body.data.map((c: { id: number }) => c.id);
    expect(ids).toEqual(expect.arrayContaining([published, abandoned]));
    // The abandoned generation is offered too — it is precisely what the
    // choice may be between — but the default is the published one.
    const byId = Object.fromEntries(res.body.data.map((c: { id: number }) => [c.id, c]));
    expect(byId[published].isDefault).toBe(true);
    expect(byId[abandoned].isDefault).toBe(false);
  });

  it('records a chosen predecessor and stops offering it as the default', async () => {
    const cookie = await authCookie();
    const published = await makeSchedule('2041-03-01', '2041-03-31', 'published');
    const abandoned = await makeSchedule('2041-03-01', '2041-03-31', 'archived');
    const current = await makeSchedule('2041-04-01', '2041-04-30', 'draft');

    const saved = await request(app)
      .put(`/api/v1/schedules/${current}`)
      .set('Cookie', cookie)
      .send({ previousScheduleId: abandoned });
    expect(saved.status).toBe(200);
    expect(saved.body.data.previousScheduleId).toBe(abandoned);

    const res = await request(app)
      .get(`/api/v1/schedules/${current}/predecessor-candidates`)
      .set('Cookie', cookie);
    const byId = Object.fromEntries(res.body.data.map((c: { id: number }) => [c.id, c]));
    expect(byId[abandoned].isCurrent).toBe(true);
    // Showing a default alongside an actual choice would suggest two answers.
    expect(byId[published].isDefault).toBe(false);
  });

  it('refuses a predecessor from another department', async () => {
    const cookie = await authCookie();
    const [otherDept] = await admin.query<mysql.ResultSetHeader>(
      `INSERT INTO departments (name, is_active) VALUES (?, 1)`,
      [`pred-dept-${tag()}`]
    );
    const [foreign] = await admin.query<mysql.ResultSetHeader>(
      `INSERT INTO schedules (name, start_date, end_date, department_id, status, created_by)
       VALUES (?, '2042-03-01', '2042-03-31', ?, 'published', ?)`,
      [`pred-foreign-${tag()}`, otherDept.insertId, userId]
    );
    const current = await makeSchedule('2042-04-01', '2042-04-30', 'draft');

    const res = await request(app)
      .put(`/api/v1/schedules/${current}`)
      .set('Cookie', cookie)
      .send({ previousScheduleId: foreign.insertId });
    // Continuity is about the same people.
    expect(res.status).toBe(409);
  });

  it('clears a choice back to the default', async () => {
    const cookie = await authCookie();
    const published = await makeSchedule('2043-03-01', '2043-03-31', 'published');
    const current = await makeSchedule('2043-04-01', '2043-04-30', 'draft', published);

    const cleared = await request(app)
      .put(`/api/v1/schedules/${current}`)
      .set('Cookie', cookie)
      .send({ previousScheduleId: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.previousScheduleId).toBeNull();

    // Null restores the default rather than saying there is no predecessor,
    // so the published schedule is offered again as such.
    const res = await request(app)
      .get(`/api/v1/schedules/${current}/predecessor-candidates`)
      .set('Cookie', cookie);
    const byId = Object.fromEntries(res.body.data.map((c: { id: number }) => [c.id, c]));
    expect(byId[published].isDefault).toBe(true);
  });
});

/**
 * Replanning a published schedule end to end.
 *
 * The removal half is what only real MySQL proves. The old persist path was
 * `INSERT IGNORE` and nothing else, so an assignment the optimizer dropped
 * survived the run and `brokenCommitments` described a removal that never
 * happened. Applying a proposal has to actually delete, and a mocked pool can
 * only show the statement was composed.
 */
describe('replanning a published schedule', () => {
  const tag = (): string => `${Date.now()}${process.hrtime()[1]}`;

  const publishedScheduleWithShift = async () => {
    const [sc] = await admin.query<mysql.ResultSetHeader>(
      `INSERT INTO schedules (name, start_date, end_date, department_id, status, created_by)
       VALUES (?, CURDATE(), CURDATE() + INTERVAL 7 DAY, ?, 'published', ?)`,
      [`replan-${tag()}`, departmentId, userId]
    );
    const [sh] = await admin.query<mysql.ResultSetHeader>(
      `INSERT INTO shifts (schedule_id, department_id, date, start_time, end_time, min_staff, max_staff, status)
       VALUES (?, ?, CURDATE() + INTERVAL 3 DAY, '09:00:00', '17:00:00', 1, 3, 'open')`,
      [sc.insertId, departmentId]
    );
    return { scheduleId: sc.insertId, shiftId: sh.insertId };
  };

  const proposal = async (
    scheduleId: number,
    payload: Record<string, unknown>,
    status = 'pending'
  ): Promise<number> => {
    const [r] = await admin.query<mysql.ResultSetHeader>(
      `INSERT INTO schedule_replan_proposals (schedule_id, proposed_by, status, engine, payload)
       VALUES (?, ?, ?, 'greedy', ?)`,
      [scheduleId, userId, status, JSON.stringify(payload)]
    );
    return r.insertId;
  };

  const assignedUsers = async (scheduleId: number): Promise<number[]> => {
    const [rows] = await admin.query<mysql.RowDataPacket[]>(
      `SELECT sa.user_id FROM shift_assignments sa
         JOIN shifts s ON s.id = sa.shift_id
        WHERE s.schedule_id = ? ORDER BY sa.user_id`,
      [scheduleId]
    );
    return rows.map((r) => r.user_id as number);
  };

  it('applies a plan by removing what it leaves out and adding what it introduces', async () => {
    const cookie = await authCookie();
    const { scheduleId, shiftId } = await publishedScheduleWithShift();
    const [replacement] = await admin.query<mysql.ResultSetHeader>(
      `INSERT INTO users (email, password_hash, first_name, last_name, is_active)
       VALUES (?, 'x', 'Replan', 'Target', 1)`,
      [`replan-${tag()}@example.com`]
    );
    await admin.query(
      `INSERT INTO shift_assignments (shift_id, user_id, status, is_pinned)
       VALUES (?, ?, 'pending', 1)`,
      [shiftId, userId]
    );

    const id = await proposal(scheduleId, {
      assignments: [{ shiftId, userId: replacement.insertId }],
      brokenCommitments: [{ userId, shiftId }],
      keptCommitments: 0,
      totalShifts: 1,
    });

    const applied = await request(app)
      .post(`/api/v1/schedules/${scheduleId}/replan-proposals/${id}/apply`)
      .set('Cookie', cookie)
      .send({ reason: 'Approved' });
    expect(applied.status).toBe(200);
    expect(applied.body.data).toMatchObject({ inserted: 1, removed: 1 });

    // The schedule is now exactly the plan. The removal is the half that never
    // used to happen, which is what made `brokenCommitments` describe people
    // who were in fact still assigned.
    expect(await assignedUsers(scheduleId)).toEqual([replacement.insertId]);

    // And the person whose shift it was has been told, in the same commit as
    // the removal — the notification cannot outlive a rollback or be lost
    // while the removal stands.
    const [notes] = await admin.query<mysql.RowDataPacket[]>(
      `SELECT title, body FROM notifications
        WHERE user_id = ? AND type = 'schedule.commitment_broken'`,
      [userId]
    );
    expect(notes).toHaveLength(1);
    expect(String(notes[0].body)).toContain('09:00–17:00');

    // One audit row per broken commitment. Who it is attributed to is pinned
    // by the unit tests, where the approver and the affected person are
    // different people; here they are both the fixture admin, so this only
    // proves the row is written.
    const [audits] = await admin.query<mysql.RowDataPacket[]>(
      `SELECT id FROM audit_logs WHERE action = 'schedule.commitment_broken'`
    );
    expect(audits).toHaveLength(1);
  });

  it('refuses the whole plan when a shift it names has gone', async () => {
    const cookie = await authCookie();
    const { scheduleId, shiftId } = await publishedScheduleWithShift();
    await admin.query(
      `INSERT INTO shift_assignments (shift_id, user_id, status) VALUES (?, ?, 'pending')`,
      [shiftId, userId]
    );
    const id = await proposal(scheduleId, {
      assignments: [{ shiftId: 999999, userId }],
      brokenCommitments: [],
      keptCommitments: 0,
      totalShifts: 1,
    });

    const res = await request(app)
      .post(`/api/v1/schedules/${scheduleId}/replan-proposals/${id}/apply`)
      .set('Cookie', cookie)
      .send({});
    expect(res.status).toBe(409);

    // Refused whole: nothing removed, and the claim that opened the
    // transaction must not leave the proposal marked applied.
    expect(await assignedUsers(scheduleId)).toEqual([userId]);
    const [rows] = await admin.query<mysql.RowDataPacket[]>(
      'SELECT status FROM schedule_replan_proposals WHERE id = ?',
      [id]
    );
    expect(rows[0].status).toBe('pending');
  });

  it('cannot decide the same proposal twice', async () => {
    const cookie = await authCookie();
    const { scheduleId } = await publishedScheduleWithShift();
    const id = await proposal(scheduleId, {
      assignments: [],
      brokenCommitments: [],
      keptCommitments: 0,
      totalShifts: 0,
    });

    const first = await request(app)
      .post(`/api/v1/schedules/${scheduleId}/replan-proposals/${id}/reject`)
      .set('Cookie', cookie)
      .send({ reason: 'Too disruptive' });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/api/v1/schedules/${scheduleId}/replan-proposals/${id}/apply`)
      .set('Cookie', cookie)
      .send({});
    expect(second.status).toBe(409);
  });

  it('refuses a proposal belonging to a different schedule', async () => {
    const cookie = await authCookie();
    const mine = await publishedScheduleWithShift();
    const other = await publishedScheduleWithShift();
    const id = await proposal(other.scheduleId, {
      assignments: [],
      brokenCommitments: [],
      keptCommitments: 0,
      totalShifts: 0,
    });

    // Without this check the schedule segment would be decoration.
    const res = await request(app)
      .post(`/api/v1/schedules/${mine.scheduleId}/replan-proposals/${id}/apply`)
      .set('Cookie', cookie)
      .send({});
    expect(res.status).toBe(404);
  });

  it('lists proposals for a schedule with their payload parsed', async () => {
    const cookie = await authCookie();
    const { scheduleId } = await publishedScheduleWithShift();
    await proposal(scheduleId, {
      assignments: [],
      brokenCommitments: [],
      keptCommitments: 0,
      totalShifts: 0,
    });

    const res = await request(app)
      .get(`/api/v1/schedules/${scheduleId}/replan-proposals`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    // The JSON column comes back parsed by the driver rather than as a string;
    // the mapper accepts either, and this is the shape that actually arrives.
    expect(res.body.data[0].payload).toHaveProperty('assignments');
  });
});

/**
 * Publishing turns assignments into commitments.
 *
 * `is_pinned` is what the optimizer reads to know an assignment must be
 * planned around rather than reconsidered, and for a while nothing wrote it:
 * the migration backfilled schedules already published, so the machinery
 * worked exactly once, for rows that predated it. Every schedule published
 * afterwards handed the optimizer an empty pinned set.
 *
 * Asserting on the column alone would not have caught that — the column was
 * always correct. Only going through the endpoint shows it.
 */
describe('publishing commits the schedule', () => {
  const tag = (): string => `${Date.now()}${process.hrtime()[1]}`;

  /**
   * A fresh person per case. Reusing a fixture user makes these tests fail
   * each other: every shift here is the same slot, so a second assignment of
   * the same person is a legitimate 409 from conflict detection and says
   * nothing about pinning.
   */
  const freshUser = async (): Promise<number> => {
    const [r] = await admin.query<mysql.ResultSetHeader>(
      `INSERT INTO users (email, password_hash, first_name, last_name, is_active)
       VALUES (?, 'x', 'Pin', 'Target', 1)`,
      [`pin-${tag()}@example.com`]
    );
    await admin.query(`INSERT INTO user_departments (user_id, department_id) VALUES (?, ?)`, [
      r.insertId,
      departmentId,
    ]);
    return r.insertId;
  };

  const draftWithAssignment = async (status = 'pending') => {
    const [sc] = await admin.query<mysql.ResultSetHeader>(
      `INSERT INTO schedules (name, start_date, end_date, department_id, status, created_by)
       VALUES (?, CURDATE(), CURDATE() + INTERVAL 7 DAY, ?, 'draft', ?)`,
      [`pin-${tag()}`, departmentId, userId]
    );
    const [sh] = await admin.query<mysql.ResultSetHeader>(
      `INSERT INTO shifts (schedule_id, department_id, date, start_time, end_time, min_staff, max_staff, status)
       VALUES (?, ?, CURDATE() + INTERVAL 2 DAY, '09:00:00', '17:00:00', 1, 3, 'open')`,
      [sc.insertId, departmentId]
    );
    const [sa] = await admin.query<mysql.ResultSetHeader>(
      `INSERT INTO shift_assignments (shift_id, user_id, status) VALUES (?, ?, ?)`,
      [sh.insertId, await freshUser(), status]
    );
    return { scheduleId: sc.insertId, shiftId: sh.insertId, assignmentId: sa.insertId };
  };

  const isPinned = async (assignmentId: number): Promise<boolean> => {
    const [rows] = await admin.query<mysql.RowDataPacket[]>(
      'SELECT is_pinned FROM shift_assignments WHERE id = ?',
      [assignmentId]
    );
    return Boolean(rows[0].is_pinned);
  };

  it('pins the live assignments of a schedule it publishes', async () => {
    const cookie = await authCookie();
    const { scheduleId, assignmentId } = await draftWithAssignment();
    expect(await isPinned(assignmentId)).toBe(false);

    const published = await request(app)
      .patch(`/api/v1/schedules/${scheduleId}/publish`)
      .set('Cookie', cookie);
    expect(published.status).toBe(200);

    expect(await isPinned(assignmentId)).toBe(true);
  });

  it('leaves a cancelled assignment unpinned', async () => {
    const cookie = await authCookie();
    const { scheduleId, assignmentId } = await draftWithAssignment('cancelled');

    await request(app).patch(`/api/v1/schedules/${scheduleId}/publish`).set('Cookie', cookie);

    // Nobody is relying on work they are not doing, and pinning it would ask
    // the optimizer to preserve it.
    expect(await isPinned(assignmentId)).toBe(false);
  });

  it('pins an assignment added to an already published schedule', async () => {
    const cookie = await authCookie();
    const { scheduleId, shiftId } = await draftWithAssignment();
    await request(app).patch(`/api/v1/schedules/${scheduleId}/publish`).set('Cookie', cookie);

    const added = await request(app)
      .post('/api/v1/assignments')
      .set('Cookie', cookie)
      .send({ shiftId, userId: await freshUser() });
    expect(added.status).toBe(201);

    // Adding someone to a live schedule tells them, which is the whole meaning
    // of the pin. The status is read in the INSERT itself, so this proves
    // MySQL evaluates the correlated comparison the way the code assumes.
    expect(await isPinned(added.body.data.id)).toBe(true);
  });

  it('leaves an assignment on a draft schedule unpinned', async () => {
    const cookie = await authCookie();
    const { shiftId } = await draftWithAssignment();

    const added = await request(app)
      .post('/api/v1/assignments')
      .set('Cookie', cookie)
      .send({ shiftId, userId: await freshUser() });
    expect(added.status).toBe(201);

    // A draft is a proposal; nobody has been told, so the optimizer stays free
    // to move it.
    expect(await isPinned(added.body.data.id)).toBe(false);
  });
});

/**
 * Pairing rules against real MySQL.
 *
 * Every rejection this service performs is a statement about rows that already
 * exist, decided by a two-directional lookup. A mocked pool can only show the
 * lookup was issued with the right parameters; whether MySQL returns the
 * reverse row — which is what makes `apart` symmetric and what makes the
 * contradiction check work at all — can only be proven here.
 */
describe('pairing rules run against the real schema', () => {
  const cleanup = async () => {
    await admin.query('DELETE FROM employee_pairings');
  };

  beforeEach(cleanup);

  it('creates a rule and returns it with both people named', async () => {
    const cookie = await authCookie();
    const created = await request(app)
      .post('/api/v1/employee-pairings')
      .set('Cookie', cookie)
      .send({ userId, otherUserId: delegateeId, kind: 'requires', reason: 'Supervision' });

    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      userId,
      otherUserId: delegateeId,
      kind: 'requires',
      reason: 'Supervision',
    });
    // The join is the point: a rule is unreadable as two bare ids.
    expect(created.body.data.otherUserName).toContain('Delegatee');
  });

  it('finds a rule from either side of it', async () => {
    const cookie = await authCookie();
    await request(app)
      .post('/api/v1/employee-pairings')
      .set('Cookie', cookie)
      .send({ userId, otherUserId: delegateeId, kind: 'apart' });

    // Filtering on `user_id` alone would make this rule invisible to the
    // person named second, whose constraint it equally is.
    const seen = await request(app)
      .get(`/api/v1/employee-pairings?userId=${delegateeId}`)
      .set('Cookie', cookie);
    expect(seen.status).toBe(200);
    expect(seen.body.data).toHaveLength(1);
  });

  it('rejects the same `apart` rule recorded in reverse', async () => {
    const cookie = await authCookie();
    const first = await request(app)
      .post('/api/v1/employee-pairings')
      .set('Cookie', cookie)
      .send({ userId, otherUserId: delegateeId, kind: 'apart' });
    expect(first.status).toBe(201);

    // The unique key is on the ORDERED pair, so the database would happily
    // store this. `apart` means the same thing read either way, and two rows
    // saying it is a duplicate the schema cannot express.
    const reversed = await request(app)
      .post('/api/v1/employee-pairings')
      .set('Cookie', cookie)
      .send({ userId: delegateeId, otherUserId: userId, kind: 'apart' });
    expect(reversed.status).toBe(409);
  });

  it('allows a mutual `requires`, which is how a symmetric pairing is expressed', async () => {
    const cookie = await authCookie();
    const first = await request(app)
      .post('/api/v1/employee-pairings')
      .set('Cookie', cookie)
      .send({ userId, otherUserId: delegateeId, kind: 'requires' });
    expect(first.status).toBe(201);

    // Reads like a deadlock and is not one: `a <= b` and `b <= a` means
    // `a == b`, so both work the shift or neither. The migration documents two
    // rows as the way to say "these two always work together".
    const back = await request(app)
      .post('/api/v1/employee-pairings')
      .set('Cookie', cookie)
      .send({ userId: delegateeId, otherUserId: userId, kind: 'requires' });
    expect(back.status).toBe(201);
  });

  it('rejects the opposite rule between the same two people', async () => {
    const cookie = await authCookie();
    await request(app)
      .post('/api/v1/employee-pairings')
      .set('Cookie', cookie)
      .send({ userId, otherUserId: delegateeId, kind: 'requires' });

    // Together these say one person may only work shifts the other works and
    // may never share a shift with them: unschedulable, permanently.
    const contradiction = await request(app)
      .post('/api/v1/employee-pairings')
      .set('Cookie', cookie)
      .send({ userId: delegateeId, otherUserId: userId, kind: 'apart' });
    expect(contradiction.status).toBe(409);
  });

  it('rejects a rule naming someone who does not exist', async () => {
    const cookie = await authCookie();
    // The foreign key would catch this too, as an unclassified 500.
    const res = await request(app)
      .post('/api/v1/employee-pairings')
      .set('Cookie', cookie)
      .send({ userId, otherUserId: 999999, kind: 'apart' });
    expect(res.status).toBe(400);
  });

  it('edits the reason and deletes the rule', async () => {
    const cookie = await authCookie();
    const created = await request(app)
      .post('/api/v1/employee-pairings')
      .set('Cookie', cookie)
      .send({ userId, otherUserId: delegateeId, kind: 'apart', reason: 'Initial' });
    const id = created.body.data.id;

    const edited = await request(app)
      .put(`/api/v1/employee-pairings/${id}`)
      .set('Cookie', cookie)
      .send({ reason: null });
    expect(edited.status).toBe(200);
    expect(edited.body.data.reason).toBeNull();

    const removed = await request(app).delete(`/api/v1/employee-pairings/${id}`).set('Cookie', cookie);
    expect(removed.status).toBe(200);
    const gone = await request(app).get(`/api/v1/employee-pairings/${id}`).set('Cookie', cookie);
    expect(gone.status).toBe(404);
  });
});

/**
 * Employment contracts against real MySQL.
 *
 * The effective-dated resolution is the reason this entity exists, and it is
 * expressed in SQL (a date-range overlap with `COALESCE(effective_to,
 * '9999-12-31')`). A mocked pool can only show the string was composed;
 * whether MySQL agrees about which rows overlap is exactly what has to be
 * proven here.
 */
describe('employment contracts run against the real schema', () => {
  const tag = (): string => `${Date.now()}${process.hrtime()[1]}`;

  it('creates, assigns and reads back a contract history', async () => {
    const cookie = await authCookie();

    const created = await request(app)
      .post('/api/v1/employment-contracts')
      .set('Cookie', cookie)
      .send({
        name: `Part time ${tag()}`,
        maxHoursPerWeek: 20,
        maxHoursPerDay: 6,
        maxConsecutiveDays: 3,
        minHoursBetweenShifts: 11,
      });
    expect(created.status).toBe(201);
    const contractId = created.body.data.id;

    const assigned = await request(app)
      .post(`/api/v1/employment-contracts/users/${userId}`)
      .set('Cookie', cookie)
      .send({ contractId, effectiveFrom: '2040-01-01', effectiveTo: '2040-06-30' });
    expect(assigned.status).toBe(201);

    const history = await request(app)
      .get(`/api/v1/employment-contracts/users/${userId}`)
      .set('Cookie', cookie);
    expect(history.status).toBe(200);
    expect(history.body.data.some((a: { contractId: number }) => a.contractId === contractId)).toBe(true);
  });

  it('rejects an overlapping period rather than storing two contracts at once', async () => {
    const cookie = await authCookie();
    const created = await request(app)
      .post('/api/v1/employment-contracts')
      .set('Cookie', cookie)
      .send({ name: `Overlap ${tag()}`, maxHoursPerWeek: 30 });
    const contractId = created.body.data.id;

    const first = await request(app)
      .post(`/api/v1/employment-contracts/users/${userId}`)
      .set('Cookie', cookie)
      .send({ contractId, effectiveFrom: '2041-01-01', effectiveTo: '2041-12-31' });
    expect(first.status).toBe(201);

    // Half-overlapping: starts inside the first period. MySQL has no exclusion
    // constraint, so this is the service's own check running against real rows.
    const clash = await request(app)
      .post(`/api/v1/employment-contracts/users/${userId}`)
      .set('Cookie', cookie)
      .send({ contractId, effectiveFrom: '2041-06-01', effectiveTo: '2042-01-31' });
    expect(clash.status).toBe(400);
  });

  it('treats an open-ended assignment as covering everything after it', async () => {
    const cookie = await authCookie();
    const created = await request(app)
      .post('/api/v1/employment-contracts')
      .set('Cookie', cookie)
      .send({ name: `Open ended ${tag()}`, maxHoursPerWeek: 35 });
    const contractId = created.body.data.id;

    const open = await request(app)
      .post(`/api/v1/employment-contracts/users/${userId}`)
      .set('Cookie', cookie)
      .send({ contractId, effectiveFrom: '2045-01-01' });
    expect(open.status).toBe(201);

    // `effective_to IS NULL` means still in force, so a later period overlaps
    // it. Getting this wrong in SQL would silently allow two live contracts.
    const later = await request(app)
      .post(`/api/v1/employment-contracts/users/${userId}`)
      .set('Cookie', cookie)
      .send({ contractId, effectiveFrom: '2046-01-01' });
    expect(later.status).toBe(400);
  });
});
