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
    'notifications',
    'shift_swap_requests',
    'time_off_requests',
    'on_call_assignments',
    'on_call_periods',
    'user_calendar_tokens',
    'shift_assignments',
    'shift_skills',
    'shifts',
    'shift_template_skills',
    'shift_templates',
    'schedules',
    'user_preferences',
    'user_unavailability',
    'user_custom_fields',
    'user_skills',
    'user_departments',
    'policy_exception_requests',
    'policies',
    'employee_loans',
    'user_org_units',
    'org_units',
    'skills',
    'departments',
    'users',
    // Keep system_settings as-is; we set the mode key explicitly below.
    // Keep approval_matrix as-is; defaults are seeded by init.sql.
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

/**
 * Synthetic department + employee generator.
 *
 * Creates one extra department called `Operations` and `BULK_EMPLOYEE_COUNT`
 * synthetic employees (Employee 001..050) attached to it. Used for stress-
 * test demos / "what does the UI look like with a real-sized department"
 * use cases. All rows still receive the `[DEMO]` markers used by the
 * idempotent wipe step.
 */
const BULK_DEPT_NAME = 'Operations';
const BULK_DEPT_DESCRIPTION = '[DEMO] Operations department (50 employees)';
const BULK_EMPLOYEE_COUNT = 50;
const BULK_PASSWORD = 'demo1234';

