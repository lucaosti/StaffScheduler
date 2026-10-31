/**
 * Concurrent writes against a REAL MySQL server.
 *
 * The unit suites mock the pool, and api.integration.test.ts sends one request
 * at a time, so neither can see what happens when two transactions interleave:
 * a check that reads before another transaction's uncommitted insert, or two
 * transactions taking the same locks in opposite orders. Those failures only
 * exist under InnoDB's real locking, so this suite fires genuinely concurrent
 * requests (`Promise.all` over one listening server, each request on its own
 * pooled connection) at the real app and then reads the database directly for
 * the states no interleaving may produce.
 *
 * Run with: npm run test:integration -- concurrency
 * Requires the same MySQL as api.integration.test.ts; provisions and drops its
 * own database (`staff_scheduler_ctest`).
 *
 * @author Luca Ostinelli
 */

// Env before the first `../../config` require: app modules load lazily below.
const CTEST_DB = process.env.CTEST_DB_NAME || 'staff_scheduler_ctest';
process.env.DB_NAME = CTEST_DB;
process.env.NODE_ENV = 'test';
// Redis is not the subject here; the caches fall back in-process (see
// api.integration.test.ts for the same choice).
process.env.REDIS_ENABLED = 'false';

import http from 'http';
import mysql from 'mysql2/promise';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { migrationUpSql } from '../helpers/schema';

const DB = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
};

const ADMIN_EMAIL = 'ctest-admin@example.com';
const ADMIN_PASSWORD = 'ctest-password-123';

let admin: mysql.Connection;
let server: http.Server;
let cookie: string;
let closeAppPool: () => Promise<void>;
let departmentId: number;
let scheduleId: number;

/** Inserts `count` active users and returns their ids. */
const createUsers = async (prefix: string, count: number): Promise<number[]> => {
  const ids: number[] = [];
  for (let i = 0; i < count; i++) {
    const [res] = await admin.query<mysql.ResultSetHeader>(
      `INSERT INTO users (email, password_hash, first_name, last_name, is_active)
       VALUES (?, 'x', 'Ctest', ?, 1)`,
      [`${prefix}-${i}@example.com`, `${prefix}${i}`]
    );
    ids.push(res.insertId);
  }
  return ids;
};

const createOrgUnits = async (prefix: string, count: number): Promise<number[]> => {
  const ids: number[] = [];
  for (let i = 0; i < count; i++) {
    const [res] = await admin.query<mysql.ResultSetHeader>(
      `INSERT INTO org_units (name, description, parent_id, manager_user_id, is_active)
       VALUES (?, 'concurrency', NULL, NULL, 1)`,
      [`${prefix} ${i}`]
    );
    ids.push(res.insertId);
  }
  return ids;
};

beforeAll(async () => {
  admin = await mysql.createConnection({ ...DB, multipleStatements: true });
  await admin.query(`DROP DATABASE IF EXISTS \`${CTEST_DB}\``);
  await admin.query(`CREATE DATABASE \`${CTEST_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await admin.query(`USE \`${CTEST_DB}\``);
  await admin.query(migrationUpSql());

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 4);
  const [userRes] = await admin.query<mysql.ResultSetHeader>(
    `INSERT INTO users (email, password_hash, first_name, last_name, is_active)
     VALUES (?, ?, 'Ctest', 'Admin', 1)`,
    [ADMIN_EMAIL, passwordHash]
  );
  await admin.query(
    `INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE name = 'Administrator'`,
    [userRes.insertId]
  );
  const [deptRes] = await admin.query<mysql.ResultSetHeader>(
    `INSERT INTO departments (name, description, is_active) VALUES ('Ctest Dept', 'concurrency', 1)`
  );
  departmentId = deptRes.insertId;
  const [schedRes] = await admin.query<mysql.ResultSetHeader>(
    `INSERT INTO schedules (name, start_date, end_date, department_id, status, created_by)
     VALUES ('Ctest Schedule', CURDATE(), CURDATE() + INTERVAL 60 DAY, ?, 'draft', ?)`,
    [departmentId, userRes.insertId]
  );
  scheduleId = schedRes.insertId;

  const { database } = require('../../config/database');
  const { buildApp } = require('../../app');
  // One listening server for the whole suite: supertest against a bare app
  // would open a server per request, which is concurrency of a sort, but a
  // single server is what production has.
  server = buildApp(database.getPool(), { silent: true }).listen(0);
  closeAppPool = () => database.close();

  const login = await request(server).post('/api/v1/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  expect(login.status).toBe(200);
  const setCookie = login.headers['set-cookie'] as unknown as string[];
  cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
}, 90_000);

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (closeAppPool) await closeAppPool();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS \`${CTEST_DB}\``);
    await admin.end();
  }
}, 30_000);

// ── #964: concurrent org-unit placements ─────────────────────────────────────

