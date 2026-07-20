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

const loginCookie = async (email: string, password: string): Promise<string> => {
  const res = await request(app).post('/api/auth/login').send({ email, password });
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

  // Load the app only now, with DB_NAME already pointing at the itest DB.
  const { database } = require('../../config/database');
  const { buildApp } = require('../../app');
  app = buildApp(database.getPool(), { silent: true });
  closeAppPool = () => database.close();
}, 90_000);

afterAll(async () => {
  if (closeAppPool) await closeAppPool();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS \`${ITEST_DB}\``);
    await admin.end();
  }
}, 30_000);

describe('auth (real DB)', () => {
  it('rejects a wrong password with 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('LOGIN_FAILED');
    // Contract: a real error response must match the documented ApiError shape.
    expectErrorEnvelope(res.body);
  });

  it('logs in, serves an authenticated request, and revokes on logout', async () => {
    const cookie = await authCookie();

    const me = await request(app).get('/api/auth/verify').set('Cookie', cookie);
    expect(me.status).toBe(200);
    // Contract: a real success response must carry the { success, data } envelope.
    expectSuccessEnvelope(me.body);
    expect(me.body.data.email).toBe(ADMIN_EMAIL);
    expect(me.body.data.permissions).toContain('assignment.manage');

    const out = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect(out.status).toBe(200);

    const afterLogout = await request(app).get('/api/auth/verify').set('Cookie', cookie);
    expect(afterLogout.status).toBe(401);
  });
});

describe('assignments (real DB) — regression for the users.role column drift', () => {
  it('POST /api/assignments creates an assignment end-to-end', async () => {
    const cookie = await authCookie();
    const res = await request(app)
      .post('/api/assignments')
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
      .post('/api/assignments')
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
      .post('/api/delegations')
      .set('Cookie', cookie)
      .send({ delegateeId, permissionCodes: ['schedule.read'], expiresAt });
    expect(res.status).toBe(201);
    delegationId = res.body.data.id;
  });

  it('the delegatee holds the delegated permission at authentication time', async () => {
    const cookie = await loginCookie(DELEGATEE_EMAIL, DELEGATEE_PASSWORD);
    const me = await request(app).get('/api/auth/verify').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.data.permissions).toContain('schedule.read');
  });

  it('revoking the delegation removes the permission', async () => {
    const adminCookie = await authCookie();
    const del = await request(app)
      .delete(`/api/delegations/${delegationId}`)
      .set('Cookie', adminCookie);
    expect(del.status).toBe(200);

    const cookie = await loginCookie(DELEGATEE_EMAIL, DELEGATEE_PASSWORD);
    const me = await request(app).get('/api/auth/verify').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.data.permissions).not.toContain('schedule.read');
  });
});

describe('directory and dashboard (real DB)', () => {
  it('GET /api/users returns the seeded admin via the unscoped path', async () => {
    const cookie = await authCookie();
    const res = await request(app).get('/api/users').set('Cookie', cookie);
    expect(res.status).toBe(200);
    const emails = (res.body.data as Array<{ email: string }>).map((u) => u.email);
    expect(emails).toContain(ADMIN_EMAIL);
  });

  it('GET /api/dashboard/stats executes all aggregates against the real schema', async () => {
    const cookie = await authCookie();
    const res = await request(app).get('/api/dashboard/stats').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.totalEmployees).toBeGreaterThanOrEqual(1);
    expect(res.body.data.monthlyCost).not.toBeUndefined();
  });
});
