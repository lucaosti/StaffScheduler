#!/usr/bin/env ts-node
/**
 * Demo seed script.
 *
 * Populates the database with a deterministic, obviously-fake dataset so the
 * app feels alive out of the box. Covers every implemented feature:
 *   - Multiple schedules per department (archived / published / draft)
 *   - Shifts, assignments (confirmed + pending)
 *   - Time-off requests (pending / approved / rejected)
 *   - Shift swap requests (pending / approved)
 *   - On-call periods and assignments
 *   - Employee loans (approved / pending)
 *   - Org-unit tree with memberships
 *   - Policies and policy exceptions
 *   - Delegations (active + expired)
 *   - User preferences and unavailability
 *   - User custom fields (directory)
 *   - Calendar tokens (with readable raw tokens printed to console)
 *   - In-app notifications
 *   - Audit log entries
 *
 * Idempotent: every run wipes the demo rows and re-creates them, so it is
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
import * as crypto from 'crypto';
import bcrypt from 'bcrypt';
import mysql from 'mysql2/promise';
import { logger } from '../src/config/logger';

dotenv.config();

const DEMO_PASSWORD = 'demo1234';
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'demo', 'data.json');

// ── Types ───────────────────────────────────────────────────────────────────

interface DemoUser {
  email: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'manager' | 'employee';
  employeeId: string;
  departments: string[];
  managesDepartment?: string;
  skillsByName: string[];
  position?: string;
  phone?: string;
  hourlyRate?: number;
}

interface DemoCustomField {
  userEmail: string;
  key: string;
  value: string;
  isPublic: boolean;
}

interface DemoDelegation {
  delegatorEmail: string;
  delegateeEmail: string;
  permissionCodes: string[];
  daysFromNow: number;
  note: string;
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

interface DemoSchedule {
  name: string;
  department: string;
  status: 'draft' | 'published' | 'archived';
  startDayOffset: number;
  endDayOffset: number;
  templates: string[];
}

interface DemoFixture {
  departments: { name: string; description: string }[];
  skills: { name: string; description: string }[];
  users: DemoUser[];
  customFields: DemoCustomField[];
  delegations: DemoDelegation[];
  shiftTemplates: DemoShiftTemplate[];
  schedules: DemoSchedule[];
  unavailability: { userEmail: string; daysFromNow: number[]; reason: string }[];
  preferences: {
    userEmail: string;
    maxHoursPerWeek: number;
    minHoursPerWeek: number;
    maxConsecutiveDays: number;
  }[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'staff_scheduler',
};

const dateOffset = (daysFromNow = 0): string => {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
};

const sha256 = (raw: string): string =>
  crypto.createHash('sha256').update(raw).digest('hex');

// ── Wipe ─────────────────────────────────────────────────────────────────────

const wipeAll = async (conn: mysql.Connection): Promise<void> => {
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  const tables = [
    'audit_logs',
    'notifications',
    // Instance data for the generic approval engine — must go before the
    // entity tables below (change_requests, time_off_requests,
    // employee_loans, shift_swap_requests) so a reseed never leaves
    // orphaned pending_approvals/decision_reassignments rows pointing at
    // entity ids that no longer exist once those tables are truncated.
    // (approval_workflows/approval_steps are static config seeded once by
    // init.sql, not demo data, so they are intentionally not wiped here.)
    'decision_reassignments',
    'pending_approvals',
    'change_requests',
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
    'user_roles',
    'delegations',
    'policy_exception_requests',
    'policies',
    'employee_loans',
    'user_org_units',
    'org_units',
    'skills',
    'departments',
    'users',
  ];
  for (const table of tables) {
    await conn.query(`TRUNCATE TABLE \`${table}\``);
  }
  await conn.query('SET FOREIGN_KEY_CHECKS = 1');
};

// ── Role helpers ─────────────────────────────────────────────────────────────

const ROLE_NAME_BY_KEY: Record<DemoUser['role'], string> = {
  admin: 'Administrator',
  manager: 'Manager',
  employee: 'Employee',
};

const loadRoleIds = async (conn: mysql.Connection): Promise<Map<string, number>> => {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>('SELECT id, name FROM roles');
  const map = new Map<string, number>();
  for (const row of rows as Array<{ id: number; name: string }>) map.set(row.name, row.id);
  return map;
};

const assignRole = async (
  conn: mysql.Connection,
  userId: number,
  roleId: number | undefined
): Promise<void> => {
  if (!roleId) return;
  await conn.execute(
    'INSERT IGNORE INTO user_roles (user_id, role_id, scope_org_unit_id) VALUES (?, ?, NULL)',
    [userId, roleId]
  );
};

// ── Core inserts ─────────────────────────────────────────────────────────────

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
  skillIds: Map<string, number>,
  roleIds: Map<string, number>
): Promise<Map<string, number>> => {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 4);
  const map = new Map<string, number>();

  for (const user of fixture.users) {
    const [res] = await conn.execute<mysql.ResultSetHeader>(
      `INSERT INTO users
         (email, password_hash, first_name, last_name, employee_id,
          position, phone, hourly_rate, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        user.email, passwordHash, user.firstName, user.lastName, user.employeeId,
        user.position ?? '[DEMO]',
        user.phone ?? '+39 000 0000000',
        user.hourlyRate ?? 0,
      ]
    );
    const userId = res.insertId;
    map.set(user.email, userId);
    await assignRole(conn, userId, roleIds.get(ROLE_NAME_BY_KEY[user.role]));

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

  for (const user of fixture.users) {
    if (!user.managesDepartment) continue;
    const userId = map.get(user.email)!;
    const deptId = deptIds.get(user.managesDepartment);
    if (!deptId) throw new Error(`Unknown managed department: ${user.managesDepartment}`);
    await conn.execute('UPDATE departments SET manager_id = ? WHERE id = ?', [userId, deptId]);
  }

  return map;
};

/**
 * Synthetic department + employee generator.
 * Creates an `Operations` department with 50 synthetic employees.
 */
