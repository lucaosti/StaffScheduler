#!/usr/bin/env ts-node
/**
 * Demo seed script.
 *
 * Populates the database with a deterministic, obviously-fake dataset so the
 * app feels alive out of the box. Idempotent: every run wipes the demo rows
 * (matched by the `[DEMO]` markers it inserts) and re-creates them, so it is
 * safe to call repeatedly.
 *
 * Marks the runtime mode as `demo` in `system_settings(category='runtime',
 * key='mode')`. The frontend reads this via `/api/system/info` to render the
 * demo banner.
 *
 * Demo password (the same for every seeded user): `demo1234`.
 *
 * Usage:
 *   npm run db:seed:demo
 *
 * @author Luca Ostinelli
 */

import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import bcrypt from 'bcrypt';
import mysql from 'mysql2/promise';
import { logger } from '../src/config/logger';

dotenv.config();

const DEMO_PASSWORD = 'demo1234';
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'demo', 'data.json');

interface DemoUser {
  email: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'manager' | 'employee';
  employeeId: string;
  departments: string[];
  managesDepartment?: string;
  skillsByName: string[];
}

interface DemoShiftTemplate {
  name: string;
  department: string;
  startTime: string;
  endTime: string;
  minStaff: number;
  maxStaff: number;
  skillsByName: string[];
}

interface DemoFixture {
  departments: { name: string; description: string }[];
  skills: { name: string; description: string }[];
  users: DemoUser[];
  shiftTemplates: DemoShiftTemplate[];
  schedule: {
    name: string;
    department: string;
    status: 'draft' | 'published' | 'archived';
    shiftsForDays: number;
    assignmentsPerShift: { min: number; max: number };
  };
  unavailability: { userEmail: string; daysFromNow: number[]; reason: string }[];
  preferences: {
    userEmail: string;
    maxHoursPerWeek: number;
    minHoursPerWeek: number;
    maxConsecutiveDays: number;
  }[];
}

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'staff_scheduler',
};

/** Returns today's date as `YYYY-MM-DD`, optionally offset by `daysFromNow`. */
const dateOffset = (daysFromNow = 0): string => {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
};

/** Wipes every row in the right (children-first) order so re-running is safe. */
const wipeAll = async (conn: mysql.Connection): Promise<void> => {
  // Disable FK checks for the duration of the wipe; this is local-only seeding.
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  const tables = [
    'audit_logs',
    'shift_assignments',
    'shift_skills',
    'shifts',
    'shift_template_skills',
    'shift_templates',
    'schedules',
    'user_preferences',
    'user_unavailability',
    'user_skills',
    'user_departments',
    'skills',
    'departments',
    'users',
    // Keep system_settings as-is; we set the mode key explicitly below.
  ];
  for (const table of tables) {
    await conn.query(`TRUNCATE TABLE \`${table}\``);
  }
  await conn.query('SET FOREIGN_KEY_CHECKS = 1');
};

const insertDepartments = async (
  conn: mysql.Connection,
  fixture: DemoFixture
): Promise<Map<string, number>> => {
  const map = new Map<string, number>();
  for (const dept of fixture.departments) {
    const [res] = await conn.execute<mysql.ResultSetHeader>(
      'INSERT INTO departments (name, description, is_active) VALUES (?, ?, 1)',
      [dept.name, dept.description]
    );
    map.set(dept.name, res.insertId);
  }
  return map;
};

const insertSkills = async (
  conn: mysql.Connection,
  fixture: DemoFixture
): Promise<Map<string, number>> => {
  const map = new Map<string, number>();
  for (const skill of fixture.skills) {
    const [res] = await conn.execute<mysql.ResultSetHeader>(
      'INSERT INTO skills (name, description, is_active) VALUES (?, ?, 1)',
      [skill.name, skill.description]
    );
    map.set(skill.name, res.insertId);
  }
  return map;
};