const insertBulkOperationsDepartment = async (
  conn: mysql.Connection,
  deptIds: Map<string, number>,
  skillIds: Map<string, number>,
  userIds: Map<string, number>
): Promise<void> => {
  // 1. Department
  const [deptRes] = await conn.execute<mysql.ResultSetHeader>(
    'INSERT INTO departments (name, description, is_active) VALUES (?, ?, 1)',
    [BULK_DEPT_NAME, BULK_DEPT_DESCRIPTION]
  );
  const deptId = deptRes.insertId;
  deptIds.set(BULK_DEPT_NAME, deptId);

  // 2. Single hash reused for every synthetic employee
  const passwordHash = await bcrypt.hash(BULK_PASSWORD, 4);

  // 3. Round-robin a small skill subset across employees so the directory
  //    looks alive without any one employee being suspiciously specific.
  const skillRotation = [
    skillIds.get('IV Therapy'),
    skillIds.get('CPR Certified'),
    skillIds.get('Pharmacology'),
  ].filter((id): id is number => typeof id === 'number');

  for (let i = 1; i <= BULK_EMPLOYEE_COUNT; i++) {
    const padded = String(i).padStart(3, '0');
    const email = `ops${padded}@demo.staffscheduler.local`;
    const employeeId = `DEMO-OPS-${padded}`;
    const firstName = `Employee`;
    const lastName = padded;

    const [userRes] = await conn.execute<mysql.ResultSetHeader>(
      `INSERT INTO users (email, password_hash, first_name, last_name, role,
                          employee_id, position, phone, is_active)
       VALUES (?, ?, ?, ?, 'employee', ?, '[DEMO] Operations', '+39 000 0000000', 1)`,
      [email, passwordHash, firstName, lastName, employeeId]
    );
    const userId = userRes.insertId;
    userIds.set(email, userId);

    await conn.execute(
      'INSERT INTO user_departments (user_id, department_id) VALUES (?, ?)',
      [userId, deptId]
    );

    if (skillRotation.length > 0) {
      const skillId = skillRotation[i % skillRotation.length];
      await conn.execute(
        'INSERT INTO user_skills (user_id, skill_id, proficiency_level) VALUES (?, ?, 3)',
        [userId, skillId]
      );
    }
  }

  logger.info(
    `Demo seed: synthetic department "${BULK_DEPT_NAME}" with ${BULK_EMPLOYEE_COUNT} employees inserted.`
  );
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

/**
 * Seeds the org tree, memberships, policies, loans and policy exceptions so
 * the new `Organization` and `Policies` pages have data to interact with on
 * the very first run.
 *
 * Tree shape (3 levels):
 *   Hospital
 *   ├─ Clinical Area
 *   │   ├─ Emergency Department  (managed by manager@…)
 *   │   └─ ICU
 *   └─ Operations Area
 *       └─ Operations
 */
const insertOrgTreeAndPolicies = async (
  conn: mysql.Connection,
  deptIds: Map<string, number>,
  userIds: Map<string, number>
): Promise<void> => {
  const adminId = userIds.get('admin@demo.staffscheduler.local')!;
  const managerId =
    userIds.get('emergency.manager@demo.staffscheduler.local') ??
    userIds.get('surgery.manager@demo.staffscheduler.local') ??
    adminId;
  const employeeId = userIds.get('emp01@demo.staffscheduler.local') ?? null;
  const opsLeadEmail = 'ops001@demo.staffscheduler.local';
  const opsLeadId = userIds.get(opsLeadEmail) ?? null;

  const insertUnit = async (
    name: string,
    parentId: number | null,
    managerUserId: number | null
  ): Promise<number> => {
    const [res] = await conn.execute<mysql.ResultSetHeader>(
      `INSERT INTO org_units (name, description, parent_id, manager_user_id, is_active)
       VALUES (?, ?, ?, ?, 1)`,
      [name, `[DEMO] ${name}`, parentId, managerUserId]
    );
    return res.insertId;
  };

  const hospitalId = await insertUnit('Hospital', null, adminId);
  const clinicalId = await insertUnit('Clinical Area', hospitalId, adminId);
  const operationsAreaId = await insertUnit('Operations Area', hospitalId, adminId);
  const emergencyId = await insertUnit('Emergency Department', clinicalId, managerId);
  const icuId = await insertUnit('ICU', clinicalId, managerId);
  const operationsId = await insertUnit('Operations', operationsAreaId, opsLeadId ?? adminId);

  // Memberships: every demo user gets a primary unit aligned with their main
  // department, plus a few cross-area memberships to exercise the UI.
  const memberships: Array<[number, number, boolean]> = [
    [adminId, hospitalId, true],
    [managerId, emergencyId, true],
    [managerId, icuId, false],
  ];
  if (employeeId) memberships.push([employeeId, emergencyId, true]);
  for (const [userId, unitId, isPrimary] of memberships) {
    await conn.execute(
      `INSERT INTO user_org_units (user_id, org_unit_id, is_primary) VALUES (?, ?, ?)`,
      [userId, unitId, isPrimary ? 1 : 0]
    );
  }
  if (opsLeadId) {
    await conn.execute(
      `INSERT INTO user_org_units (user_id, org_unit_id, is_primary) VALUES (?, ?, 1)`,
      [opsLeadId, operationsId]
    );
  }

  // Place every Operations synthetic employee in the Operations unit.
  for (let i = 1; i <= 50; i++) {
    const padded = String(i).padStart(3, '0');
    const opsEmail = `ops${padded}@demo.staffscheduler.local`;
    const opsUserId = userIds.get(opsEmail);
    if (!opsUserId || opsUserId === opsLeadId) continue;
    await conn.execute(
      `INSERT INTO user_org_units (user_id, org_unit_id, is_primary) VALUES (?, ?, 1)`,
      [opsUserId, operationsId]
    );
  }

  // Policies (admin imposes both):
  //   - global min_rest_hours = 11 (informational)
  //   - org_unit-scoped max_hours_week = 48 on Emergency Department
  await conn.execute(
    `INSERT INTO policies (scope_type, scope_id, policy_key, policy_value, description, imposed_by_user_id, is_active)
     VALUES ('global', NULL, 'min_rest_hours', ?, '[DEMO] Minimum rest hours between shifts', ?, 1)`,
    [JSON.stringify({ hours: 11 }), adminId]
  );
  const [maxHoursRes] = await conn.execute<mysql.ResultSetHeader>(
    `INSERT INTO policies (scope_type, scope_id, policy_key, policy_value, description, imposed_by_user_id, is_active)
     VALUES ('org_unit', ?, 'max_hours_week', ?, '[DEMO] Cap weekly hours in Emergency', ?, 1)`,
    [emergencyId, JSON.stringify({ hours: 48 }), adminId]
  );
  const maxHoursPolicyId = maxHoursRes.insertId;

  // Sample loans: one approved (manager borrows from Operations) and one pending.
  const opsBorrowed = userIds.get('ops002@demo.staffscheduler.local');
  if (opsBorrowed) {
    await conn.execute(
      `INSERT INTO employee_loans
         (user_id, from_org_unit_id, to_org_unit_id, start_date, end_date, reason,
          status, requested_by, approver_user_id, reviewed_at, review_notes)
       VALUES (?, ?, ?, ?, ?, '[DEMO] Cover ICU peak', 'approved', ?, ?, NOW(),
               '[DEMO] auto-approved at seed time')`,
      [opsBorrowed, operationsId, icuId, dateOffset(0), dateOffset(7), managerId, managerId]
    );
  }
  const opsPending = userIds.get('ops003@demo.staffscheduler.local');
  if (opsPending) {
    await conn.execute(
      `INSERT INTO employee_loans
         (user_id, from_org_unit_id, to_org_unit_id, start_date, end_date, reason,
          status, requested_by, approver_user_id)
       VALUES (?, ?, ?, ?, ?, '[DEMO] Awaiting approval', 'pending', ?, ?)`,
      [opsPending, operationsId, emergencyId, dateOffset(2), dateOffset(5), managerId, managerId]
    );
  }

  // Sample policy exception: one pending, one approved (auto-approved by owner).
  await conn.execute(
    `INSERT INTO policy_exception_requests
       (policy_id, target_type, target_id, reason, status, requested_by_user_id)
     VALUES (?, 'shift_assignment', 1, '[DEMO] Cover one-off urgent shift', 'pending', ?)`,
    [maxHoursPolicyId, managerId]
  );
  await conn.execute(
    `INSERT INTO policy_exception_requests
       (policy_id, target_type, target_id, reason, status, requested_by_user_id, reviewer_user_id, reviewed_at, review_notes)
     VALUES (?, 'shift_assignment', 2, '[DEMO] Pre-approved by admin', 'approved', ?, ?, NOW(),
             '[DEMO] auto-approved (actor is policy owner)')`,
    [maxHoursPolicyId, adminId, adminId]
  );

  logger.info(
    'Demo seed: org tree (6 units), memberships, 2 policies, 2 loans, 2 exception requests inserted.'
  );

  // Reference deptIds to keep the signature stable for callers; not used here
  // because departments and org_units are independent in this demo.
  void deptIds;
};

/**
 * Seeds in-app notifications across roles so the bell icon and notification
 * pages always have something to show in demos.
 */
const insertNotifications = async (
  conn: mysql.Connection,
  userIds: Map<string, number>
): Promise<void> => {
  const adminId = userIds.get('admin@demo.staffscheduler.local');
  const managerId =
    userIds.get('emergency.manager@demo.staffscheduler.local') ??
    userIds.get('surgery.manager@demo.staffscheduler.local') ??
    adminId ??
    null;
  const employeeId = userIds.get('emp01@demo.staffscheduler.local') ?? null;

  type Notif = { userId: number; type: string; title: string; body: string; isRead: boolean };
  const notifs: Notif[] = [];

  if (adminId) {
    notifs.push(
      {
        userId: adminId,
        type: 'system',
        title: '[DEMO] Welcome to Staff Scheduler',
        body: 'This is a demo notification. Explore the app, no real data is stored.',
        isRead: false,
      },
      {
        userId: adminId,
        type: 'approval',
        title: '[DEMO] Loan request awaiting approval',
        body: 'Operations to Emergency loan request from the seeded data.',
        isRead: false,
      }
    );
  }
  if (managerId) {
    notifs.push(
      {
        userId: managerId,
        type: 'schedule',
        title: '[DEMO] New schedule published',
        body: 'A demo schedule was published in your department.',
        isRead: false,
      },
      {
        userId: managerId,
        type: 'time_off',
        title: '[DEMO] Time-off request to review',
        body: 'A demo employee requested vacation next week.',
        isRead: true,
      }
    );
  }
  if (employeeId) {
    notifs.push(
      {
        userId: employeeId,
        type: 'shift',
        title: '[DEMO] You were assigned a new shift',
        body: 'Demo morning shift assignment.',
        isRead: false,
      },
      {
        userId: employeeId,
        type: 'swap',
        title: '[DEMO] Swap request answered',
        body: 'A demo swap request you sent is awaiting manager review.',
        isRead: false,
      }
    );
  }

  for (const n of notifs) {
    await conn.execute(
      `INSERT INTO notifications (user_id, type, title, body, link, is_read)
       VALUES (?, ?, ?, ?, NULL, ?)`,
      [n.userId, n.type, n.title, n.body, n.isRead ? 1 : 0]
    );
  }
};

/**
 * Seeds time-off requests covering the typical statuses (pending, approved,
 * rejected) so the manager review queue is non-empty.
 */
const insertTimeOffRequests = async (
  conn: mysql.Connection,
  userIds: Map<string, number>
): Promise<void> => {
  const employee1 = userIds.get('emp01@demo.staffscheduler.local');
  const employee2 = userIds.get('emp02@demo.staffscheduler.local') ?? employee1;
  const employee3 = userIds.get('ops004@demo.staffscheduler.local');
  const reviewer =
    userIds.get('emergency.manager@demo.staffscheduler.local') ??
    userIds.get('admin@demo.staffscheduler.local')!;

  if (employee1) {
    await conn.execute(
      `INSERT INTO time_off_requests
         (user_id, start_date, end_date, type, reason, status, reviewer_id)
       VALUES (?, ?, ?, 'vacation', '[DEMO] Family trip', 'pending', ?)`,
      [employee1, dateOffset(10), dateOffset(14), reviewer]
    );
  }
  if (employee2 && employee2 !== employee1) {
    await conn.execute(
      `INSERT INTO time_off_requests
         (user_id, start_date, end_date, type, reason, status, reviewer_id, reviewed_at, review_notes)
       VALUES (?, ?, ?, 'sick', '[DEMO] Flu recovery', 'approved', ?, NOW(), '[DEMO] Approved with replacement scheduled')`,
      [employee2, dateOffset(-3), dateOffset(-1), reviewer]
    );
  }
  if (employee3) {
    await conn.execute(
      `INSERT INTO time_off_requests
         (user_id, start_date, end_date, type, reason, status, reviewer_id, reviewed_at, review_notes)
       VALUES (?, ?, ?, 'personal', '[DEMO] Personal day', 'rejected', ?, NOW(), '[DEMO] Coverage unavailable on the requested day')`,
      [employee3, dateOffset(20), dateOffset(20), reviewer]
    );
  }
};

/**
 * Seeds two shift assignments and a swap request between them so the swap
 * marketplace UI has something to show.
 */
const insertSwapRequests = async (
  conn: mysql.Connection,
  userIds: Map<string, number>
): Promise<void> => {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    `SELECT id, user_id FROM shift_assignments ORDER BY id ASC LIMIT 4`
  );
  const assignments = rows as Array<{ id: number; user_id: number }>;
  if (assignments.length < 2) return;

  const reviewer =
    userIds.get('emergency.manager@demo.staffscheduler.local') ??
    userIds.get('admin@demo.staffscheduler.local')!;

  const [a, b] = [assignments[0], assignments[1]];
  if (a.user_id === b.user_id) return;
  await conn.execute(
    `INSERT INTO shift_swap_requests
       (requester_user_id, requester_assignment_id, target_user_id, target_assignment_id,
        status, notes)
     VALUES (?, ?, ?, ?, 'pending', '[DEMO] Need to swap for a family event')`,
    [a.user_id, a.id, b.user_id, b.id]
  );

  if (assignments.length >= 4) {
    const [c, d] = [assignments[2], assignments[3]];
    if (c.user_id !== d.user_id) {
      await conn.execute(
        `INSERT INTO shift_swap_requests
           (requester_user_id, requester_assignment_id, target_user_id, target_assignment_id,
            status, notes, reviewer_id, reviewed_at, review_notes)
         VALUES (?, ?, ?, ?, 'approved', '[DEMO] Approved swap',
                 ?, NOW(), '[DEMO] Approved by manager')`,
        [c.user_id, c.id, d.user_id, d.id, reviewer]
      );
    }
  }
};