const BULK_DEPT_NAME = 'Operations';
const BULK_DEPT_DESCRIPTION = '[DEMO] Operations department (50 employees)';
const BULK_EMPLOYEE_COUNT = 50;

const insertBulkOperationsDepartment = async (
  conn: mysql.Connection,
  deptIds: Map<string, number>,
  skillIds: Map<string, number>,
  userIds: Map<string, number>,
  roleIds: Map<string, number>
): Promise<void> => {
  const [deptRes] = await conn.execute<mysql.ResultSetHeader>(
    'INSERT INTO departments (name, description, is_active) VALUES (?, ?, 1)',
    [BULK_DEPT_NAME, BULK_DEPT_DESCRIPTION]
  );
  const deptId = deptRes.insertId;
  deptIds.set(BULK_DEPT_NAME, deptId);

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 4);

  const skillRotation = [
    skillIds.get('IV Therapy'),
    skillIds.get('CPR Certified'),
    skillIds.get('Pharmacology'),
  ].filter((id): id is number => typeof id === 'number');

  for (let i = 1; i <= BULK_EMPLOYEE_COUNT; i++) {
    const padded = String(i).padStart(3, '0');
    const email = `ops${padded}@demo.staffscheduler.local`;
    const employeeId = `DEMO-OPS-${padded}`;

    const [userRes] = await conn.execute<mysql.ResultSetHeader>(
      `INSERT INTO users
         (email, password_hash, first_name, last_name, employee_id,
          position, phone, hourly_rate, is_active)
       VALUES (?, ?, 'Employee', ?, ?, '[DEMO] Operations', '+39 000 0000000', 25.00, 1)`,
      [email, passwordHash, padded, employeeId]
    );
    const userId = userRes.insertId;
    userIds.set(email, userId);
    await assignRole(conn, userId, roleIds.get('Employee'));

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

// ── Custom fields ─────────────────────────────────────────────────────────────

const insertCustomFields = async (
  conn: mysql.Connection,
  fixture: DemoFixture,
  userIds: Map<string, number>
): Promise<void> => {
  for (const field of fixture.customFields) {
    const userId = userIds.get(field.userEmail);
    if (!userId) continue;
    await conn.execute(
      `INSERT INTO user_custom_fields (user_id, field_key, field_value, is_public)
       VALUES (?, ?, ?, ?)`,
      [userId, field.key, field.value, field.isPublic ? 1 : 0]
    );
  }
  logger.info(`Demo seed: ${fixture.customFields.length} user custom fields inserted.`);
};

// ── Delegations ───────────────────────────────────────────────────────────────

const insertDelegations = async (
  conn: mysql.Connection,
  fixture: DemoFixture,
  userIds: Map<string, number>
): Promise<void> => {
  for (const delegation of fixture.delegations) {
    const delegatorId = userIds.get(delegation.delegatorEmail);
    const delegateeId = userIds.get(delegation.delegateeEmail);
    if (!delegatorId || !delegateeId) continue;

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + delegation.daysFromNow);

    const isActive = delegation.daysFromNow > 0;

    await conn.execute(
      `INSERT INTO delegations
         (delegator_id, delegatee_id, permission_codes, expires_at, is_active)
       VALUES (?, ?, ?, ?, ?)`,
      [
        delegatorId,
        delegateeId,
        JSON.stringify(delegation.permissionCodes),
        expiresAt.toISOString().slice(0, 19).replace('T', ' '),
        isActive ? 1 : 0,
      ]
    );
  }
  logger.info(`Demo seed: ${fixture.delegations.length} delegations inserted.`);
};

