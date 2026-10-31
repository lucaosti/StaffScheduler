#!/usr/bin/env ts-node
/**
 * Post-run invariants for the load and chaos harness (#958), checked directly
 * in MySQL.
 *
 *   ts-node benchmarks/load/check/invariants.ts snapshot <out.json>
 *   ts-node benchmarks/load/check/invariants.ts verify <baseline.json> <records.jsonl> <out-dir>
 *
 * WHY A BASELINE. The demo seed is hand-written data, not the output of the
 * write paths under test, and it is not guaranteed to satisfy every rule (it
 * seeds pending time-off requests with no approval row, for instance). An
 * absolute check would report the seed's quirks as load defects. So the same
 * queries run once after seeding and once after the run, and only what the
 * run ADDED is a finding. Each finding keeps its rows, which is the evidence
 * the report quotes.
 *
 * WHAT IS CHECKED, AND AGAINST WHICH DEFINITION
 *   double-booking   two live assignments of one person overlapping in
 *                    absolute time — the exact predicate AssignmentValidator
 *                    uses (SHIFT_ABS_END_SQL), so "double-booked" means what
 *                    the API means by it, overnight shifts included.
 *   validator        every non-archived schedule's live assignments run
 *                    through findConstraintViolations, the shared
 *                    hard-constraint definition both engines are held to,
 *                    on the problem AutoScheduleInputLoader builds for it.
 *                    Reusing the loader rather than re-deriving the problem
 *                    is the point: a second derivation could disagree with
 *                    the engines and turn the check into a third opinion.
 *   decided-twice    an entity with more than one final decision in the
 *                    audit trail, a time-off request materialized into more
 *                    than one unavailability row, or a workflow step decided
 *                    more than once.
 *   decision-effect  a decided approval whose entity is still pending (the
 *                    decision committed, its effect did not) or whose entity
 *                    carries the opposite outcome.
 *   lost-write       from the run's ledger: a 2xx create whose row is gone,
 *                    or a 2xx decision the database does not hold.
 *
 * @author Luca Ostinelli
 */

import * as fs from 'fs';
import * as path from 'path';
import { createPool, Pool, RowDataPacket } from 'mysql2/promise';
import { AutoScheduleInputLoader } from '../../../src/services/AutoScheduleInputLoader';
import { buildOptimizationProblem } from '../../../src/services/autoScheduleProblem';
import { findConstraintViolations } from '../../../src/optimization/constraintValidator';
import { SHIFT_ABS_END_SQL } from '../../../src/utils/sql';

type Row = Record<string, unknown>;

/** One named check: the rows it found, each with a stable identity. */
interface Finding {
  key: string;
  row: Row;
}
type Snapshot = Record<string, Finding[]>;

const LIVE = `('pending', 'confirmed')`;
// SHIFT_ABS_END_SQL is written against the alias `s`; the pairwise query
// needs it for two shifts, so the alias is substituted rather than the
// expression copied — a copy is how the overlap rule drifted before.
const absEnd = (alias: string): string => SHIFT_ABS_END_SQL.replace(/\bs\./g, `${alias}.`);

async function rows(pool: Pool, sql: string, params: unknown[] = []): Promise<Row[]> {
  const [result] = await pool.query<RowDataPacket[]>(sql, params);
  return result as Row[];
}

