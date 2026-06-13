#!/usr/bin/env ts-node
/**
 * Production seed script.
 *
 * Seeds a clean database with the minimal initial configuration required to
 * start operating: one Administrator account, departments, skills, shift
 * templates, and system settings.  No fake/demo data is inserted.
 *
 * Usage:
 *   1. Copy scripts/fixtures/production/config.template.json
 *          to scripts/fixtures/production/config.json
 *   2. Fill in every TODO field and remove the "_instructions" key.
 *   3. npm run db:seed:production
 *
 * The script is idempotent for departments, skills, shift templates, and
 * system settings (INSERT IGNORE / ON DUPLICATE KEY UPDATE).  The admin user
 * is created only when no user with that e-mail exists yet.
 *
 * Marks the runtime mode as `production` in system_settings so the app does
 * not show the demo banner.
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

const CONFIG_PATH = path.join(__dirname, 'fixtures', 'production', 'config.json');
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS ?? '12', 10);

// ── Types ───────────────────────────────────────────────────────────────────

interface ProductionAdmin {
  email: string;
  firstName: string;
  lastName: string;
  employeeId: string;
  password: string;
}

interface ProductionOrganization {
  name: string;
  timezone: string;
}

interface ProductionDepartment {
  name: string;
  code: string;
  description: string;
}

interface ProductionSkill {
  name: string;
  description: string;
}

interface ProductionShiftTemplate {
  name: string;
  department: string;
  startTime: string;
  endTime: string;
  requiredStaff: number;
  color?: string;
}

interface ProductionSystemSetting {
  category: string;
  key: string;
  value: string;
}

interface ProductionConfig {
  admin: ProductionAdmin;
  organization: ProductionOrganization;
  departments: ProductionDepartment[];
  skills: ProductionSkill[];
  shiftTemplates: ProductionShiftTemplate[];
  systemSettings: ProductionSystemSetting[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function loadConfig(): ProductionConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    logger.error(
      `Production config not found at ${CONFIG_PATH}. ` +
      'Copy config.template.json to config.json and fill in your values.'
    );
    process.exit(1);
  }
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  if ('_instructions' in parsed) {
    logger.error(
      'config.json still contains the "_instructions" key from the template. ' +
      'Remove it before running this script.'
    );
    process.exit(1);
  }

  const hasTodo = raw.includes('TODO_');
  if (hasTodo) {
    logger.error(
      'config.json contains unfilled TODO_ placeholders. ' +
      'Replace every TODO_ value before seeding.'
    );
    process.exit(1);
  }

  return parsed as unknown as ProductionConfig;
}

// ── Seed functions ────────────────────────────────────────────────────────────

async function ensureAdmin(pool: mysql.Pool, config: ProductionConfig): Promise<number> {
  const { email, firstName, lastName, employeeId, password } = config.admin;
  const [[existing]] = await pool.execute<mysql.RowDataPacket[]>(
    'SELECT id FROM users WHERE email = ?', [email]
  );
  if (existing) {
    logger.info(`Admin user already exists (${email}) — skipping creation`);
    return (existing as { id: number }).id;
  }

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const [result] = await pool.execute<mysql.ResultSetHeader>(
    `INSERT INTO users (email, password_hash, first_name, last_name, employee_id, is_active)
     VALUES (?, ?, ?, ?, ?, TRUE)`,
    [email, hash, firstName, lastName, employeeId]
  );
  const adminId = result.insertId;
  logger.info(`Created admin user: ${email} (id=${adminId})`);

  // Grant the Administrator system role.
  const [[adminRole]] = await pool.execute<mysql.RowDataPacket[]>(
    "SELECT id FROM roles WHERE name = 'Administrator'"
  );
  if (adminRole) {
    await pool.execute(
      'INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)',
      [adminId, (adminRole as { id: number }).id]
    );
    logger.info('Granted Administrator role to admin user');
  } else {
    logger.warn('Administrator role not found — run db:init first');
  }

  return adminId;
}

async function seedDepartments(pool: mysql.Pool, config: ProductionConfig): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for (const dept of config.departments) {
    await pool.execute(
      `INSERT INTO departments (name, description, is_active)
       VALUES (?, ?, TRUE)
       ON DUPLICATE KEY UPDATE description = VALUES(description)`,
      [dept.name, dept.description]
    );
    const [[row]] = await pool.execute<mysql.RowDataPacket[]>(
      'SELECT id FROM departments WHERE name = ?', [dept.name]
    );
    const id = (row as { id: number }).id;
    map.set(dept.name, id);
    logger.info(`Department: ${dept.name} (id=${id})`);
  }
  return map;
}

async function seedSkills(pool: mysql.Pool, config: ProductionConfig): Promise<void> {
  for (const skill of config.skills) {
    await pool.execute(
      `INSERT INTO skills (name, description)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE description = VALUES(description)`,
      [skill.name, skill.description]
    );
    logger.info(`Skill: ${skill.name}`);
  }
}

async function seedShiftTemplates(
  pool: mysql.Pool,
  config: ProductionConfig,
  deptMap: Map<string, number>
): Promise<void> {
  for (const tmpl of config.shiftTemplates) {
    const deptId = deptMap.get(tmpl.department);
    if (!deptId) {
      logger.warn(`Shift template "${tmpl.name}" references unknown department "${tmpl.department}" — skipping`);
      continue;
    }
    await pool.execute(
      `INSERT INTO shift_templates (name, department_id, start_time, end_time, min_staff, max_staff, is_active)
       VALUES (?, ?, ?, ?, ?, ?, TRUE)
       ON DUPLICATE KEY UPDATE start_time = VALUES(start_time), end_time = VALUES(end_time)`,
      [tmpl.name, deptId, tmpl.startTime, tmpl.endTime, tmpl.requiredStaff, tmpl.requiredStaff]
    );
    logger.info(`Shift template: ${tmpl.name} (${tmpl.startTime}–${tmpl.endTime})`);
  }
}

async function seedSystemSettings(pool: mysql.Pool, config: ProductionConfig): Promise<void> {
  const rows: ProductionSystemSetting[] = [
    // Built-in runtime mode marker — always set to production.
    { category: 'runtime', key: 'mode', value: 'production' },
    ...config.systemSettings,
  ];
  for (const s of rows) {
    await pool.execute(
      `INSERT INTO system_settings (category, \`key\`, value)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value)`,
      [s.category, s.key, s.value]
    );
    logger.info(`System setting: ${s.category}.${s.key} = ${s.value}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = loadConfig();

  const pool = mysql.createPool({
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '3306', 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: false,
  });

  try {
    logger.info('=== Production seed starting ===');
    logger.info(`Organization: ${config.organization.name}`);

    await ensureAdmin(pool, config);
    const deptMap = await seedDepartments(pool, config);
    await seedSkills(pool, config);
    await seedShiftTemplates(pool, config, deptMap);
    await seedSystemSettings(pool, config);

    logger.info('=== Production seed complete ===');
    logger.info(`Admin login: ${config.admin.email}`);
    logger.info('Remember to change the admin password after first login.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  logger.error('Production seed failed', { error: err });
  process.exit(1);
});