// ── Shift templates ───────────────────────────────────────────────────────────

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
      `INSERT INTO shift_templates
         (name, description, department_id, start_time, end_time,
          min_staff, max_staff, is_active)
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

// ── Schedules + shifts + assignments ─────────────────────────────────────────

/**
 * Builds all schedules defined in the fixture. Each schedule entry specifies:
 *   - department, status, day offsets, which templates to use
 *
 * For archived and published schedules, shifts are created and assignments
 * are added round-robin. Draft schedules get shifts but no assignments,
 * simulating a schedule still being built.
 */
const insertAllSchedules = async (
  conn: mysql.Connection,
  fixture: DemoFixture,
  deptIds: Map<string, number>,
  templateIds: Map<string, number>,
  userIds: Map<string, number>,
  adminEmail: string
): Promise<void> => {
  const adminId = userIds.get(adminEmail)!;

  const allUsersRes = await conn.execute<mysql.RowDataPacket[]>(
    `SELECT u.id, GROUP_CONCAT(d.name) AS dept_names
     FROM users u
     LEFT JOIN user_departments ud ON u.id = ud.user_id
     LEFT JOIN departments d ON ud.department_id = d.id
     GROUP BY u.id`
  );
  const usersByDept = new Map<string, number[]>();
  for (const row of allUsersRes[0] as Array<{ id: number; dept_names: string | null }>) {
    for (const name of (row.dept_names || '').split(',')) {
      if (!name) continue;
      if (!usersByDept.has(name)) usersByDept.set(name, []);
      usersByDept.get(name)!.push(row.id);
    }
  }

  let totalSchedules = 0;
  let totalShifts = 0;
  let totalAssignments = 0;

  for (const sched of fixture.schedules) {
    const deptId = deptIds.get(sched.department);
    if (!deptId) throw new Error(`Unknown department for schedule: ${sched.department}`);

    const startDate = dateOffset(sched.startDayOffset);
    const endDate = dateOffset(sched.endDayOffset);

    const [res] = await conn.execute<mysql.ResultSetHeader>(
      `INSERT INTO schedules
         (name, description, department_id, start_date, end_date,
          status, created_by, published_at, notes)
       VALUES (?, '[DEMO]', ?, ?, ?, ?, ?,
               ${sched.status !== 'draft' ? 'NOW()' : 'NULL'},
               '[DEMO]')`,
      [sched.name, deptId, startDate, endDate, sched.status, adminId]
    );
    const scheduleId = res.insertId;
    totalSchedules++;

    const days = sched.endDayOffset - sched.startDayOffset + 1;
    let shiftCounter = 0;

    for (let dayIdx = 0; dayIdx < days; dayIdx++) {
      const day = dateOffset(sched.startDayOffset + dayIdx);

      for (const tplName of sched.templates) {
        const tpl = fixture.shiftTemplates.find((t) => t.name === tplName);
        if (!tpl) continue;
        const tplId = templateIds.get(tplName);
        const tplDeptId = deptIds.get(tpl.department)!;
        if (!tplId) continue;

        const [shiftRes] = await conn.execute<mysql.ResultSetHeader>(
          `INSERT INTO shifts
             (schedule_id, department_id, template_id, date,
              start_time, end_time, min_staff, max_staff, status, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', '[DEMO]')`,
          [scheduleId, tplDeptId, tplId, day, tpl.startTime, tpl.endTime, tpl.minStaff, tpl.maxStaff]
        );
        const shiftId = shiftRes.insertId;
        totalShifts++;
        shiftCounter++;

        // Draft schedules get no assignments — they're still being planned.
        if (sched.status === 'draft') continue;

        const candidates = usersByDept.get(tpl.department) || [];
        if (candidates.length === 0) continue;
        const targetCount = Math.min(tpl.minStaff + 1, tpl.maxStaff, candidates.length);

        for (let i = 0; i < targetCount; i++) {
          const userId = candidates[(shiftCounter + i) % candidates.length];
          const status = sched.status === 'archived'
            ? 'confirmed'
            : (i % 2 === 0 ? 'confirmed' : 'pending');
          await conn.execute(
            `INSERT IGNORE INTO shift_assignments
               (shift_id, user_id, status, assigned_by)
             VALUES (?, ?, ?, ?)`,
            [shiftId, userId, status, adminId]
          );
          totalAssignments++;
        }
      }
    }
  }

  logger.info(
    `Demo seed: ${totalSchedules} schedules, ${totalShifts} shifts, ~${totalAssignments} assignments.`
  );
};

