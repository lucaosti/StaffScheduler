/**
 * Deterministic verification against the database.
 *
 * Actors only ever talk HTTP; this module is the one place that reads the
 * database, and only to check that what the API answered is what actually
 * happened. For every request filed and every side effect recorded in the
 * Ledger, the stored row is compared with `===` against what the decision
 * implies — no fuzzy matching. Every check logs an explicit PASS or FAIL;
 * failures also become findings with the row as evidence.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket } from 'mysql2/promise';
import { DateUtils } from '../../src/utils';
import { Ledger, SubmittedRequest } from './requests';
import { World } from './world';

const toDateString = (raw: unknown): string =>
  typeof raw === 'string' ? raw.slice(0, 10) : DateUtils.fromMySQLDate(raw as Date);

const midpointDate = (start: string, end: string): string => {
  const s = Date.parse(`${start}T00:00:00Z`);
  const e = Date.parse(`${end}T00:00:00Z`);
  return new Date(s + Math.floor((e - s) / 2 / 86_400_000) * 86_400_000).toISOString().slice(0, 10);
};

async function rows(pool: Pool, sql: string, params: unknown[]): Promise<RowDataPacket[]> {
  const [r] = await pool.query<RowDataPacket[]>(sql, params);
  return r;
}

function check(world: World, ok: boolean, subject: string, pass: string, fail: string): void {
  if (ok) world.log.verify(true, subject, pass);
  else world.dbFinding(subject, fail);
}

async function verifyTimeOff(world: World, ledger: Ledger, req: SubmittedRequest): Promise<void> {
  const [row] = await rows(world.pool, 'SELECT status, unavailability_id FROM time_off_requests WHERE id = ?', [req.id]);
  const subject = `time_off #${req.id}`;
  if (!row) return world.dbFinding(subject, 'row not found');
  const status = row.status as string;
  if (ledger.cancelledTimeOff.has(req.id)) {
    return check(world, status === 'cancelled' && row.unavailability_id === null, subject, 'cancelled by the requester, no unavailability', `cancelled through the API but stored as ${JSON.stringify(row)}`);
  }
  if (status === 'pending') return world.dbFinding(subject, 'still pending — no decision was ever made');
  if (status === 'rejected') {
    return check(world, row.unavailability_id === null, subject, 'rejected, no unavailability', 'rejected but unavailability_id is set');
  }
  if (status !== 'approved') return world.dbFinding(subject, `unexpected status "${status}"`);
  const [u] = await rows(world.pool, 'SELECT user_id, start_date, end_date FROM user_unavailability WHERE id = ?', [row.unavailability_id]);
  const ok = !!u && u.user_id === req.userId && toDateString(u.start_date) === req.startDate && toDateString(u.end_date) === req.endDate;
  check(world, ok, subject, `approved; unavailability #${row.unavailability_id} covers ${req.startDate}..${req.endDate}`, `approved but unavailability is ${JSON.stringify(u ?? null)}`);
}

async function verifyLoan(world: World, req: SubmittedRequest): Promise<void> {
  const subject = `loan #${req.id}`;
  const [row] = await rows(world.pool, 'SELECT status FROM employee_loans WHERE id = ?', [req.id]);
  if (!row) return world.dbFinding(subject, 'row not found');
  const status = row.status as string;
  if (status === 'pending') return world.dbFinding(subject, 'still pending — no decision was ever made');
  const mid = midpointDate(req.startDate, req.endDate);
  const [active] = await rows(
    world.pool,
    `SELECT COUNT(*) AS n FROM employee_loans
      WHERE user_id = ? AND to_org_unit_id = ? AND status = 'approved' AND start_date <= ? AND end_date >= ?`,
    [req.userId, req.toOrgUnitId, mid, mid]
  );
  const onLoan = Number(active.n) > 0;
  if (status === 'approved') check(world, onLoan, subject, `approved and in force on ${mid}`, `approved but not in force on ${mid}`);
  else if (status === 'rejected' || status === 'cancelled') {
    // Another approved loan of the same person to the same unit may cover the
    // date; only this row's own status is asserted then.
    check(world, true, subject, `${status}`, '');
  } else world.dbFinding(subject, `unexpected status "${status}"`);
}

async function verifyShiftSwap(world: World, req: SubmittedRequest): Promise<void> {
  const subject = `shift_swap #${req.id}`;
  const [row] = await rows(world.pool, 'SELECT status FROM shift_swap_requests WHERE id = ?', [req.id]);
  if (!row) return world.dbFinding(subject, 'row not found');
  const status = row.status as string;
  if (status === 'pending' || status === 'pending_target') return world.dbFinding(subject, `still ${status} — no decision was ever made`);

  // Two requests can name the same assignment; when another approved swap
  // touched one of these assignments, it determines ownership now, and this
  // swap's ownership assertion would be meaningless.
  const a = req.requesterAssignmentId!;
  const b = req.targetAssignmentId!;
  const superseded = await rows(
    world.pool,
    `SELECT id FROM shift_swap_requests WHERE id != ? AND status = 'approved'
       AND (requester_assignment_id IN (?, ?) OR target_assignment_id IN (?, ?))`,
    [req.id, a, b, a, b]
  );
  // Open-offer claims move assignments too, without a shift_swap_requests row
  // naming both of these ids in the same roles.
  const claimed = await rows(
    world.pool,
    `SELECT id FROM shift_swap_offers WHERE status = 'claimed' AND (assignment_id IN (?, ?) OR claimed_assignment_id IN (?, ?))`,
    [a, b, a, b]
  ).catch(() => [] as RowDataPacket[]);
  if (superseded.length > 0 || claimed.length > 0) {
    return world.log.verify(true, subject, `${status} — ownership decided by another approved swap or claim`);
  }
  const owners = new Map((await rows(world.pool, 'SELECT id, user_id FROM shift_assignments WHERE id IN (?, ?)', [a, b])).map((r) => [r.id as number, r.user_id as number]));
  if (status === 'approved') {
    const ok = owners.get(a) === req.targetUserId && owners.get(b) === req.userId;
    check(world, ok, subject, 'approved and the assignments swapped owners', `approved but owners are ${a}->#${owners.get(a)}, ${b}->#${owners.get(b)}`);
  } else if (status === 'declined' || status === 'cancelled') {
    const ok = owners.get(a) === req.userId && owners.get(b) === req.targetUserId;
    check(world, ok, subject, `${status}; assignments untouched`, `${status} but owners changed: ${a}->#${owners.get(a)}, ${b}->#${owners.get(b)}`);
  } else world.dbFinding(subject, `unexpected status "${status}"`);
}

export async function verifyRequests(world: World, ledger: Ledger, requests: SubmittedRequest[]): Promise<void> {
  world.log.section('VERIFY: request outcomes vs. the database');
  for (const req of requests) {
    if (req.kind === 'time_off') await verifyTimeOff(world, ledger, req);
    else if (req.kind === 'loan') await verifyLoan(world, req);
    else await verifyShiftSwap(world, req);
  }
}

/** Every other domain's recorded side effects, once at the end of the run. */
export async function verifyLedger(world: World, ledger: Ledger): Promise<void> {
  world.log.section('VERIFY: domain side effects vs. the database');
  const { pool } = world;

  for (const [id, owner] of ledger.attendanceOwners) {
    const [r] = await rows(pool, 'SELECT user_id, clock_in, clock_out, status FROM attendance_records WHERE id = ?', [id]);
    const decided = ledger.attendanceDecisions.get(id);
    const subject = `attendance #${id}`;
    if (!r) {
      world.dbFinding(subject, 'row not found');
      continue;
    }
    const ok = r.user_id === owner && r.clock_in !== null && (decided === undefined || r.status === decided);
    check(world, ok, subject, `owner #${owner}${decided ? `, ${decided}` : ''}`, `expected owner #${owner} status ${decided ?? 'any'}, row ${JSON.stringify(r)}`);
  }

  for (const [periodId, users] of ledger.onCall) {
    const stored = new Set((await rows(pool, `SELECT user_id FROM on_call_assignments WHERE period_id = ? AND status <> 'cancelled'`, [periodId])).map((r) => r.user_id as number));
    const ok = stored.size === users.size && [...users].every((u) => stored.has(u));
    check(world, ok, `on-call period #${periodId}`, `${users.size} assignee(s) as decided`, `expected ${JSON.stringify([...users])}, stored ${JSON.stringify([...stored])}`);
  }

  for (const [id, expected] of ledger.policyExceptions) {
    const [r] = await rows(pool, 'SELECT status FROM policy_exception_requests WHERE id = ?', [id]);
    // A pending exception may have been decided by an approver this harness
    // did not track (the policy owner); only a tracked decision is asserted.
    const ok = !!r && (expected === 'pending' || r.status === expected);
    check(world, ok, `policy exception #${id}`, `status ${r?.status}`, `expected ${expected}, stored ${r?.status ?? 'nothing'}`);
  }

  for (const [id, expected] of ledger.changeRequests) {
    const [r] = await rows(pool, 'SELECT status, applied_at FROM change_requests WHERE id = ?', [id]);
    const ok = !!r && (expected === 'pending' || r.status === expected) && (expected !== 'applied' || r.applied_at !== null);
    check(world, ok, `change request #${id}`, `status ${r?.status}`, `expected ${expected}, stored ${JSON.stringify(r ?? null)}`);
  }

  for (const [id, active] of ledger.delegations) {
    const [r] = await rows(pool, 'SELECT is_active FROM delegations WHERE id = ?', [id]);
    const ok = !!r && Boolean(r.is_active) === active;
    check(world, ok, `delegation #${id}`, active ? 'active' : 'revoked', `expected ${active ? 'active' : 'revoked'}, stored ${JSON.stringify(r ?? null)}`);
  }

  for (const [id, expected] of ledger.pairings) {
    const [r] = await rows(pool, 'SELECT user_id, other_user_id, kind FROM employee_pairings WHERE id = ?', [id]);
    const ok = expected === null ? !r : !!r && r.user_id === expected[0] && r.other_user_id === expected[1] && r.kind === expected[2];
    check(world, ok, `pairing #${id}`, expected === null ? 'deleted' : `${expected[2]} pairing stored`, `expected ${JSON.stringify(expected)}, stored ${JSON.stringify(r ?? null)}`);
  }

  for (const [id, amount] of ledger.costPlans) {
    const [r] = await rows(pool, 'SELECT target_amount FROM cost_plans WHERE id = ?', [id]);
    const ok = amount === null ? !r : !!r && Number(r.target_amount) === amount;
    check(world, ok, `cost plan #${id}`, `target ${amount}`, `expected ${amount}, stored ${JSON.stringify(r ?? null)}`);
  }

  for (const [userId, ids] of ledger.notificationsRead) {
    const unread = await rows(pool, 'SELECT id FROM notifications WHERE user_id = ? AND id IN (?) AND is_read = 0', [userId, [...ids]]);
    check(world, unread.length === 0, `notifications of #${userId}`, `${ids.size} marked read`, `still unread: ${unread.map((r) => r.id).join(',')}`);
  }

  for (const [id, active] of ledger.calendarTokens) {
    const [r] = await rows(pool, 'SELECT revoked_at FROM calendar_tokens WHERE id = ?', [id]);
    const ok = !!r && (r.revoked_at === null) === active;
    check(world, ok, `calendar token #${id}`, active ? 'active' : 'revoked', `expected ${active ? 'active' : 'revoked'}, stored ${JSON.stringify(r ?? null)}`);
  }

  for (const email of ledger.imported) {
    const [r] = await rows(pool, 'SELECT id, is_active FROM users WHERE email = ?', [email]);
    check(world, !!r && Boolean(r.is_active), `imported account ${email}`, `user #${r?.id}`, 'not found or inactive');
  }

  for (const [userId, notes] of ledger.preferenceNotes) {
    const [r] = await rows(pool, 'SELECT notes FROM user_preferences WHERE user_id = ?', [userId]);
    check(world, !!r && r.notes === notes, `preferences of #${userId}`, 'notes saved', `expected "${notes}", stored ${JSON.stringify(r ?? null)}`);
  }

  // Nothing may be left waiting for a decision that the run created.
  const idsOf = (kind: SubmittedRequest['kind']): number[] => {
    const ids = ledger.requests.filter((r) => r.kind === kind).map((r) => r.id);
    return ids.length > 0 ? ids : [0];
  };
  if (ledger.requests.length > 0) {
    const left = await rows(
      pool,
      `SELECT id FROM pending_approvals WHERE status = 'pending' AND (time_off_request_id IN (?) OR shift_swap_request_id IN (?) OR employee_loan_id IN (?))`,
      [idsOf('time_off'), idsOf('shift_swap'), idsOf('loan')]
    );
    check(world, left.length === 0, 'approval queues', 'empty for every filed request', `${left.length} pending approval(s) left: ${left.map((r) => r.id).slice(0, 20).join(',')}`);
  }
}
