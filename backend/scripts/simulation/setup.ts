/**
 * Simulation org setup.
 *
 * Builds the simulated organization from a list of department specs
 * (`name:count` pairs): each department gets (or reuses, when the demo seed
 * already contains it) its own department row, org unit, and approving head
 * — created on the fly with a fresh synthetic manager when missing — plus a
 * roster topped up with synthetic employees until it reaches the requested
 * size. Different specs across runs exercise different structures and
 * different approving managers.
 *
 * A user already present in more than one department (e.g. the demo admin,
 * who belongs to every demo department) is claimed by the first department
 * that finds them and excluded from later rosters — otherwise the same user
 * id would run as two concurrent employee actors sharing one deterministic
 * RNG stream, filing duplicate requests.
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
// Exported so HTTP actors (httpAuth.ts) can log in as any synthetic user
// this module creates — every synthetic user is hashed with this same
// plaintext.
export const SIM_PASSWORD = 'simulation-not-a-real-login';

export interface DepartmentSpec {
  name: string;
  count: number;
}

export interface SimOrg {
  name: string;
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
  targetCount: number,
  claimedUserIds: Set<number>
): Promise<number[]> {
  const employeeRoleId = await (async () => {
    const [rows] = await pool.execute<RowDataPacket[]>(`SELECT id FROM roles WHERE name = 'Employee' LIMIT 1`);
    if (rows.length === 0) throw new Error('Role "Employee" not found.');
    return rows[0].id as number;
  })();

  // Roster members must belong to the structure they act in: without a
  // primary org-unit membership, no approver can be resolved for their
  // requests (the services now reject such requests loudly at creation).
  // Some demo-seeded department members have no membership at all — adopt
  // them into this department's unit, exactly like HR fixing an incomplete
  // record before the person starts filing requests.
  const [adoptRes] = await pool.execute<ResultSetHeader>(
    `INSERT INTO user_org_units (user_id, org_unit_id, is_primary)
     SELECT u.id, ?, 1 FROM users u
       JOIN user_departments ud ON ud.user_id = u.id
      WHERE ud.department_id = ? AND u.is_active = 1
        AND NOT EXISTS (SELECT 1 FROM user_org_units x WHERE x.user_id = u.id AND x.is_primary = 1)`,
    [orgUnitId, departmentId]
  );
  if (adoptRes.affectedRows > 0) {
    log.info(
      `Adopted ${adoptRes.affectedRows} pre-existing "${departmentName}" member(s) without a primary org unit into unit id=${orgUnitId}.`
    );
  }

  const [existingRows] = await pool.execute<RowDataPacket[]>(
    `SELECT u.id FROM users u
       JOIN user_departments ud ON ud.user_id = u.id
      WHERE ud.department_id = ? AND u.is_active = 1`,
    [departmentId]
  );
  // A user already claimed by an earlier department keeps acting there only.
  const existingIds = existingRows.map((r) => r.id as number).filter((id) => !claimedUserIds.has(id));

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

/** Sets up (or tops up) the whole simulated org: one department, org unit,
 *  approving head, and roster per spec. Rosters are disjoint — a user found
 *  in several departments acts only in the first one that claimed them. */
export async function setupSimOrgs(pool: Pool, log: MegaLog, specs: DepartmentSpec[]): Promise<SimOrg[]> {
  log.section('SETUP: simulated organization');
  log.info(`Structure: ${specs.map((s) => `${s.name}=${s.count}`).join(', ')} (${specs.length} departments).`);

  const claimedUserIds = new Set<number>();
  const orgs: SimOrg[] = [];
  for (const spec of specs) {
    const { departmentId, orgUnitId, headUserId } = await ensureOrg(pool, log, spec.name);
    log.info(`Using department "${spec.name}" id=${departmentId}, org unit id=${orgUnitId}, head user id=${headUserId}.`);
    const employeeUserIds = await topUpEmployees(
      pool,
      log,
      departmentId,
      orgUnitId,
      spec.name,
      spec.count,
      claimedUserIds
    );
    for (const id of employeeUserIds) claimedUserIds.add(id);
    orgs.push({ name: spec.name, departmentId, orgUnitId, headUserId, employeeUserIds });
  }
  return orgs;
}