// ── Unavailability + preferences ──────────────────────────────────────────────

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
      `INSERT INTO user_preferences
         (user_id, max_hours_per_week, min_hours_per_week, max_consecutive_days, notes)
       VALUES (?, ?, ?, ?, '[DEMO]')`,
      [userId, pref.maxHoursPerWeek, pref.minHoursPerWeek, pref.maxConsecutiveDays]
    );
  }
};

// ── Org tree + policies ───────────────────────────────────────────────────────

/**
 * Tree shape (3 levels):
 *   Hospital
 *   ├─ Clinical Area
 *   │   ├─ Emergency Department  (managed by emergency.manager)
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
  const opsLeadId = userIds.get('ops001@demo.staffscheduler.local') ?? null;

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

  const hospitalId        = await insertUnit('Hospital', null, adminId);
  const clinicalId        = await insertUnit('Clinical Area', hospitalId, adminId);
  const operationsAreaId  = await insertUnit('Operations Area', hospitalId, adminId);
  const emergencyUnitId   = await insertUnit('Emergency Department', clinicalId, managerId);
  const icuId             = await insertUnit('ICU', clinicalId, managerId);
  const operationsUnitId  = await insertUnit('Operations', operationsAreaId, opsLeadId ?? adminId);

  const memberships: Array<[number, number, boolean]> = [
    [adminId, hospitalId, true],
    [managerId, emergencyUnitId, true],
    [managerId, icuId, false],
  ];
  if (employeeId) memberships.push([employeeId, emergencyUnitId, true]);
  for (const [uid, unitId, isPrimary] of memberships) {
    await conn.execute(
      'INSERT INTO user_org_units (user_id, org_unit_id, is_primary) VALUES (?, ?, ?)',
      [uid, unitId, isPrimary ? 1 : 0]
    );
  }
  if (opsLeadId) {
    await conn.execute(
      'INSERT INTO user_org_units (user_id, org_unit_id, is_primary) VALUES (?, ?, 1)',
      [opsLeadId, operationsUnitId]
    );
  }

  for (let i = 2; i <= 50; i++) {
    const padded = String(i).padStart(3, '0');
    const uid = userIds.get(`ops${padded}@demo.staffscheduler.local`);
    if (!uid) continue;
    await conn.execute(
      'INSERT INTO user_org_units (user_id, org_unit_id, is_primary) VALUES (?, ?, 1)',
      [uid, operationsUnitId]
    );
  }

  await conn.execute(
    `INSERT INTO policies
       (scope_type, scope_id, policy_key, policy_value, description,
        imposed_by_user_id, is_active)
     VALUES ('global', NULL, 'min_rest_hours', ?, '[DEMO] Minimum rest hours between shifts', ?, 1)`,
    [JSON.stringify({ hours: 11 }), adminId]
  );
  const [maxHoursRes] = await conn.execute<mysql.ResultSetHeader>(
    `INSERT INTO policies
       (scope_type, scope_id, policy_key, policy_value, description,
        imposed_by_user_id, is_active)
     VALUES ('org_unit', ?, 'max_hours_week', ?, '[DEMO] Cap weekly hours in Emergency', ?, 1)`,
    [emergencyUnitId, JSON.stringify({ hours: 48 }), adminId]
  );
  const maxHoursPolicyId = maxHoursRes.insertId;

  const opsBorrowed = userIds.get('ops002@demo.staffscheduler.local');
  if (opsBorrowed) {
    await conn.execute(
      `INSERT INTO employee_loans
         (user_id, from_org_unit_id, to_org_unit_id, start_date, end_date,
          reason, status, requested_by, approver_user_id, reviewed_at, review_notes)
       VALUES (?, ?, ?, ?, ?, '[DEMO] Cover ICU peak', 'approved', ?, ?, NOW(),
               '[DEMO] Approved at seed time')`,
      [opsBorrowed, operationsUnitId, icuId, dateOffset(0), dateOffset(7), managerId, managerId]
    );
  }
  const opsPending = userIds.get('ops003@demo.staffscheduler.local');
  if (opsPending) {
    await conn.execute(
      `INSERT INTO employee_loans
         (user_id, from_org_unit_id, to_org_unit_id, start_date, end_date,
          reason, status, requested_by, approver_user_id)
       VALUES (?, ?, ?, ?, ?, '[DEMO] Awaiting approval', 'pending', ?, ?)`,
      [opsPending, operationsUnitId, emergencyUnitId, dateOffset(2), dateOffset(5), managerId, managerId]
    );
  }

  await conn.execute(
    `INSERT INTO policy_exception_requests
       (policy_id, target_type, target_id, reason, status, requested_by_user_id)
     VALUES (?, 'shift_assignment', 1, '[DEMO] Cover one-off urgent shift', 'pending', ?)`,
    [maxHoursPolicyId, managerId]
  );
  await conn.execute(
    `INSERT INTO policy_exception_requests
       (policy_id, target_type, target_id, reason, status,
        requested_by_user_id, reviewer_user_id, reviewed_at, review_notes)
     VALUES (?, 'shift_assignment', 2, '[DEMO] Pre-approved by admin', 'approved',
             ?, ?, NOW(), '[DEMO] auto-approved (actor is policy owner)')`,
    [maxHoursPolicyId, adminId, adminId]
  );

  logger.info('Demo seed: org tree, memberships, policies, loans, exceptions inserted.');
  void deptIds;
};

// ── Time-off requests ─────────────────────────────────────────────────────────

const insertTimeOffRequests = async (
  conn: mysql.Connection,
  userIds: Map<string, number>
): Promise<void> => {
  const employee1 = userIds.get('emp01@demo.staffscheduler.local');
  const employee2 = userIds.get('emp02@demo.staffscheduler.local') ?? employee1;
  const employee3 = userIds.get('emp05@demo.staffscheduler.local');
  const employee4 = userIds.get('emp07@demo.staffscheduler.local');
  const ops004    = userIds.get('ops004@demo.staffscheduler.local');
  const reviewer  =
    userIds.get('emergency.manager@demo.staffscheduler.local') ??
    userIds.get('admin@demo.staffscheduler.local')!;
  const surgeryReviewer =
    userIds.get('surgery.manager@demo.staffscheduler.local') ?? reviewer;

  const requests: Array<[number | undefined, string, number, number, string, string, number | null, string | null]> = [
    // userId, type, startOffset, endOffset, reason, status, reviewerId, reviewNotes
    [employee1, 'vacation', 10, 14,  '[DEMO] Family trip',                'pending',  reviewer,        null],
    [employee2, 'sick',     -3, -1,  '[DEMO] Flu recovery',               'approved', reviewer,        '[DEMO] Approved — replacement scheduled'],
    [employee3, 'personal', 5,   5,  '[DEMO] Personal appointment',       'pending',  reviewer,        null],
    [employee4, 'vacation', 20, 27,  '[DEMO] Summer holiday',             'approved', surgeryReviewer, '[DEMO] Approved'],
    [ops004,    'personal', 20, 20,  '[DEMO] Personal day',               'rejected', reviewer,        '[DEMO] Coverage unavailable'],
  ];

  for (const [userId, type, startOff, endOff, reason, status, reviewerId, reviewNotes] of requests) {
    if (!userId) continue;
    const isReviewed = status !== 'pending';
    await conn.execute(
      `INSERT INTO time_off_requests
         (user_id, start_date, end_date, type, reason, status,
          reviewer_id, reviewed_at, review_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?,
               ${isReviewed ? 'NOW()' : 'NULL'},
               ?)`,
      [userId, dateOffset(startOff), dateOffset(endOff), type, reason, status, reviewerId, reviewNotes]
    );
  }
  logger.info(`Demo seed: ${requests.length} time-off requests inserted.`);
};

// ── Shift swap requests ───────────────────────────────────────────────────────

const insertSwapRequests = async (
  conn: mysql.Connection,
  userIds: Map<string, number>
): Promise<void> => {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    `SELECT id, user_id FROM shift_assignments ORDER BY id ASC LIMIT 8`
  );
  const assignments = rows as Array<{ id: number; user_id: number }>;
  if (assignments.length < 2) return;

  const reviewer =
    userIds.get('emergency.manager@demo.staffscheduler.local') ??
    userIds.get('admin@demo.staffscheduler.local')!;

  let inserted = 0;
  const usedIds = new Set<number>();

  for (let i = 0; i + 1 < assignments.length && inserted < 3; i += 2) {
    const a = assignments[i];
    const b = assignments[i + 1];
    if (a.user_id === b.user_id) continue;
    if (usedIds.has(a.id) || usedIds.has(b.id)) continue;
    usedIds.add(a.id);
    usedIds.add(b.id);

    if (inserted === 0) {
      await conn.execute(
        `INSERT INTO shift_swap_requests
           (requester_user_id, requester_assignment_id, target_user_id, target_assignment_id,
            status, notes)
         VALUES (?, ?, ?, ?, 'pending', '[DEMO] Need to swap for a family event')`,
        [a.user_id, a.id, b.user_id, b.id]
      );
    } else if (inserted === 1) {
      await conn.execute(
        `INSERT INTO shift_swap_requests
           (requester_user_id, requester_assignment_id, target_user_id, target_assignment_id,
            status, notes, reviewer_id, reviewed_at, review_notes)
         VALUES (?, ?, ?, ?, 'approved', '[DEMO] Approved swap',
                 ?, NOW(), '[DEMO] Approved by manager')`,
        [a.user_id, a.id, b.user_id, b.id, reviewer]
      );
    } else {
      await conn.execute(
        `INSERT INTO shift_swap_requests
           (requester_user_id, requester_assignment_id, target_user_id, target_assignment_id,
            status, notes, reviewer_id, reviewed_at, review_notes)
         VALUES (?, ?, ?, ?, 'declined', '[DEMO] Could not accommodate',
                 ?, NOW(), '[DEMO] Coverage insufficient')`,
        [a.user_id, a.id, b.user_id, b.id, reviewer]
      );
    }
    inserted++;
  }
  logger.info(`Demo seed: ${inserted} shift swap requests inserted.`);
};

// ── On-call coverage ──────────────────────────────────────────────────────────

const insertOnCallCoverage = async (
  conn: mysql.Connection,
  deptIds: Map<string, number>,
  userIds: Map<string, number>
): Promise<void> => {
  const emergencyId =
    deptIds.get('Emergency') ??
    deptIds.get('Emergency Medicine') ??
    deptIds.values().next().value as number;
  const adminId = userIds.get('admin@demo.staffscheduler.local')!;

  const entries: Array<{ daysFromNow: number; status: 'open' | 'assigned' }> = [
    { daysFromNow: 0, status: 'assigned' },
    { daysFromNow: 1, status: 'assigned' },
    { daysFromNow: 2, status: 'open' },
    { daysFromNow: 3, status: 'open' },
  ];

  for (const entry of entries) {
    const [periodRes] = await conn.execute<mysql.ResultSetHeader>(
      `INSERT INTO on_call_periods
         (schedule_id, department_id, date, start_time, end_time,
          min_staff, max_staff, status, notes)
       VALUES (NULL, ?, ?, '20:00:00', '08:00:00', 1, 2, ?, '[DEMO] Overnight on-call')`,
      [emergencyId, dateOffset(entry.daysFromNow), entry.status]
    );

    if (entry.status === 'assigned') {
      // LIMIT/OFFSET literals — mysql2 prepared statements do not support ? in LIMIT/OFFSET.
      const offset = entry.daysFromNow;
      const [usersRes] = await conn.execute<mysql.RowDataPacket[]>(
        `SELECT u.id FROM users u
         JOIN user_departments ud ON ud.user_id = u.id
         WHERE ud.department_id = ?
         ORDER BY u.id ASC LIMIT 1 OFFSET ${offset}`,
        [emergencyId]
      );
      const userId = (usersRes[0] as { id?: number } | undefined)?.id;
      if (userId) {
        await conn.execute(
          `INSERT INTO on_call_assignments
             (period_id, user_id, status, assigned_by, notes)
           VALUES (?, ?, 'confirmed', ?, '[DEMO] Confirmed on-call')`,
          [periodRes.insertId, userId, adminId]
        );
      }
    }
  }
};

// ── Calendar tokens ───────────────────────────────────────────────────────────

/**
 * Generates a readable raw token for every seeded user and stores its
 * SHA-256 hash. The raw tokens are printed so demo users can immediately
 * subscribe their calendar clients without going through the UI.
 */