async function doubleBookings(pool: Pool): Promise<Finding[]> {
  const found = await rows(
    pool,
    `SELECT a.user_id, a.id AS assignment_a, b.id AS assignment_b,
            sa.id AS shift_a, sb.id AS shift_b,
            sa.schedule_id AS schedule_a, sb.schedule_id AS schedule_b,
            CONCAT(DATE_FORMAT(sa.date, '%Y-%m-%d'), ' ', sa.start_time, '-', sa.end_time) AS window_a,
            CONCAT(DATE_FORMAT(sb.date, '%Y-%m-%d'), ' ', sb.start_time, '-', sb.end_time) AS window_b,
            a.created_at AS created_a, b.created_at AS created_b
       FROM shift_assignments a
       JOIN shifts sa ON sa.id = a.shift_id
       JOIN shift_assignments b ON b.user_id = a.user_id AND b.id > a.id
       JOIN shifts sb ON sb.id = b.shift_id
      WHERE a.status IN ${LIVE} AND b.status IN ${LIVE}
        AND sb.date BETWEEN DATE_SUB(sa.date, INTERVAL 1 DAY) AND DATE_ADD(sa.date, INTERVAL 1 DAY)
        AND TIMESTAMP(sa.date, sa.start_time) < ${absEnd('sb')}
        AND TIMESTAMP(sb.date, sb.start_time) < ${absEnd('sa')}
      ORDER BY a.user_id, a.id, b.id`
  );
  return found.map((row) => ({ key: `${row.assignment_a}-${row.assignment_b}`, row }));
}

async function validatorViolations(pool: Pool): Promise<Finding[]> {
  const loader = new AutoScheduleInputLoader(pool);
  const schedules = await rows(pool, `SELECT id, status FROM schedules WHERE status <> 'archived' ORDER BY id`);
  const findings: Finding[] = [];
  for (const schedule of schedules) {
    const inputs = await loader.load(Number(schedule.id));
    if (!inputs) continue;
    const problem = buildOptimizationProblem(inputs);
    const live = await rows(
      pool,
      `SELECT sa.id, sa.user_id, sa.shift_id
         FROM shift_assignments sa JOIN shifts s ON s.id = sa.shift_id
        WHERE s.schedule_id = ? AND sa.status IN ${LIVE}`,
      [Number(schedule.id)]
    );
    const assignmentIdOf = new Map(live.map((r) => [`${r.user_id}:${r.shift_id}`, Number(r.id)]));
    const violations = findConstraintViolations(
      problem,
      live.map((r) => ({ employeeId: String(r.user_id), shiftId: String(r.shift_id) }))
    );
    for (const v of violations) {
      const shiftIds = [...v.shiftIds].sort();
      findings.push({
        key: `${schedule.id}:${v.rule}:${v.employeeId}:${shiftIds.join(',')}`,
        row: {
          scheduleId: schedule.id,
          scheduleStatus: schedule.status,
          rule: v.rule,
          employeeId: v.employeeId,
          shiftIds,
          assignmentIds: shiftIds.map((s) => assignmentIdOf.get(`${v.employeeId}:${s}`) ?? null),
          detail: v.detail,
        },
      });
    }
  }
  return findings;
}

async function decidedTwice(pool: Pool): Promise<Finding[]> {
  const audit = await rows(
    pool,
    `SELECT entity_type, entity_id, COUNT(*) AS decisions,
            GROUP_CONCAT(CONCAT(action, '@', created_at, ' by ', user_id) ORDER BY id SEPARATOR ' | ') AS trail
       FROM audit_logs
      WHERE action IN ('time_off.approve', 'time_off.reject', 'shift_swap.approve', 'shift_swap.decline')
      GROUP BY entity_type, entity_id
     HAVING COUNT(*) > 1`
  );
  const unavailability = await rows(
    pool,
    `SELECT SUBSTRING_INDEX(SUBSTRING_INDEX(reason, ']', 1), ':', -1) AS time_off_request_id,
            COUNT(*) AS unavailability_rows, GROUP_CONCAT(id) AS ids
       FROM user_unavailability
      WHERE reason LIKE '[time-off-request:%'
      GROUP BY time_off_request_id
     HAVING COUNT(*) > 1`
  );
  const steps = await rows(
    pool,
    `SELECT time_off_request_id, shift_swap_request_id, change_request_id, employee_loan_id, step_order,
            COUNT(*) AS decided_rows, GROUP_CONCAT(CONCAT(id, ':', status) ORDER BY id) AS approvals
       FROM pending_approvals
      WHERE status IN ('approved', 'rejected')
      GROUP BY time_off_request_id, shift_swap_request_id, change_request_id, employee_loan_id, step_order
     HAVING COUNT(*) > 1`
  );
  return [
    ...audit.map((row) => ({ key: `audit:${row.entity_type}:${row.entity_id}:${row.decisions}`, row })),
    ...unavailability.map((row) => ({ key: `unavailability:${row.time_off_request_id}:${row.unavailability_rows}`, row })),
    ...steps.map((row) => ({
      key: `step:${row.time_off_request_id}:${row.shift_swap_request_id}:${row.change_request_id}:${row.employee_loan_id}:${row.step_order}:${row.decided_rows}`,
      row,
    })),
  ];
}