describe('POST /org/units/{id}/members under concurrency (#964)', () => {
  const place = (unitId: number, userId: number, isPrimary: boolean) =>
    request(server)
      .post(`/api/v1/org/units/${unitId}/members`)
      .set('Cookie', cookie)
      .send({ userId, isPrimary });

  it('places one person in several units at once as primary: every request succeeds, one primary remains', async () => {
    const [person] = await createUsers('same-person', 1);
    const units = await createOrgUnits('Same person unit', 12);

    const responses = await Promise.all(units.map((unitId) => place(unitId, person, true)));

    expect(responses.map((r) => r.status)).toEqual(units.map(() => 201));
    const [rows] = await admin.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS memberships, SUM(is_primary) AS primaries FROM user_org_units WHERE user_id = ?`,
      [person]
    );
    expect(Number(rows[0].memberships)).toBe(units.length);
    expect(Number(rows[0].primaries)).toBe(1);
  }, 60_000);

  it('places many people at once, each in two units: every request succeeds, one primary per person', async () => {
    const people = await createUsers('many-people', 16);
    const units = await createOrgUnits('Many people unit', 2);

    const responses = await Promise.all(
      people.flatMap((userId) => units.map((unitId) => place(unitId, userId, true)))
    );

    expect(responses.filter((r) => r.status !== 201).map((r) => [r.status, r.body?.error?.code])).toEqual([]);
    const [rows] = await admin.query<mysql.RowDataPacket[]>(
      `SELECT user_id, SUM(is_primary) AS primaries FROM user_org_units
        WHERE user_id IN (${people.map(() => '?').join(', ')}) GROUP BY user_id`,
      people
    );
    expect(rows).toHaveLength(people.length);
    expect(rows.map((r) => Number(r.primaries))).toEqual(people.map(() => 1));
  }, 60_000);
});

// ── #829: concurrent assignments ─────────────────────────────────────────────

/**
 * The load harness reproduced it at 8–16 concurrent requests: K requests
 * booking one person onto K overlapping shifts all commit, because the
 * overlap check is a plain read that cannot see the other transactions'
 * uncommitted inserts. Exactly one may succeed. The capacity case (K people
 * onto a one-seat shift) is the control: that path already serialized on the
 * shift row, and must keep doing so.
 */
describe('POST /assignments under concurrency (#829)', () => {
  const K = 12;
  let dayOffset = 10;

  /** Inserts `count` shifts on one day of the schedule, all 09:00-17:00. */
  const createShifts = async (count: number, maxStaff: number): Promise<number[]> => {
    dayOffset += 2;
    const ids: number[] = [];
    for (let i = 0; i < count; i++) {
      const [res] = await admin.query<mysql.ResultSetHeader>(
        `INSERT INTO shifts (schedule_id, department_id, date, start_time, end_time, min_staff, max_staff, status)
         VALUES (?, ?, CURDATE() + INTERVAL ? DAY, '09:00:00', '17:00:00', 1, ?, 'open')`,
        [scheduleId, departmentId, dayOffset, maxStaff]
      );
      ids.push(res.insertId);
    }
    return ids;
  };

  const assign = (shiftId: number, userId: number) =>
    request(server).post('/api/v1/assignments').set('Cookie', cookie).send({ shiftId, userId });

  const statusesOf = (responses: request.Response[]) =>
    responses.map((r) => `${r.status}${r.status === 201 ? '' : `:${r.body?.error?.code}`}`).sort();

  it('books one person onto K overlapping shifts at once: exactly one succeeds, the others 409', async () => {
    const [person] = await createUsers('overlap-person', 1);
    const shifts = await createShifts(K, 3);

    const responses = await Promise.all(shifts.map((shiftId) => assign(shiftId, person)));

    expect(statusesOf(responses)).toEqual(['201', ...Array(K - 1).fill('409:CONFLICT')].sort());
    const [rows] = await admin.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM shift_assignments WHERE user_id = ? AND status IN ('pending', 'confirmed')`,
      [person]
    );
    expect(Number(rows[0].n)).toBe(1);
  }, 60_000);

  it('assigns K people at once to a shift with one seat: exactly one succeeds (the capacity control)', async () => {
    const people = await createUsers('capacity-person', K);
    const [shift] = await createShifts(1, 1);

    const responses = await Promise.all(people.map((userId) => assign(shift, userId)));

    expect(statusesOf(responses)).toEqual(['201', ...Array(K - 1).fill('409:CONFLICT')].sort());
    const [rows] = await admin.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM shift_assignments WHERE shift_id = ? AND status IN ('pending', 'confirmed')`,
      [shift]
    );
    expect(Number(rows[0].n)).toBe(1);
  }, 60_000);

  it('books different people onto overlapping shifts at once without refusing any of them', async () => {
    // The per-person lock must serialize one person's bookings only: K
    // people, each onto their own shift of the same hours, all succeed.
    const people = await createUsers('parallel-person', K);
    const shifts = await createShifts(K, 3);

    const responses = await Promise.all(people.map((userId, i) => assign(shifts[i], userId)));

    expect(statusesOf(responses)).toEqual(Array(K).fill('201'));
  }, 60_000);
});