const insertCalendarTokens = async (
  conn: mysql.Connection,
  userIds: Map<string, number>
): Promise<void> => {
  const feedSamples: string[] = [];
  let counter = 0;
  for (const [email, userId] of userIds) {
    counter += 1;
    const rawToken = `demo-${userId.toString().padStart(4, '0')}-${counter
      .toString(36)
      .padStart(6, '0')}`;
    const tokenHash = sha256(rawToken);
    await conn.execute(
      'INSERT INTO user_calendar_tokens (user_id, token_hash) VALUES (?, ?)',
      [userId, tokenHash]
    );
    if (counter <= 4) {
      feedSamples.push(`  ${email}: /api/calendar/feed.ics?token=${rawToken}`);
    }
  }
  logger.info(
    `Demo seed: calendar tokens inserted. Sample feed URLs:\n${feedSamples.join('\n')}`
  );
};

// ── Notifications ─────────────────────────────────────────────────────────────

const insertNotifications = async (
  conn: mysql.Connection,
  userIds: Map<string, number>
): Promise<void> => {
  const adminId    = userIds.get('admin@demo.staffscheduler.local');
  const managerId  = userIds.get('emergency.manager@demo.staffscheduler.local') ?? adminId ?? null;
  const employeeId = userIds.get('emp01@demo.staffscheduler.local') ?? null;

  type N = { userId: number; type: string; title: string; body: string; isRead: boolean };
  const notifs: N[] = [];

  if (adminId) {
    notifs.push(
      { userId: adminId, type: 'system',   title: '[DEMO] Welcome to Staff Scheduler',        body: 'Explore the app — no real data is stored.',              isRead: false },
      { userId: adminId, type: 'approval', title: '[DEMO] Loan request awaiting approval',     body: 'Operations→Emergency loan from the seeded data.',        isRead: false },
      { userId: adminId, type: 'approval', title: '[DEMO] Policy exception pending',           body: 'One exception request is pending your review.',          isRead: true  }
    );
  }
  if (managerId) {
    notifs.push(
      { userId: managerId, type: 'schedule', title: '[DEMO] New schedule published',    body: 'Emergency current-month schedule was published.', isRead: false },
      { userId: managerId, type: 'time_off', title: '[DEMO] Time-off request to review', body: 'emp01 requested 5 days vacation next week.',       isRead: true  },
      { userId: managerId, type: 'swap',     title: '[DEMO] Shift swap request',         body: 'A swap request between two Emergency nurses.',    isRead: false }
    );
  }
  if (employeeId) {
    notifs.push(
      { userId: employeeId, type: 'shift',         title: '[DEMO] You were assigned a new shift', body: 'Emergency Morning shift — check your schedule.',    isRead: false },
      { userId: employeeId, type: 'shiftswap.approved', title: '[DEMO] Swap request approved',   body: 'Your shift swap has been approved by the manager.', isRead: false },
      { userId: employeeId, type: 'time_off',      title: '[DEMO] Time-off approved',             body: 'Your sick-leave request has been approved.',        isRead: true  }
    );
  }

  for (const n of notifs) {
    await conn.execute(
      'INSERT INTO notifications (user_id, type, title, body, link, is_read) VALUES (?, ?, ?, ?, NULL, ?)',
      [n.userId, n.type, n.title, n.body, n.isRead ? 1 : 0]
    );
  }
  logger.info(`Demo seed: ${notifs.length} notifications inserted.`);
};

