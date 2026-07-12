#!/usr/bin/env ts-node
/**
 * Full workforce simulation harness — rolling rounds.
 *
 * Simulates a whole organization from scratch, one schedule period at a
 * time, instead of pre-staffing everything upfront:
 *
 *   for each period:
 *     1. employee threads file requests — time-off/loan against the
 *        upcoming (still-empty) period; shift-swap against the *previous*
 *        period's real assignments (there are none in round 1, so no
 *        shift-swap requests are possible yet — exactly like a brand new
 *        rollout);
 *     2. manager threads decide (or delegate) every pending approval, and
 *        delegate threads decide what was handed to them;
 *     3. every request's outcome is verified against the real database
 *        state;
 *     4. the period's schedule is generated for real (AutoScheduleService)
 *        — only now do assignments for this period exist, which is what
 *        the *next* round's shift-swap requests will act on;
 *     5. every resulting assignment (this period, and the previous one if
 *        it was just touched by swaps) is re-checked against the same
 *        ComplianceEngine used in production.
 *
 * Every employee is an independent "thread" (a concurrent async task — Node
 * is single-threaded, but the concurrency model is identical: independent
 * actors racing on the same database) that files 1-3 random requests. Every
 * org-unit head is a "thread" too, deciding or delegating; a delegate
 * becomes a deciding thread in turn.
 *
 * No AI anywhere in this file or the modules it calls: all "randomness" is a
 * seeded, deterministic PRNG (prng.ts) — same seed, same run, byte for byte.
 *
 * Usage:
 *   npx ts-node scripts/simulation/index.ts \
 *     [--employees=2000] [--seed=42] [--concurrency=24] [--rounds=4] [--periodDays=14]
 *
 * @author Luca Ostinelli
 */

import dotenv from 'dotenv';
import * as path from 'path';
import { createPool } from 'mysql2/promise';
import { config } from '../../src/config';
import { TimeOffService } from '../../src/services/TimeOffService';
import { EmployeeLoanService } from '../../src/services/EmployeeLoanService';
import { ShiftSwapService } from '../../src/services/ShiftSwapService';
import { AutoScheduleService } from '../../src/services/AutoScheduleService';
import { MegaLog } from './megaLog';
import { setupSimOrg } from './setup';
import { createEmptySchedulePeriod } from './schedulePeriod';
import { runEmployeeActor, SubmittedRequest, EmployeeActorContext } from './employeeActor';
import { runManagerActor, runDelegateCheck, Decision } from './managerActor';
import { verifyAllRequests } from './verify';
import { verifyComplianceForSchedule } from './complianceReport';
import { runWithConcurrency } from './concurrency';

dotenv.config();

function parseArgs(): {
  employees: number;
  seed: number;
  concurrency: number;
  rounds: number;
  periodDays: number;
} {
  const args = process.argv.slice(2);
  const get = (name: string, def: number): number => {
    const arg = args.find((a) => a.startsWith(`--${name}=`));
    return arg ? Number(arg.split('=')[1]) : def;
  };
  return {
    employees: get('employees', 2000),
    seed: get('seed', 424242),
    concurrency: get('concurrency', 24),
    rounds: get('rounds', 4),
    periodDays: get('periodDays', 14),
  };
}

