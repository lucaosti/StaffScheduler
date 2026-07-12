/**
 * Simulation org setup.
 *
 * Reuses the demo seed's "Operations" department (looked up by name) and its
 * matching org unit as the simulated workforce, topping it up with as many
 * synthetic employees as the run asks for (on top of whatever demo employees
 * already exist there).
 *
 * Schedule periods are NOT created here — the whole point of the rolling
 * simulation (see index.ts) is that nothing is pre-staffed. Every period's
 * shifts start empty and only get filled by the simulation's own
 * request-then-generate rounds, exactly like a real rollout would.
 *
 * @author Luca Ostinelli
 */

import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import bcrypt from 'bcrypt';
import { MegaLog } from './megaLog';

const DEPARTMENT_NAME = 'Operations';
const ORG_UNIT_NAME = 'Operations';
const SIM_EMAIL_PREFIX = 'simemp';
const SIM_PASSWORD = 'simulation-not-a-real-login';

export interface SimOrg {
  departmentId: number;
  orgUnitId: number;
  headUserId: number;
  employeeUserIds: number[];
}

async function ensureOrg(pool: Pool): Promise<{ departmentId: number; orgUnitId: number; headUserId: number }> {
  const [deptRows] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM departments WHERE name = ? LIMIT 1`,
    [DEPARTMENT_NAME]
  );
  if (deptRows.length === 0) {
    throw new Error(
      `Department "${DEPARTMENT_NAME}" not found — run "npm run db:seed:demo" first.`
    );
  }
  const departmentId = deptRows[0].id as number;

  const [unitRows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, manager_user_id FROM org_units WHERE name = ? LIMIT 1`,
    [ORG_UNIT_NAME]
  );
  if (unitRows.length === 0) {
    throw new Error(`Org unit "${ORG_UNIT_NAME}" not found — run "npm run db:seed:demo" first.`);
  }
  const orgUnitId = unitRows[0].id as number;
  const headUserId = unitRows[0].manager_user_id as number;
  if (!headUserId) {
    throw new Error(`Org unit "${ORG_UNIT_NAME}" has no manager_user_id set.`);
  }
  return { departmentId, orgUnitId, headUserId };
}

async function topUpEmployees(
  pool: Pool,
  log: MegaLog,
  departmentId: number,
  orgUnitId: number,
  targetCount: number
): Promise<number[]> {
  const employeeRoleId = await (async () => {
    const [rows] = await pool.execute<RowDataPacket[]>(`SELECT id FROM roles WHERE name = 'Employee' LIMIT 1`);
    if (rows.length === 0) throw new Error('Role "Employee" not found.');
    return rows[0].id as number;
  })();

  const [existingRows] = await pool.execute<RowDataPacket[]>(
    `SELECT u.id FROM users u
       JOIN user_departments ud ON ud.user_id = u.id
      WHERE ud.department_id = ? AND u.is_active = 1`,
    [departmentId]
  );
  const existingIds = existingRows.map((r) => r.id as number);

  const missing = targetCount - existingIds.length;
  if (missing <= 0) {
    log.info(
      `Roster already has ${existingIds.length} employees in "${DEPARTMENT_NAME}" (>= requested ${targetCount}) — no new users created.`
    );
    return existingIds;
  }

  const passwordHash = await bcrypt.hash(SIM_PASSWORD, 4);
  const [maxRows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM users WHERE email LIKE ?`,
    [`${SIM_EMAIL_PREFIX}%@simulation.local`]
  );
  const startIndex = (maxRows[0].n as number) + 1;

  const newIds: number[] = [];
  for (let i = 0; i < missing; i++) {
    const idx = startIndex + i;
    const email = `${SIM_EMAIL_PREFIX}${String(idx).padStart(5, '0')}@simulation.local`;
    const [userRes] = await pool.execute<ResultSetHeader>(
      `INSERT INTO users (email, password_hash, first_name, last_name, employee_id, position, is_active)
       VALUES (?, ?, 'Sim', ?, ?, '[SIM] Operations', 1)`,
      [email, passwordHash, String(idx), `SIM-${idx}`]
    );
    const userId = userRes.insertId;
    await pool.execute(`INSERT IGNORE INTO user_roles (user_id, role_id, scope_org_unit_id) VALUES (?, ?, NULL)`, [
      userId,
      employeeRoleId,
    ]);
    await pool.execute(`INSERT INTO user_departments (user_id, department_id) VALUES (?, ?)`, [userId, departmentId]);
    await pool.execute(
      `INSERT INTO user_org_units (user_id, org_unit_id, is_primary) VALUES (?, ?, 1)`,
      [userId, orgUnitId]
    );
    newIds.push(userId);
  }
  log.info(`Created ${newIds.length} new synthetic employees (total roster: ${existingIds.length + newIds.length}).`);
  return [...existingIds, ...newIds];
}

/** Sets up (or tops up) the simulated org: department, org unit, roster. */
export async function setupSimOrg(pool: Pool, log: MegaLog, employeeCount: number): Promise<SimOrg> {
  log.section('SETUP: simulated organization');
  const { departmentId, orgUnitId, headUserId } = await ensureOrg(pool);
  log.info(`Using department id=${departmentId}, org unit id=${orgUnitId}, head user id=${headUserId}.`);

  const employeeUserIds = await topUpEmployees(pool, log, departmentId, orgUnitId, employeeCount);

  return { departmentId, orgUnitId, headUserId, employeeUserIds };
}
