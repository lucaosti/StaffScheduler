/**
 * Simulation org setup.
 *
 * Reuses a named department (default "Operations", looked up by name) and
 * its matching org unit as the simulated workforce, topping it up with as
 * many synthetic employees as the run asks for (on top of whatever demo
 * employees already exist there). Passing a different `--department` name
 * exercises a different structure and a different approving manager — if
 * the named department/org unit doesn't exist yet, both are created on the
 * fly with a fresh synthetic head, rather than being restricted to whatever
 * the demo seed happens to contain.
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

const SIM_EMAIL_PREFIX = 'simemp';
const SIM_PASSWORD = 'simulation-not-a-real-login';

export interface SimOrg {
  departmentId: number;
  orgUnitId: number;
  headUserId: number;
  employeeUserIds: number[];
}

async function createSyntheticHead(pool: Pool, log: MegaLog, departmentName: string): Promise<number> {
  const managerRoleId = await (async () => {
    const [rows] = await pool.execute<RowDataPacket[]>(`SELECT id FROM roles WHERE name = 'Manager' LIMIT 1`);
    if (rows.length === 0) throw new Error('Role "Manager" not found.');
    return rows[0].id as number;
  })();

  const slug = departmentName.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const email = `simhead-${slug}@simulation.local`;
  const passwordHash = await bcrypt.hash(SIM_PASSWORD, 4);
  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT INTO users (email, password_hash, first_name, last_name, employee_id, position, is_active)
     VALUES (?, ?, 'Sim', 'Head', ?, ?, 1)
     ON DUPLICATE KEY UPDATE is_active = 1`,
    [email, passwordHash, `SIM-HEAD-${slug}`, `[SIM] ${departmentName} Head`]
  );
  let headUserId = res.insertId;
  if (!headUserId) {
    // Row already existed (ON DUPLICATE KEY UPDATE doesn't return its id).
    const [rows] = await pool.execute<RowDataPacket[]>(`SELECT id FROM users WHERE email = ? LIMIT 1`, [email]);
    headUserId = rows[0].id as number;
  }
  await pool.execute(`INSERT IGNORE INTO user_roles (user_id, role_id, scope_org_unit_id) VALUES (?, ?, NULL)`, [
    headUserId,
    managerRoleId,
  ]);
  log.info(`Created synthetic head user id=${headUserId} (${email}) for department "${departmentName}".`);
  return headUserId;
}

async function ensureOrg(
  pool: Pool,
  log: MegaLog,
  departmentName: string
): Promise<{ departmentId: number; orgUnitId: number; headUserId: number }> {
  const [deptRows] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM departments WHERE name = ? LIMIT 1`,
    [departmentName]
  );
  let departmentId: number;
  if (deptRows.length === 0) {
    const [res] = await pool.execute<ResultSetHeader>(
      `INSERT INTO departments (name, description, is_active) VALUES (?, ?, 1)`,
      [departmentName, `[SIM] ${departmentName}`]
    );
    departmentId = res.insertId;
    log.info(`Department "${departmentName}" not found — created id=${departmentId}.`);
  } else {
    departmentId = deptRows[0].id as number;
  }

  const [unitRows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, manager_user_id FROM org_units WHERE name = ? LIMIT 1`,
    [departmentName]
  );
  let orgUnitId: number;
  let headUserId: number;
  if (unitRows.length === 0) {
    headUserId = await createSyntheticHead(pool, log, departmentName);
    const [res] = await pool.execute<ResultSetHeader>(
      `INSERT INTO org_units (name, description, parent_id, manager_user_id, is_active)
       VALUES (?, ?, NULL, ?, 1)`,
      [departmentName, `[SIM] ${departmentName}`, headUserId]
    );
    orgUnitId = res.insertId;
    await pool.execute(
      `INSERT INTO user_org_units (user_id, org_unit_id, is_primary) VALUES (?, ?, 1)`,
      [headUserId, orgUnitId]
    );
    log.info(`Org unit "${departmentName}" not found — created id=${orgUnitId} with head id=${headUserId}.`);
  } else {
    orgUnitId = unitRows[0].id as number;
    headUserId = unitRows[0].manager_user_id as number;
    if (!headUserId) {
      headUserId = await createSyntheticHead(pool, log, departmentName);
      await pool.execute(`UPDATE org_units SET manager_user_id = ? WHERE id = ?`, [headUserId, orgUnitId]);
      await pool.execute(
        `INSERT IGNORE INTO user_org_units (user_id, org_unit_id, is_primary) VALUES (?, ?, 1)`,
        [headUserId, orgUnitId]
      );
      log.info(`Org unit "${departmentName}" had no manager — assigned synthetic head id=${headUserId}.`);
    }
  }
  return { departmentId, orgUnitId, headUserId };
}

async function topUpEmployees(
  pool: Pool,
  log: MegaLog,
  departmentId: number,
  orgUnitId: number,
  departmentName: string,
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
      `Roster already has ${existingIds.length} employees in "${departmentName}" (>= requested ${targetCount}) — no new users created.`
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
       VALUES (?, ?, 'Sim', ?, ?, ?, 1)`,
      [email, passwordHash, String(idx), `SIM-${idx}`, `[SIM] ${departmentName}`]
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

/** Sets up (or tops up) the simulated org: department, org unit, roster.
 *  `departmentName` selects (or creates) the structure to simulate against —
 *  passing a different name exercises a different department/org-unit pair
 *  and a different approving manager. */
export async function setupSimOrg(
  pool: Pool,
  log: MegaLog,
  employeeCount: number,
  departmentName = 'Operations'
): Promise<SimOrg> {
  log.section('SETUP: simulated organization');
  const { departmentId, orgUnitId, headUserId } = await ensureOrg(pool, log, departmentName);
  log.info(`Using department "${departmentName}" id=${departmentId}, org unit id=${orgUnitId}, head user id=${headUserId}.`);

  const employeeUserIds = await topUpEmployees(pool, log, departmentId, orgUnitId, departmentName, employeeCount);

  return { departmentId, orgUnitId, headUserId, employeeUserIds };
}
