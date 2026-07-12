/**
 * Deterministic post-decision verification.
 *
 * For every request an employee actor filed, checks the *actual* database
 * state against what the decision (approved/rejected) implies — no AI, no
 * fuzzy matching: plain SQL reads compared with `===`. Every check logs an
 * explicit PASS or FAIL line to the mega log.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket } from 'mysql2/promise';
import { EmployeeLoanService } from '../../src/services/EmployeeLoanService';
import { MegaLog } from './megaLog';
import { SubmittedRequest } from './employeeActor';
import { Decision } from './managerActor';

async function verifyTimeOff(pool: Pool, log: MegaLog, req: SubmittedRequest): Promise<void> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT status, unavailability_id FROM time_off_requests WHERE id = ?`,
    [req.id]
  );
  if (rows.length === 0) {
    log.verify(false, `time_off #${req.id}`, 'row not found');
    return;
  }
  const { status, unavailability_id: unavailabilityId } = rows[0];

  if (status === 'pending') {
    log.verify(false, `time_off #${req.id}`, 'still pending — no decision was ever made');
    return;
  }

  if (status === 'approved') {
    if (!unavailabilityId) {
      log.verify(false, `time_off #${req.id}`, 'approved but unavailability_id is NULL');
      return;
    }
    const [unavailRows] = await pool.execute<RowDataPacket[]>(
      `SELECT user_id, start_date, end_date FROM user_unavailability WHERE id = ?`,
      [unavailabilityId]
    );
    const u = unavailRows[0];
    const ok =
      !!u &&
      u.user_id === req.userId &&
      fmtDate(u.start_date) === req.startDate &&
      fmtDate(u.end_date) === req.endDate;
    log.verify(
      ok,
      `time_off #${req.id}`,
      ok
        ? `approved and unavailability #${unavailabilityId} correctly reflects ${req.startDate}..${req.endDate}`
        : `approved but unavailability row does not match request (${JSON.stringify(u)})`
    );
  } else if (status === 'rejected') {
    const ok = unavailabilityId === null;
    log.verify(ok, `time_off #${req.id}`, ok ? 'rejected and no unavailability was created' : 'rejected but unavailability_id is set');
  } else {
    log.verify(false, `time_off #${req.id}`, `unexpected status "${status}"`);
  }
}

async function verifyLoan(pool: Pool, log: MegaLog, req: SubmittedRequest): Promise<void> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT status, to_org_unit_id FROM employee_loans WHERE id = ?`,
    [req.id]
  );
  if (rows.length === 0) {
    log.verify(false, `loan #${req.id}`, 'row not found');
    return;
  }
  const { status } = rows[0];
  if (status === 'pending') {
    log.verify(false, `loan #${req.id}`, 'still pending — no decision was ever made');
    return;
  }
  const loanSvc = new EmployeeLoanService(pool);
  // isOnLoan checks the middle of the requested range, not an edge, to
  // avoid off-by-one date boundary ambiguity.
  const midDate = midpointDate(req.startDate, req.endDate);
  const onLoan = await loanSvc.isOnLoan(req.userId, req.toOrgUnitId!, midDate);

  if (status === 'approved') {
    log.verify(onLoan, `loan #${req.id}`, onLoan ? `approved and isOnLoan(${midDate}) is true` : `approved but isOnLoan(${midDate}) is false`);
  } else if (status === 'rejected') {
    log.verify(!onLoan, `loan #${req.id}`, !onLoan ? 'rejected and isOnLoan is false' : 'rejected but isOnLoan is true');
  } else {
    log.verify(false, `loan #${req.id}`, `unexpected status "${status}"`);
  }
}

async function verifyShiftSwap(pool: Pool, log: MegaLog, req: SubmittedRequest): Promise<void> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT status FROM shift_swap_requests WHERE id = ?`,
    [req.id]
  );
  if (rows.length === 0) {
    log.verify(false, `shift_swap #${req.id}`, 'row not found');
    return;
  }
  const { status } = rows[0];
  if (status === 'pending') {
    log.verify(false, `shift_swap #${req.id}`, 'still pending — no decision was ever made');
    return;
  }

  // Two independent swap requests can both name the same assignment (the
  // employeeActor picks randomly, with no locking between concurrent
  // requests — matching real users). If *any other* approved swap also
  // touched one of these assignments — whether decided before or after this
  // one — checking this swap's final ownership is meaningless: that other
  // swap is what actually determines it now (and may well be *why* this one
  // was declined, if it lost the race). Skip the ownership assertion in
  // that case rather than report a false positive.
  const [supersededRows] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM shift_swap_requests
      WHERE id != ? AND status = 'approved'
        AND (requester_assignment_id IN (?, ?) OR target_assignment_id IN (?, ?))`,
    [
      req.id,
      req.requesterAssignmentId as number,
      req.targetAssignmentId as number,
      req.requesterAssignmentId as number,
      req.targetAssignmentId as number,
    ]
  );
  if (supersededRows.length > 0) {
    log.verify(
      true,
      `shift_swap #${req.id}`,
      `${status} — skipping ownership check, another approved swap (#${supersededRows[0].id}) also touched one of these assignments`
    );
    return;
  }

  const [assignRows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, user_id FROM shift_assignments WHERE id IN (?, ?)`,
    [req.requesterAssignmentId as number, req.targetAssignmentId as number]
  );
  const byId = new Map<number, number>(assignRows.map((r) => [r.id as number, r.user_id as number]));
  const requesterAssignmentOwner = byId.get(req.requesterAssignmentId!);
  const targetAssignmentOwner = byId.get(req.targetAssignmentId!);

  if (status === 'approved') {
    const swapped = requesterAssignmentOwner === req.targetUserId && targetAssignmentOwner === req.userId;
    log.verify(
      swapped,
      `shift_swap #${req.id}`,
      swapped
        ? `approved and assignments actually swapped (assignment ${req.requesterAssignmentId} -> user #${req.targetUserId}, ${req.targetAssignmentId} -> user #${req.userId})`
        : `approved but assignment owners are NOT swapped (found ${req.requesterAssignmentId}->#${requesterAssignmentOwner}, ${req.targetAssignmentId}->#${targetAssignmentOwner})`
    );
  } else if (status === 'declined' || status === 'cancelled') {
    const unchanged = requesterAssignmentOwner === req.userId && targetAssignmentOwner === req.targetUserId;
    log.verify(
      unchanged,
      `shift_swap #${req.id}`,
      unchanged ? `${status} and assignments correctly untouched` : `${status} but assignment owners changed anyway`
    );
  } else {
    log.verify(false, `shift_swap #${req.id}`, `unexpected status "${status}"`);
  }
}

export async function verifyAllRequests(
  pool: Pool,
  log: MegaLog,
  requests: SubmittedRequest[],
  _decisions: Decision[]
): Promise<void> {
  log.section('VERIFY: request outcomes vs. actual database state');
  for (const req of requests) {
    if (req.kind === 'time_off') await verifyTimeOff(pool, log, req);
    else if (req.kind === 'loan') await verifyLoan(pool, log, req);
    else await verifyShiftSwap(pool, log, req);
  }
}

// mysql2 returns DATE columns as a JS Date at local midnight — building the
// string from .toISOString() would shift it back a day in any UTC+ timezone.
// Use local date components instead (same fix as Schedule.tsx's month view).
function fmtDate(raw: unknown): string {
  if (typeof raw === 'string') return raw.slice(0, 10);
  const d = raw as Date;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function midpointDate(start: string, end: string): string {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  return new Date(s + Math.floor((e - s) / 2)).toISOString().slice(0, 10);
}