async function decisionEffect(pool: Pool): Promise<Finding[]> {
  // A step decided while its entity is still undecided is legitimate only if
  // a later step is pending; otherwise the decision committed without its
  // effect (decidePendingApproval commits on its own connection).
  const found = await rows(
    pool,
    `SELECT 'time_off_request' AS entity_type, t.id AS entity_id, t.status AS entity_status,
            pa.id AS pending_approval_id, pa.status AS decision, pa.decided_at
       FROM pending_approvals pa JOIN time_off_requests t ON t.id = pa.time_off_request_id
      WHERE pa.status IN ('approved', 'rejected')
        AND (   (t.status = 'pending' AND NOT EXISTS (
                   SELECT 1 FROM pending_approvals p2 WHERE p2.time_off_request_id = t.id AND p2.status = 'pending'))
             OR (pa.status = 'approved' AND t.status = 'rejected')
             OR (pa.status = 'rejected' AND t.status = 'approved'))
     UNION ALL
     SELECT 'shift_swap_request', w.id, w.status, pa.id, pa.status, pa.decided_at
       FROM pending_approvals pa JOIN shift_swap_requests w ON w.id = pa.shift_swap_request_id
      WHERE pa.status IN ('approved', 'rejected')
        AND (   (w.status IN ('pending', 'pending_target') AND NOT EXISTS (
                   SELECT 1 FROM pending_approvals p2 WHERE p2.shift_swap_request_id = w.id AND p2.status = 'pending'))
             OR (pa.status = 'approved' AND w.status = 'declined')
             OR (pa.status = 'rejected' AND w.status = 'approved'))`
  );
  return found.map((row) => ({ key: `${row.entity_type}:${row.entity_id}:${row.pending_approval_id}`, row }));
}

async function snapshot(pool: Pool): Promise<Snapshot> {
  return {
    'double-booking': await doubleBookings(pool),
    validator: await validatorViolations(pool),
    'decided-twice': await decidedTwice(pool),
    'decision-effect': await decisionEffect(pool),
  };
}

interface LedgerWrite {
  k: 'write';
  entity: 'shift_assignment' | 'time_off_request' | 'shift_swap_request';
  id: number;
  t: number;
}
interface LedgerDecision {
  k: 'decision';
  pendingApprovalId: number;
  decision: 'approved' | 'rejected';
  outcome: string;
  status: number;
  t: number;
  userId: number;
}

const TABLE: Record<LedgerWrite['entity'], string> = {
  shift_assignment: 'shift_assignments',
  time_off_request: 'time_off_requests',
  shift_swap_request: 'shift_swap_requests',
};

function readLedger(file: string): { writes: LedgerWrite[]; decisions: LedgerDecision[] } {
  const writes: LedgerWrite[] = [];
  const decisions: LedgerDecision[] = [];
  if (!fs.existsSync(file)) return { writes, decisions };
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    const rec = JSON.parse(line);
    if (rec.k === 'write') writes.push(rec);
    else if (rec.k === 'decision') decisions.push(rec);
  }
  return { writes, decisions };
}

