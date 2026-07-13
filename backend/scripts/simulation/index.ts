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
 * actors racing on the same database) that files a configurable number of
 * random requests per round. Every org-unit head is a "thread" too, waking
 * on every round to decide or delegate every pending approval; a delegate
 * becomes a deciding thread in turn.
 *
 * No AI anywhere in this file or the modules it calls: all "randomness" is a
 * seeded, deterministic PRNG (prng.ts) — same seed, same run, byte for byte.
 *
 * Usage:
 *   npx ts-node scripts/simulation/index.ts \
 *     [--employees=2000] [--seed=42] [--concurrency=24] [--rounds=4] [--periodDays=14] \
 *     [--department=Operations | --departments="Emergency:800,Surgery:700,Nursing:500"] \
 *     [--requestsMin=5] [--requestsMax=8] [--transport=service|http|mixed]
 *
 * `--transport` (default `service`) selects how actors submit requests:
 * `service` calls TypeScript service classes directly, in-process (today's
 * behavior, 0 HTTP/auth/RBAC coverage but proven correct on business rules);
 * `http`/`mixed` additionally boot the real Express app in-process
 * (`buildApp` + `app.listen(0)`) and route calls through it, exercising the
 * full auth/RBAC/validation middleware chain — requires `NODE_ENV=test`
 * (the login rate limiter otherwise rejects the volume of synthetic logins).
 *
 * `--departments` describes the whole simulated structure: a comma-separated
 * list of `name:employeeCount` pairs. Each department gets its own org unit,
 * its own approving head (created on the fly when not already seeded), its
 * own roster, and its own schedule per round — so every run can exercise a
 * different structure, different department sizes, and different approving
 * managers. `--department`+`--employees` is the single-department shorthand.
 *
 * `--requestsMin`/`--requestsMax` bound how many requests each employee
 * submits per round; times `--rounds`, they set the guaranteed per-employee
 * total (e.g. 13-16 × 4 rounds ≥ 52).
 *
 * @author Luca Ostinelli
 */

import dotenv from 'dotenv';
import * as path from 'path';
import { createPool, RowDataPacket } from 'mysql2/promise';
import { config } from '../../src/config';
import { TimeOffService } from '../../src/services/TimeOffService';
import { EmployeeLoanService } from '../../src/services/EmployeeLoanService';
import { ShiftSwapService } from '../../src/services/ShiftSwapService';
import { AutoScheduleService } from '../../src/services/AutoScheduleService';
import { MegaLog } from './megaLog';
import { setupSimOrgs, DepartmentSpec, SIM_PASSWORD } from './setup';
import { createEmptySchedulePeriod } from './schedulePeriod';
import { runEmployeeActor, SubmittedRequest, EmployeeActorContext } from './employeeActor';
import { runManagerActor, runDelegateCheck, Decision } from './managerActor';
import { verifyAllRequests } from './verify';
import { verifyComplianceForSchedule } from './complianceReport';
import { runWithConcurrency } from './concurrency';
import { HttpClient } from './httpClient';
import { establishSession } from './httpAuth';

dotenv.config();