const insertUsers = async (
  conn: mysql.Connection,
  fixture: DemoFixture,
  deptIds: Map<string, number>,
  skillIds: Map<string, number>
): Promise<Map<string, number>> => {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 4);
  const map = new Map<string, number>();

  for (const user of fixture.users) {
    const [res] = await conn.execute<mysql.ResultSetHeader>(
      `INSERT INTO users (email, password_hash, first_name, last_name, role,
                          employee_id, position, phone, is_active)
       VALUES (?, ?, ?, ?, ?, ?, '[DEMO]', '+39 000 0000000', 1)`,
      [user.email, passwordHash, user.firstName, user.lastName, user.role, user.employeeId]
    );
    const userId = res.insertId;
    map.set(user.email, userId);

    for (const deptName of user.departments) {
      const deptId = deptIds.get(deptName);
      if (!deptId) throw new Error(`Unknown department in fixture: ${deptName}`);
      await conn.execute(
        'INSERT INTO user_departments (user_id, department_id) VALUES (?, ?)',
        [userId, deptId]
      );
    }

    for (const skillName of user.skillsByName) {
      const skillId = skillIds.get(skillName);
      if (!skillId) throw new Error(`Unknown skill in fixture: ${skillName}`);
      await conn.execute(
        'INSERT INTO user_skills (user_id, skill_id, proficiency_level) VALUES (?, ?, 3)',
        [userId, skillId]
      );
    }
  }

  // Wire managers to their departments.
  for (const user of fixture.users) {
    if (!user.managesDepartment) continue;
    const userId = map.get(user.email)!;
    const deptId = deptIds.get(user.managesDepartment);
    if (!deptId) throw new Error(`Unknown managed department: ${user.managesDepartment}`);
    await conn.execute('UPDATE departments SET manager_id = ? WHERE id = ?', [userId, deptId]);
  }

  return map;
};

const insertShiftTemplates = async (
  conn: mysql.Connection,
  fixture: DemoFixture,
  deptIds: Map<string, number>,
  skillIds: Map<string, number>
): Promise<Map<string, number>> => {
  const map = new Map<string, number>();
  for (const tpl of fixture.shiftTemplates) {
    const deptId = deptIds.get(tpl.department);
    if (!deptId) throw new Error(`Unknown department for template: ${tpl.department}`);
    const [res] = await conn.execute<mysql.ResultSetHeader>(
      `INSERT INTO shift_templates (name, description, department_id,
                                    start_time, end_time, min_staff, max_staff, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [tpl.name, `[DEMO] ${tpl.name}`, deptId, tpl.startTime, tpl.endTime, tpl.minStaff, tpl.maxStaff]
    );
    map.set(tpl.name, res.insertId);

    for (const skillName of tpl.skillsByName) {
      const skillId = skillIds.get(skillName);
      if (!skillId) continue;
      await conn.execute(
        'INSERT INTO shift_template_skills (template_id, skill_id) VALUES (?, ?)',
        [res.insertId, skillId]
      );
    }
  }
  return map;
};

const insertScheduleWithShifts = async (
  conn: mysql.Connection,
  fixture: DemoFixture,
  deptIds: Map<string, number>,
  templateIds: Map<string, number>,
  userIds: Map<string, number>,
  adminEmail: string
): Promise<void> => {
  const sched = fixture.schedule;
  const deptId = deptIds.get(sched.department);
  const adminId = userIds.get(adminEmail);
  if (!deptId || !adminId) throw new Error('Schedule prerequisites missing');

  const startDate = dateOffset(0);
  const endDate = dateOffset(sched.shiftsForDays - 1);

  const [res] = await conn.execute<mysql.ResultSetHeader>(
    `INSERT INTO schedules (name, description, department_id, start_date, end_date,
                            status, created_by, published_at, notes)
     VALUES (?, '[DEMO] Demo schedule', ?, ?, ?, ?, ?, NOW(), '[DEMO]')`,
    [sched.name, deptId, startDate, endDate, sched.status, adminId]
  );
  const scheduleId = res.insertId;

  // Build shifts: one of each Emergency template per day for the first
  // schedule.shiftsForDays days. Assignments are deterministically picked
  // round-robin from users that belong to the relevant department.
  const allUsers = await conn.execute<mysql.RowDataPacket[]>(
    `SELECT u.id, u.email, GROUP_CONCAT(d.name) AS dept_names
     FROM users u
     LEFT JOIN user_departments ud ON u.id = ud.user_id
     LEFT JOIN departments d ON ud.department_id = d.id
     GROUP BY u.id`
  );
  const usersByDept = new Map<string, number[]>();
  for (const row of allUsers[0] as Array<{ id: number; dept_names: string | null }>) {
    const names = (row.dept_names || '').split(',');
    for (const name of names) {
      if (!name) continue;
      if (!usersByDept.has(name)) usersByDept.set(name, []);
      usersByDept.get(name)!.push(row.id);
    }
  }

  let assignedTotal = 0;
  let shiftCounter = 0;
  for (let dayOffset = 0; dayOffset < sched.shiftsForDays; dayOffset++) {
    const day = dateOffset(dayOffset);
    for (const tpl of fixture.shiftTemplates) {
      const tplId = templateIds.get(tpl.name);
      const tplDeptId = deptIds.get(tpl.department)!;
      if (!tplId) continue;

      const [shiftRes] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO shifts (schedule_id, department_id, template_id, date,
                             start_time, end_time, min_staff, max_staff, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', '[DEMO]')`,
        [scheduleId, tplDeptId, tplId, day, tpl.startTime, tpl.endTime, tpl.minStaff, tpl.maxStaff]
      );
      const shiftId = shiftRes.insertId;
      shiftCounter++;

      const candidates = usersByDept.get(tpl.department) || [];
      const targetCount = Math.min(tpl.minStaff + 1, tpl.maxStaff, candidates.length);
      for (let i = 0; i < targetCount; i++) {
        const userId = candidates[(shiftCounter + i) % candidates.length];
        // Round-robin can collide on the unique (shift_id, user_id) constraint
        // for very small candidate pools; INSERT IGNORE keeps the seed robust.
        await conn.execute(
          `INSERT IGNORE INTO shift_assignments (shift_id, user_id, status, assigned_by)
           VALUES (?, ?, ?, ?)`,
          [shiftId, userId, i % 2 === 0 ? 'confirmed' : 'pending', adminId]
        );
        assignedTotal++;
      }
    }
  }

  logger.info(
    `Demo schedule seeded: schedule=${scheduleId}, shifts=${shiftCounter}, assignments≈${assignedTotal}`
  );
};