/**
 * Seeds on-call coverage for the next few days so the on-call view has data.
 */
const insertOnCallCoverage = async (
  conn: mysql.Connection,
  deptIds: Map<string, number>,
  userIds: Map<string, number>
): Promise<void> => {
  const deptId =
    deptIds.get('Emergency Medicine') ??
    deptIds.get('Operations') ??
    deptIds.values().next().value;
  if (!deptId) return;
  const adminId = userIds.get('admin@demo.staffscheduler.local')!;

  const periodEntries: Array<{ daysFromNow: number; status: 'open' | 'assigned' }> = [
    { daysFromNow: 1, status: 'open' },
    { daysFromNow: 2, status: 'assigned' },
    { daysFromNow: 3, status: 'assigned' },
  ];

  for (const entry of periodEntries) {
    const [periodRes] = await conn.execute<mysql.ResultSetHeader>(
      `INSERT INTO on_call_periods
         (schedule_id, department_id, date, start_time, end_time,
          min_staff, max_staff, status, notes)
       VALUES (NULL, ?, ?, '20:00:00', '08:00:00', 1, 2, ?, '[DEMO] Overnight on-call')`,
      [deptId, dateOffset(entry.daysFromNow), entry.status]
    );

    if (entry.status === 'assigned') {
      const [usersRes] = await conn.execute<mysql.RowDataPacket[]>(
        `SELECT u.id FROM users u
         JOIN user_departments ud ON ud.user_id = u.id
         WHERE ud.department_id = ?
         ORDER BY u.id ASC
         LIMIT 1`,
        [deptId]
      );
      const userId = (usersRes[0] as any)?.id;
      if (userId) {
        await conn.execute(
          `INSERT INTO on_call_assignments
             (period_id, user_id, status, assigned_by, notes)
           VALUES (?, ?, 'confirmed', ?, '[DEMO] Confirmed on-call assignment')`,
          [periodRes.insertId, userId, adminId]
        );
      }
    }
  }
};