// ── Audit log ─────────────────────────────────────────────────────────────────

const insertAuditLogs = async (
  conn: mysql.Connection,
  userIds: Map<string, number>
): Promise<void> => {
  const adminId    = userIds.get('admin@demo.staffscheduler.local')!;
  const managerId  = userIds.get('emergency.manager@demo.staffscheduler.local') ?? userIds.get('surgery.manager@demo.staffscheduler.local') ?? adminId;
  const employeeId = userIds.get('emp01@demo.staffscheduler.local') ?? adminId;

  const entries: Array<[number, string, string, number | null, string]> = [
    [adminId,    'login',            'auth',                  null, '[DEMO] Admin signed in'],
    [adminId,    'create_schedule',  'schedule',              1,    '[DEMO] Created Emergency — Current Month schedule'],
    [adminId,    'publish_schedule', 'schedule',              1,    '[DEMO] Published Emergency — Current Month schedule'],
    [adminId,    'create_schedule',  'schedule',              2,    '[DEMO] Created Surgery — Current Month schedule'],
    [managerId,  'approve_loan',     'employee_loan',         1,    '[DEMO] Approved Operations→ICU loan'],
    [managerId,  'approve_swap',     'shift_swap',            1,    '[DEMO] Approved swap request'],
    [managerId,  'approve_time_off', 'time_off_request',      1,    '[DEMO] Approved sick-leave request'],
    [managerId,  'login',            'auth',                  null, '[DEMO] Manager signed in'],
    [employeeId, 'login',            'auth',                  null, '[DEMO] Employee signed in'],
    [employeeId, 'request_time_off', 'time_off_request',      1,    '[DEMO] Requested vacation'],
    [employeeId, 'confirm_assignment','shift_assignment',      1,    '[DEMO] Confirmed morning shift assignment'],
  ];
  for (const [userId, action, type, entityId, description] of entries) {
    await conn.execute(
      `INSERT INTO audit_logs
         (user_id, action, entity_type, entity_id, description, ip_address)
       VALUES (?, ?, ?, ?, ?, '127.0.0.1')`,
      [userId, action, type, entityId, description]
    );
  }
  logger.info(`Demo seed: ${entries.length} audit log entries inserted.`);
};