const insertUnavailability = async (
  conn: mysql.Connection,
  fixture: DemoFixture,
  userIds: Map<string, number>
): Promise<void> => {
  for (const block of fixture.unavailability) {
    const userId = userIds.get(block.userEmail);
    if (!userId) continue;
    const start = dateOffset(Math.min(...block.daysFromNow));
    const end = dateOffset(Math.max(...block.daysFromNow));
    await conn.execute(
      'INSERT INTO user_unavailability (user_id, start_date, end_date, reason) VALUES (?, ?, ?, ?)',
      [userId, start, end, block.reason]
    );
  }
};

const insertPreferences = async (
  conn: mysql.Connection,
  fixture: DemoFixture,
  userIds: Map<string, number>
): Promise<void> => {
  for (const pref of fixture.preferences) {
    const userId = userIds.get(pref.userEmail);
    if (!userId) continue;
    await conn.execute(
      `INSERT INTO user_preferences (user_id, max_hours_per_week, min_hours_per_week,
                                     max_consecutive_days, notes)
       VALUES (?, ?, ?, ?, '[DEMO]')`,
      [userId, pref.maxHoursPerWeek, pref.minHoursPerWeek, pref.maxConsecutiveDays]
    );
  }
};

const writeDemoModeMarker = async (conn: mysql.Connection): Promise<void> => {
  await conn.execute(
    `INSERT INTO system_settings (category, \`key\`, value, type, default_value, description, is_editable)
     VALUES ('runtime', 'mode', 'demo', 'string', 'production', 'Application runtime mode', 0)
     ON DUPLICATE KEY UPDATE value = VALUES(value)`
  );
};

const insertAuditLogs = async (
  conn: mysql.Connection,
  userIds: Map<string, number>
): Promise<void> => {
  const adminId = userIds.get('admin@demo.staffscheduler.local')!;
  const entries: Array<[number, string, string, number | null, string]> = [
    [adminId, 'login', 'auth', null, '[DEMO] Demo admin signed in'],
    [adminId, 'create_schedule', 'schedule', 1, '[DEMO] Created the demo schedule'],
    [adminId, 'publish_schedule', 'schedule', 1, '[DEMO] Published the demo schedule'],
  ];
  for (const [userId, action, type, entityId, description] of entries) {
    await conn.execute(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, description, ip_address)
       VALUES (?, ?, ?, ?, ?, '127.0.0.1')`,
      [userId, action, type, entityId, description]
    );
  }
};

export async function seedDemo(): Promise<void> {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8')) as DemoFixture;
  logger.info('Seeding demo dataset…');
  logger.info(`Demo password for every seeded account: ${DEMO_PASSWORD}`);

  const conn = await mysql.createConnection({ ...dbConfig, multipleStatements: false });
  try {
    await conn.beginTransaction();

    await wipeAll(conn);

    const deptIds = await insertDepartments(conn, fixture);
    const skillIds = await insertSkills(conn, fixture);
    const userIds = await insertUsers(conn, fixture, deptIds, skillIds);
    const templateIds = await insertShiftTemplates(conn, fixture, deptIds, skillIds);
    await insertScheduleWithShifts(
      conn,
      fixture,
      deptIds,
      templateIds,
      userIds,
      'admin@demo.staffscheduler.local'
    );
    await insertUnavailability(conn, fixture, userIds);
    await insertPreferences(conn, fixture, userIds);
    await insertAuditLogs(conn, userIds);
    await writeDemoModeMarker(conn);

    await conn.commit();
    logger.info('Demo seed completed.');
    logger.info(
      `Sign in at the frontend with admin@demo.staffscheduler.local / ${DEMO_PASSWORD}`
    );
  } catch (err) {
    await conn.rollback();
    logger.error('Demo seed failed; rolled back', err);
    throw err;
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  seedDemo()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