/**
 * Generates a stable opaque calendar token for every seeded user so the
 * .ics endpoint is testable without manual provisioning.
 */
const insertCalendarTokens = async (
  conn: mysql.Connection,
  userIds: Map<string, number>
): Promise<void> => {
  let counter = 0;
  for (const [, userId] of userIds) {
    counter += 1;
    const token = `demo-${userId.toString().padStart(4, '0')}-${counter
      .toString(36)
      .padStart(6, '0')}`;
    await conn.execute(
      `INSERT INTO user_calendar_tokens (user_id, token) VALUES (?, ?)`,
      [userId, token]
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
  const managerId =
    userIds.get('emergency.manager@demo.staffscheduler.local') ??
    userIds.get('surgery.manager@demo.staffscheduler.local') ??
    adminId;
  const employeeId = userIds.get('emp01@demo.staffscheduler.local') ?? adminId;
  const entries: Array<[number, string, string, number | null, string]> = [
    [adminId, 'login', 'auth', null, '[DEMO] Demo admin signed in'],
    [adminId, 'create_schedule', 'schedule', 1, '[DEMO] Created the demo schedule'],
    [adminId, 'publish_schedule', 'schedule', 1, '[DEMO] Published the demo schedule'],
    [managerId, 'approve_loan', 'employee_loan', 1, '[DEMO] Approved Operations→ICU loan'],
    [managerId, 'approve_swap', 'shift_swap', 1, '[DEMO] Approved a swap request'],
    [managerId, 'approve_time_off', 'time_off_request', 1, '[DEMO] Approved sick leave'],
    [employeeId, 'login', 'auth', null, '[DEMO] Demo employee signed in'],
    [employeeId, 'request_time_off', 'time_off_request', 1, '[DEMO] Requested vacation'],
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
    await insertBulkOperationsDepartment(conn, deptIds, skillIds, userIds);
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
    await insertOrgTreeAndPolicies(conn, deptIds, userIds);
    await insertNotifications(conn, userIds);
    await insertTimeOffRequests(conn, userIds);
    await insertSwapRequests(conn, userIds);
    await insertOnCallCoverage(conn, deptIds, userIds);
    await insertCalendarTokens(conn, userIds);
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