const dateStr = (base: Date, offsetDays: number): string => {
  const d = new Date(base);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

/** One full decide phase: heads decide-or-delegate, delegates decide, heads mop up. Returns every decision made. */
async function runDecisionPhase(
  pool: import('mysql2/promise').Pool,
  log: MegaLog,
  seed: number,
  distinctHeadUserIds: number[],
  employeeUserIds: number[],
  concurrency: number
): Promise<Decision[]> {
  const decisions: Decision[] = [];
  for (const headUserId of distinctHeadUserIds) {
    decisions.push(...(await runManagerActor(pool, log, seed, headUserId)));
  }
  const delegateDecisionsPerEmployee = await runWithConcurrency(employeeUserIds, concurrency, (userId) =>
    runDelegateCheck(pool, log, userId)
  );
  decisions.push(...delegateDecisionsPerEmployee.flat());

  // Mop-up pass: proves the queue is actually empty rather than assuming it.
  let residual = 0;
  for (const headUserId of distinctHeadUserIds) {
    const leftover = await runManagerActor(pool, log, seed, headUserId, 0);
    residual += leftover.length;
    decisions.push(...leftover);
  }
  log.info(`Residual items decided in mop-up pass: ${residual} (0 expected).`);
  return decisions;
}

async function loadAssignmentsByUser(
  pool: import('mysql2/promise').Pool,
  scheduleId: number
): Promise<Map<number, number[]>> {
  const [rows] = await pool.query(
    `SELECT sa.id, sa.user_id
       FROM shift_assignments sa
       JOIN shifts s ON s.id = sa.shift_id
      WHERE s.schedule_id = ?`,
    [scheduleId]
  );
  const map = new Map<number, number[]>();
  for (const row of rows as Array<{ id: number; user_id: number }>) {
    const list = map.get(row.user_id) ?? [];
    list.push(row.id);
    map.set(row.user_id, list);
  }
  return map;
}

async function main(): Promise<void> {
  const { employees, seed, concurrency, rounds, periodDays } = parseArgs();
  const startedAt = new Date();
  const logPath = path.join(
    __dirname,
    'output',
    `sim-${startedAt.toISOString().replace(/[:.]/g, '-')}.log`
  );
  const log = new MegaLog(logPath);

  log.section(
    `FULL WORKFORCE SIMULATION (rolling) — seed=${seed}, employees=${employees}, concurrency=${concurrency}, rounds=${rounds}, periodDays=${periodDays}`
  );
  log.info(`Log file: ${logPath}`);
  log.info(`Started at: ${startedAt.toISOString()}`);
  log.info('No AI is used anywhere in this run: request generation, manager decisions, and');
  log.info('verification are all deterministic functions of the seed above.');
  log.info(
    'Nothing is pre-staffed: every period starts with empty shifts. Round 1 has no prior ' +
      'assignments to swap, so only time-off/loan requests are possible — shift-swap requests ' +
      'become possible from round 2 onward, once a real schedule exists to act on.'
  );

  const pool = createPool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database,
    waitForConnections: true,
    connectionLimit: Math.max(concurrency + 5, 10),
    queueLimit: 0,
    connectTimeout: config.database.connectTimeout,
  });

  try {
    await pool.execute('SELECT 1');

    // ---- SETUP: org + roster only — no schedules yet ---------------------
    const org = await setupSimOrg(pool, log, employees);
    log.info(
      `Org ready: ${org.employeeUserIds.length} employees, department id=${org.departmentId}, ` +
        `org unit id=${org.orgUnitId}, head user id=${org.headUserId}.`
    );

    const [orgUnitRows] = await pool.query(`SELECT id, manager_user_id FROM org_units`);
    const allOrgUnits = orgUnitRows as Array<{ id: number; manager_user_id: number | null }>;
    const otherOrgUnitIds = allOrgUnits.map((u) => u.id).filter((id) => id !== org.orgUnitId);
    const distinctHeadUserIds = [
      ...new Set(allOrgUnits.map((u) => u.manager_user_id).filter((id): id is number => id !== null)),
    ];
    log.info(`Distinct org-unit heads who will run as manager threads: ${distinctHeadUserIds.join(', ')}`);

    const services = {
      timeOffService: new TimeOffService(pool),
      loanService: new EmployeeLoanService(pool),
      shiftSwapService: new ShiftSwapService(pool),
    };
    const auto = new AutoScheduleService(pool);

    const allRequests: SubmittedRequest[] = [];
    const allDecisions: Decision[] = [];
    let previousScheduleId: number | null = null;
    let previousLabel = '';
    let previousAssignmentsByUser = new Map<number, number[]>();
    const today = new Date();

    for (let round = 0; round < rounds; round++) {
      const periodStart = dateStr(today, 7 + round * periodDays);
      const periodEnd = dateStr(today, 7 + round * periodDays + periodDays - 1);
      const label = `period ${round + 1}/${rounds} (${periodStart}..${periodEnd})`;

      log.section(`ROUND ${round + 1}/${rounds}: ${label}`);
      const scheduleId = await createEmptySchedulePeriod(
        pool,
        org.departmentId,
        org.headUserId,
        `[SIM] ${label}`,
        periodStart,
        periodEnd,
        org.employeeUserIds.length
      );
      log.info(
        `Created empty schedule id=${scheduleId} for ${label}. ` +
          (round === 0
            ? 'No prior assignments exist yet — shift-swap requests will be skipped this round.'
            : `Shift-swap requests this round act on the ${previousLabel} schedule (id=${previousScheduleId}).`)
      );

      // ---- PHASE 1: employees file requests ------------------------------
      log.info(`PHASE 1: ${org.employeeUserIds.length} employee threads file requests (concurrency=${concurrency})`);
      const actorCtx: EmployeeActorContext = {
        pool,
        log,
        runSeed: seed + round * 1_000_003, // distinct-but-deterministic RNG stream per round
        orgUnitId: org.orgUnitId,
        otherOrgUnitIds,
        baselineAssignmentsByUser: previousAssignmentsByUser,
        futureStartDate: periodStart,
        futureEndDate: periodEnd,
        ...services,
      };
      const perEmployeeRequests = await runWithConcurrency(org.employeeUserIds, concurrency, (userId) =>
        runEmployeeActor(actorCtx, userId)
      );
      const requestsThisRound = perEmployeeRequests.flat();
      allRequests.push(...requestsThisRound);
      log.info(`Filed ${requestsThisRound.length} requests this round (${allRequests.length} total so far).`);

      // ---- PHASE 2: manager + delegate threads decide --------------------
      log.info('PHASE 2: manager threads decide (direct or delegate), then delegate threads decide');
      const decisionsThisRound = await runDecisionPhase(
        pool,
        log,
        seed + round * 1_000_003,
        distinctHeadUserIds,
        org.employeeUserIds,
        concurrency
      );
      allDecisions.push(...decisionsThisRound);
      log.info(`Made ${decisionsThisRound.length} decisions this round (${allDecisions.length} total so far).`);

      // ---- PHASE 3: verify this round's request outcomes -----------------
      await verifyAllRequests(pool, log, requestsThisRound);

      // ---- PHASE 4: generate this period's schedule ----------------------
      log.info(`PHASE 4: generate schedule for ${label} (after this round's decisions have landed)`);
      const genResult = await auto.generate(scheduleId, org.headUserId);
      log.info(
        `Schedule generated for ${label}: ${genResult.assignmentsCreated}/${genResult.totalShifts} shifts filled ` +
          `(${genResult.coveragePercentage}%), status=${genResult.status}.`
      );
      log.count('schedule.assignments_created', genResult.assignmentsCreated);

      // ---- PHASE 5: verify constraints -----------------------------------
      log.info('PHASE 5: verify scheduling constraints (compliance engine)');
      await verifyComplianceForSchedule(pool, log, scheduleId, label);
      if (previousScheduleId !== null) {
        await verifyComplianceForSchedule(pool, log, previousScheduleId, `${previousLabel} (post-swaps this round)`);
      }

      // ---- prepare for next round -----------------------------------------
      previousScheduleId = scheduleId;
      previousLabel = label;
      previousAssignmentsByUser = await loadAssignmentsByUser(pool, scheduleId);
    }

    // ---- SUMMARY ------------------------------------------------------------
    const counters = log.getCounters();
    const failCount = counters['verify.fail'] ?? 0;
    log.summary([
      '',
      failCount === 0
        ? '  RESULT: all verifications passed — requests, decisions and every generated schedule are all consistent.'
        : `  RESULT: ${failCount} verification(s) FAILED — see [VERIFY:FAIL] lines above for details.`,
    ]);

    await log.close();
    process.exitCode = failCount === 0 ? 0 : 1;
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Simulation crashed:', err);
  process.exit(1);
});