function parseArgs(): {
  departments: DepartmentSpec[];
  seed: number;
  concurrency: number;
  rounds: number;
  periodDays: number;
  requestsMin: number;
  requestsMax: number;
  transport: 'service' | 'http' | 'mixed';
} {
  const args = process.argv.slice(2);
  const get = (name: string, def: number): number => {
    const arg = args.find((a) => a.startsWith(`--${name}=`));
    return arg ? Number(arg.split('=')[1]) : def;
  };
  const getStr = (name: string, def: string): string => {
    const arg = args.find((a) => a.startsWith(`--${name}=`));
    return arg ? arg.split('=').slice(1).join('=') : def;
  };

  // --departments="Name:count,Name:count" wins; --department+--employees is
  // the single-department shorthand it degenerates to.
  const departmentsSpec = getStr('departments', '');
  let departments: DepartmentSpec[];
  if (departmentsSpec) {
    departments = departmentsSpec.split(',').map((pair) => {
      const [name, countStr] = pair.split(':');
      const count = Number(countStr);
      if (!name || !Number.isInteger(count) || count <= 0) {
        throw new Error(`Bad --departments entry "${pair}" — expected "Name:count" with a positive integer count.`);
      }
      return { name: name.trim(), count };
    });
    // A duplicated name would resolve to the same department/org unit and
    // corrupt the per-department round bookkeeping.
    const names = new Set(departments.map((d) => d.name));
    if (names.size !== departments.length) {
      throw new Error('Duplicate department names in --departments — every department must be distinct.');
    }
  } else {
    departments = [{ name: getStr('department', 'Operations'), count: get('employees', 2000) }];
  }

  const requestsMin = get('requestsMin', 5);
  const requestsMax = get('requestsMax', 8);
  if (requestsMin < 1 || requestsMax < requestsMin) {
    throw new Error(`Bad request bounds: --requestsMin=${requestsMin} --requestsMax=${requestsMax}.`);
  }

  const transport = getStr('transport', 'service');
  if (transport !== 'service' && transport !== 'http' && transport !== 'mixed') {
    throw new Error(`Bad --transport="${transport}" — must be one of: service, http, mixed.`);
  }

  return {
    departments,
    seed: get('seed', 424242),
    concurrency: get('concurrency', 24),
    rounds: get('rounds', 4),
    periodDays: get('periodDays', 14),
    transport: transport as 'service' | 'http' | 'mixed',
    requestsMin,
    requestsMax,
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

  // A head can delegate a structure-assigned item to *any* member of that
  // structure — including a cross-department loan target's own roster,
  // which isn't necessarily part of this run's `employeeUserIds`. Delegate
  // threads must cover every user who currently holds a delegated item, not
  // just our own simulated roster, or a delegated decision never gets made.
  const [delegateRows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT assigned_to_user_id AS id FROM pending_approvals
      WHERE status = 'pending' AND assigned_to_user_id IS NOT NULL`
  );
  const delegateUserIds = [
    ...new Set([...employeeUserIds, ...delegateRows.map((r) => r.id as number)]),
  ];
  const delegateDecisionsPerEmployee = await runWithConcurrency(delegateUserIds, concurrency, (userId) =>
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

/** Per-department carry-over between rounds: last generated schedule and who
 *  owns which assignment on it (what next round's shift swaps act on). */
interface DeptRoundState {
  previousScheduleId: number | null;
  previousLabel: string;
  previousAssignmentsByUser: Map<number, number[]>;
}

async function main(): Promise<void> {
  const { departments, seed, concurrency, rounds, periodDays, requestsMin, requestsMax, transport } = parseArgs();
  const startedAt = new Date();
  const logPath = path.join(
    __dirname,
    'output',
    `sim-${startedAt.toISOString().replace(/[:.]/g, '-')}.log`
  );
  const log = new MegaLog(logPath);

  const structureLabel = departments.map((d) => `${d.name}:${d.count}`).join(',');
  log.section(
    `FULL WORKFORCE SIMULATION (rolling) — seed=${seed}, departments=${structureLabel}, ` +
      `concurrency=${concurrency}, rounds=${rounds}, periodDays=${periodDays}, requests/round=${requestsMin}-${requestsMax}`
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

  // ---- HTTP transport: boot the real Express app in-process --------------
  // `service` transport (the default) never touches this; `http`/`mixed`
  // route actor calls through the full middleware stack (auth, RBAC,
  // validation) instead of calling service classes directly. Bound to an
  // OS-assigned ephemeral port (0) so multiple campaign lanes never collide.
  let httpBaseUrl: string | null = null;
  let httpServer: import('http').Server | null = null;
  if (transport !== 'service') {
    if (config.server.env !== 'test') {
      throw new Error(
        `--transport=${transport} requires NODE_ENV=test (loginLimiter allows only 10 attempts/15min otherwise — ` +
          `thousands of synthetic actor logins would 429 almost immediately).`
      );
    }
    const { buildApp } = await import('../../src/app');
    const app = buildApp(pool, { silent: true });
    httpServer = await new Promise<import('http').Server>((resolve) => {
      const server = app.listen(0, () => resolve(server));
    });
    const address = httpServer.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    httpBaseUrl = `http://127.0.0.1:${port}/api`;
    log.info(`HTTP transport enabled: app listening on ${httpBaseUrl} (transport=${transport}).`);
  }

  try {
    await pool.execute('SELECT 1');

    // ---- SETUP: org + rosters only — no schedules yet ---------------------
    const orgs = await setupSimOrgs(pool, log, departments);
    const allEmployeeUserIds = orgs.flatMap((o) => o.employeeUserIds);
    log.info(
      `Org ready: ${allEmployeeUserIds.length} employees across ${orgs.length} department(s): ` +
        orgs.map((o) => `${o.name}=${o.employeeUserIds.length} (head #${o.headUserId})`).join(', ')
    );

    const [orgUnitRows] = await pool.query(`SELECT id, manager_user_id FROM org_units`);
    const allOrgUnits = orgUnitRows as Array<{ id: number; manager_user_id: number | null }>;
    const distinctHeadUserIds = [
      ...new Set(allOrgUnits.map((u) => u.manager_user_id).filter((id): id is number => id !== null)),
    ];
    log.info(`Distinct org-unit heads who will run as manager threads: ${distinctHeadUserIds.join(', ')}`);

    // ---- HTTP transport smoke check -----------------------------------
    // Proves the whole chain end to end before any actor relies on it:
    // real login against the first department head, a locally-minted
    // bearer session, and one authenticated call through the full
    // middleware stack.
    if (httpBaseUrl) {
      const smokeHeadId = orgs[0].headUserId;
      const [headRows] = await pool.execute<RowDataPacket[]>(`SELECT email FROM users WHERE id = ?`, [smokeHeadId]);
      const smokeClient = new HttpClient(httpBaseUrl);
      await establishSession(smokeClient, log, headRows[0].email as string, SIM_PASSWORD);
      const healthRes = await smokeClient.get('/health');
      if (healthRes.status !== 200 && healthRes.status !== 503) {
        throw new Error(`HTTP transport smoke check failed: GET /health returned ${healthRes.status}`);
      }
      const verifyRes = await smokeClient.get<{ id: number }>('/auth/verify');
      if (verifyRes.status !== 200 || verifyRes.body.data?.id !== smokeHeadId) {
        throw new Error(`HTTP transport smoke check failed: GET /auth/verify returned ${JSON.stringify(verifyRes)}`);
      }
      log.info(`HTTP transport smoke check passed: login + bearer session + authenticated call all verified.`);
    }

    const services = {
      timeOffService: new TimeOffService(pool),
      loanService: new EmployeeLoanService(pool),
      shiftSwapService: new ShiftSwapService(pool),
    };
    const auto = new AutoScheduleService(pool);

    const allRequests: SubmittedRequest[] = [];
    const allDecisions: Decision[] = [];
    const deptState = new Map<number, DeptRoundState>(
      orgs.map((o) => [
        o.departmentId,
        { previousScheduleId: null, previousLabel: '', previousAssignmentsByUser: new Map() },
      ])
    );
    const today = new Date();

    for (let round = 0; round < rounds; round++) {
      const periodStart = dateStr(today, 7 + round * periodDays);
      const periodEnd = dateStr(today, 7 + round * periodDays + periodDays - 1);
      const label = `period ${round + 1}/${rounds} (${periodStart}..${periodEnd})`;

      log.section(`ROUND ${round + 1}/${rounds}: ${label}`);

      // One empty schedule per department, all covering the same period.
      const scheduleIdByDept = new Map<number, number>();
      for (const org of orgs) {
        const scheduleId = await createEmptySchedulePeriod(
          pool,
          org.departmentId,
          org.headUserId,
          `[SIM] ${org.name} ${label}`,
          periodStart,
          periodEnd,
          org.employeeUserIds.length
        );
        scheduleIdByDept.set(org.departmentId, scheduleId);
        const state = deptState.get(org.departmentId)!;
        log.info(
          `Created empty schedule id=${scheduleId} for ${org.name} ${label}. ` +
            (state.previousScheduleId === null
              ? 'No prior assignments exist yet — shift-swap requests will be skipped this round.'
              : `Shift-swap requests this round act on the ${state.previousLabel} schedule (id=${state.previousScheduleId}).`)
        );
      }

      // ---- PHASE 1: employees file requests ------------------------------
      log.info(
        `PHASE 1: ${allEmployeeUserIds.length} employee threads file requests (concurrency=${concurrency}, ${requestsMin}-${requestsMax} each)`
      );
      // Flatten every department's roster into one task list so the global
      // DB concurrency stays bounded at `concurrency` regardless of how many
      // departments the structure has.
      const actorTasks: Array<{ ctx: EmployeeActorContext; userId: number }> = [];
      for (const org of orgs) {
        const state = deptState.get(org.departmentId)!;
        const ctx: EmployeeActorContext = {
          pool,
          log,
          runSeed: seed + round * 1_000_003, // distinct-but-deterministic RNG stream per round
          orgUnitId: org.orgUnitId,
          otherOrgUnitIds: allOrgUnits.map((u) => u.id).filter((id) => id !== org.orgUnitId),
          baselineAssignmentsByUser: state.previousAssignmentsByUser,
          futureStartDate: periodStart,
          futureEndDate: periodEnd,
          requestsMin,
          requestsMax,
          ...services,
        };
        for (const userId of org.employeeUserIds) actorTasks.push({ ctx, userId });
      }
      const perEmployeeRequests = await runWithConcurrency(actorTasks, concurrency, (task) =>
        runEmployeeActor(task.ctx, task.userId)
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
        allEmployeeUserIds,
        concurrency
      );
      allDecisions.push(...decisionsThisRound);
      log.info(`Made ${decisionsThisRound.length} decisions this round (${allDecisions.length} total so far).`);

      // ---- PHASE 3: verify this round's request outcomes -----------------
      await verifyAllRequests(pool, log, requestsThisRound);

      // ---- PHASE 4: generate every department's schedule -----------------
      log.info(`PHASE 4: generate ${orgs.length} schedule(s) for ${label} (after this round's decisions have landed)`);
      for (const org of orgs) {
        const scheduleId = scheduleIdByDept.get(org.departmentId)!;
        const genResult = await auto.generate(scheduleId, org.headUserId);
        log.info(
          `Schedule generated for ${org.name} ${label}: ${genResult.assignmentsCreated}/${genResult.totalShifts} shifts filled ` +
            `(${genResult.coveragePercentage}%), status=${genResult.status}.`
        );
        log.count('schedule.assignments_created', genResult.assignmentsCreated);
      }

      // ---- PHASE 5: verify constraints -----------------------------------
      log.info('PHASE 5: verify scheduling constraints (compliance engine)');
      for (const org of orgs) {
        const scheduleId = scheduleIdByDept.get(org.departmentId)!;
        const state = deptState.get(org.departmentId)!;
        await verifyComplianceForSchedule(pool, log, scheduleId, `${org.name} ${label}`);
        if (state.previousScheduleId !== null) {
          await verifyComplianceForSchedule(
            pool,
            log,
            state.previousScheduleId,
            `${state.previousLabel} (post-swaps this round)`
          );
        }
      }

      // ---- prepare for next round -----------------------------------------
      for (const org of orgs) {
        const scheduleId = scheduleIdByDept.get(org.departmentId)!;
        const state = deptState.get(org.departmentId)!;
        state.previousScheduleId = scheduleId;
        state.previousLabel = `${org.name} ${label}`;
        state.previousAssignmentsByUser = await loadAssignmentsByUser(pool, scheduleId);
      }
    }

    // ---- FINAL CHECK: per-employee request minimum -----------------------
    // The actor retries until it hits its per-round target, but the retry
    // budget is finite — make the guarantee an explicit, automatic check
    // instead of an assumption. Every employee must have submitted at least
    // requestsMin × rounds requests across the whole run.
    log.section('VERIFY: per-employee request minimum');
    const guaranteedMinimum = requestsMin * rounds;
    const submittedByUser = new Map<number, number>();
    for (const req of allRequests) {
      submittedByUser.set(req.userId, (submittedByUser.get(req.userId) ?? 0) + 1);
    }
    let belowMinimum = 0;
    let observedMinimum = Number.POSITIVE_INFINITY;
    for (const userId of allEmployeeUserIds) {
      const submitted = submittedByUser.get(userId) ?? 0;
      observedMinimum = Math.min(observedMinimum, submitted);
      if (submitted < guaranteedMinimum) {
        belowMinimum++;
        log.verify(
          false,
          `employee #${userId}`,
          `submitted only ${submitted} requests across the run — guaranteed minimum is ${guaranteedMinimum}`
        );
      }
    }
    if (belowMinimum === 0) {
      log.verify(
        true,
        'per-employee request minimum',
        `all ${allEmployeeUserIds.length} employees submitted at least ${guaranteedMinimum} requests (observed minimum: ${observedMinimum})`
      );
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
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
    }
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Simulation crashed:', err);
  process.exit(1);
});