async function lostWrites(pool: Pool, ledgerFile: string): Promise<Record<string, Finding[]>> {
  const { writes, decisions } = readLedger(ledgerFile);
  const lost: Finding[] = [];
  for (const entity of Object.keys(TABLE) as LedgerWrite['entity'][]) {
    const ids = writes.filter((w) => w.entity === entity).map((w) => w.id);
    if (ids.length === 0) continue;
    const present = new Set(
      (await rows(pool, `SELECT id FROM ${TABLE[entity]} WHERE id IN (?)`, [ids])).map((r) => Number(r.id))
    );
    for (const w of writes.filter((x) => x.entity === entity && !present.has(x.id))) {
      lost.push({ key: `${entity}:${w.id}`, row: { ...w, problem: 'acknowledged with 2xx, row absent' } });
    }
  }

  const ok = decisions.filter((d) => d.outcome === 'ok');
  const byApproval = new Map<number, LedgerDecision[]>();
  for (const d of ok) byApproval.set(d.pendingApprovalId, [...(byApproval.get(d.pendingApprovalId) ?? []), d]);
  const twice: Finding[] = [];
  for (const [id, list] of byApproval) {
    if (list.length > 1) twice.push({ key: `ledger:${id}`, row: { pendingApprovalId: id, acknowledged: list } });
  }
  if (byApproval.size > 0) {
    const stored = new Map(
      (
        await rows(pool, `SELECT id, status, decided_by_user_id, decided_at FROM pending_approvals WHERE id IN (?)`, [
          [...byApproval.keys()],
        ])
      ).map((r) => [Number(r.id), r])
    );
    for (const [id, list] of byApproval) {
      const row = stored.get(id);
      // With two acknowledgements the stored row can match only one of them;
      // that case is already reported as decided-twice above.
      if (list.length === 1 && (!row || row.status !== list[0].decision)) {
        lost.push({ key: `decision:${id}`, row: { acknowledged: list[0], stored: row ?? null } });
      }
    }
  }
  return {
    'lost-write': lost,
    'decided-twice (acknowledged)': twice,
    _ledger: [{ key: 'counts', row: { writes: writes.length, decisions: decisions.length, okDecisions: ok.length } }],
  };
}

async function main(): Promise<number> {
  const [mode, ...args] = process.argv.slice(2);
  const pool = createPool({
    host: process.env.DB_HOST || 'db',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'staff_scheduler',
    connectionLimit: 4,
  });
  try {
    if (mode === 'snapshot' && args.length === 1) {
      fs.writeFileSync(args[0], JSON.stringify(await snapshot(pool), null, 1));
      return 0;
    }
    if (mode === 'verify' && args.length === 3) {
      const [baselineFile, ledgerFile, outDir] = args;
      const baseline: Snapshot = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
      const after = await snapshot(pool);
      const ledger = await lostWrites(pool, ledgerFile);
      const csv = ['check,baseline,after,new,verdict'];
      const evidence: Record<string, Row[]> = {};
      let failed = false;
      for (const [check, findings] of Object.entries(after)) {
        const before = new Set((baseline[check] ?? []).map((f) => f.key));
        const added = findings.filter((f) => !before.has(f.key));
        csv.push(`${check},${before.size},${findings.length},${added.length},${added.length === 0 ? 'PASS' : 'FAIL'}`);
        evidence[check] = added.map((f) => f.row);
        failed ||= added.length > 0;
      }
      for (const [check, findings] of Object.entries(ledger)) {
        if (check.startsWith('_')) {
          evidence[check] = findings.map((f) => f.row);
          continue;
        }
        csv.push(`${check},0,${findings.length},${findings.length},${findings.length === 0 ? 'PASS' : 'FAIL'}`);
        evidence[check] = findings.map((f) => f.row);
        failed ||= findings.length > 0;
      }
      fs.writeFileSync(path.join(outDir, 'invariants.csv'), csv.join('\n') + '\n');
      fs.writeFileSync(path.join(outDir, 'invariants.json'), JSON.stringify(evidence, null, 1));
      process.stdout.write(csv.join('\n') + '\n');
      return failed ? 3 : 0;
    }
    process.stderr.write('usage: invariants.ts snapshot <out.json> | verify <baseline.json> <records.jsonl> <out-dir>\n');
    return 2;
  } finally {
    await pool.end();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  }
);