// ── Demo mode marker ──────────────────────────────────────────────────────────

const writeDemoModeMarker = async (conn: mysql.Connection): Promise<void> => {
  await conn.execute(
    `INSERT INTO system_settings
       (category, \`key\`, value, type, default_value, description, is_editable)
     VALUES ('runtime', 'mode', 'demo', 'string', 'production', 'Application runtime mode', 0)
     ON DUPLICATE KEY UPDATE value = VALUES(value)`
  );
};

// ── Entry point ───────────────────────────────────────────────────────────────

export async function seedDemo(): Promise<void> {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8')) as DemoFixture;
  logger.info('Seeding demo dataset…');
  logger.info(`Demo password for every seeded account: ${DEMO_PASSWORD}`);

  const conn = await mysql.createConnection({ ...dbConfig, multipleStatements: false });
  try {
    await conn.beginTransaction();

    await wipeAll(conn);

    const roleIds     = await loadRoleIds(conn);
    const deptIds     = await insertDepartments(conn, fixture);
    const skillIds    = await insertSkills(conn, fixture);
    const userIds     = await insertUsers(conn, fixture, deptIds, skillIds, roleIds);
    await insertBulkOperationsDepartment(conn, deptIds, skillIds, userIds, roleIds);
    const templateIds = await insertShiftTemplates(conn, fixture, deptIds, skillIds);
    await insertAllSchedules(conn, fixture, deptIds, templateIds, userIds, 'admin@demo.staffscheduler.local');
    await insertUnavailability(conn, fixture, userIds);
    await insertPreferences(conn, fixture, userIds);
    await insertOrgTreeAndPolicies(conn, deptIds, userIds);
    await insertCustomFields(conn, fixture, userIds);
    await insertDelegations(conn, fixture, userIds);
    await insertNotifications(conn, userIds);
    await insertTimeOffRequests(conn, userIds);
    await insertSwapRequests(conn, userIds);
    await insertOnCallCoverage(conn, deptIds, userIds);
    await insertCalendarTokens(conn, userIds);
    await insertAuditLogs(conn, userIds);
    await writeDemoModeMarker(conn);

    await conn.commit();
    logger.info('Demo seed completed successfully.');
    logger.info(`Sign in: admin@demo.staffscheduler.local / ${DEMO_PASSWORD}`);
  } catch (err) {
    await conn.rollback();
    logger.error('Demo seed failed — rolled back', err);
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
