#!/usr/bin/env ts-node
/**
 * Full workforce simulation — every actor action through the real HTTP API.
 *
 * Boots the real Express app in-process (`buildApp` + `app.listen(0)` on
 * loopback, plus the optimization worker the production bootstrap starts),
 * and simulates an organization over rolling schedule periods. Every person
 * is an actor with their own session: they log in with their password, hold
 * the server's cookies, get refreshed, and log out at the end. Nothing an
 * actor does calls a service class; the database is read only by the
 * verification step, to check that what the API answered is what happened.
 *
 *   setup      administrator builds the structure: scoped department heads,
 *              departments, rosters (setup.ts)
 *   configure  administrator configures the company (adminActor.ts)
 *   per round:
 *     plan     heads create the period's schedule, shifts, on-call; lend people
 *     file     employees file time-off, swaps, open offers, exceptions; clock
 *              in/out; read their dashboard, notifications, calendar...
 *     answer   swap targets accept or decline
 *     decide   heads decide/keep/delegate/open; delegates decide; heads mop up;
 *              attendance and policy exceptions; administrator reviews
 *     manage   pairings, preferences, contracts, change requests, delegations,
 *              reports and exports
 *     probe    heads aim at another department — must be 403/404
 *     verify   every request's outcome against the database
 *     generate heads generate (queued, polled) and publish; compliance check
 *   finally    calendars, module gate, destructive step, ledger verification,
 *              logout of everyone, and the operation-coverage assertion
 *
 * Determinism: every choice comes from the seeded PRNG (prng.ts) — same seed,
 * same structure, same actions. The run fails (exit 1) on any verification
 * failure, any finding, any operation in openapi.json that was not reached,
 * and any operation reached but never successful that is not in the reviewed
 * NEVER_SUCCEEDS list (coverage.ts).
 *
 * Usage (NODE_ENV=test is required: the login limiter allows 10 attempts per
 * 15 minutes otherwise):
 *   NODE_ENV=test npx ts-node scripts/simulation/index.ts \
 *     [--employees=2000] [--department=Operations | --departments="Emergency:800,Surgery:700"] \
 *     [--seed=424242] [--rounds=4] [--periodDays=14] [--requestsMin=5] [--requestsMax=8] \
 *     [--concurrency=<hardware-derived>] \
 *     [--adminEmail=admin@demo.staffscheduler.local] [--adminPassword=demo1234]
 *
 * The administrator account is the one thing the run does not create: it is
 * the bootstrap credential (the demo seed's administrator by default, as the
 * campaign seeds every lane), exactly as a real deployment starts from one.
 *
 * @author Luca Ostinelli
 */

import './simEnv';
import * as path from 'path';
import { createPool } from 'mysql2/promise';
import winston from 'winston';
import { config } from '../../src/config';
import { logger } from '../../src/config/logger';
import { defaultSimulationConcurrency } from '../../src/config/hardware';
import { closeOptimizationQueue, initOptimizationWorker, isOptimizationQueueEnabled } from '../../src/services/OptimizationQueue';
import { MegaLog } from './megaLog';
import { DepartmentSpec, loginEveryone, setupSimOrgs } from './setup';
import { endSession, expireAccessToken, loadProfile, login, refresh } from './httpAuth';
import { answerSwaps, RoundContext, runEmployeeTurn, addDays } from './employeeActor';
import { decideOther, decideQueue, DeptRound, generateAndPublish, lendEmployee, manage, planRound, probeScope, replan, runDelegateTurn } from './managerActor';
import { calendarFeeds, configure, destroy, importAccounts, kioskShift, moduleToggle, pushRegistration, review, twoFactor } from './adminActor';
import { verifyLedger, verifyRequests } from './verify';
import { verifyComplianceForSchedule } from './complianceReport';
import { runWithConcurrency } from './concurrency';
import { newLedger } from './requests';
import { NEVER_SUCCEEDS, summarize } from './coverage';
import { World } from './world';

interface Args {
  departments: DepartmentSpec[];
  seed: number;
  concurrency: number;
  rounds: number;
  periodDays: number;
  requestsMin: number;
  requestsMax: number;
  adminEmail: string;
  adminPassword: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const getStr = (name: string, def: string): string => {
    const arg = args.find((a) => a.startsWith(`--${name}=`));
    return arg ? arg.split('=').slice(1).join('=') : def;
  };
  const get = (name: string, def: number): number => Number(getStr(name, String(def)));

  // --departments="Name:count,..." wins; --department+--employees is the
  // single-department shorthand.
  const spec = getStr('departments', '');
  let departments: DepartmentSpec[];
  if (spec) {
    departments = spec.split(',').map((pair) => {
      const [name, countStr] = pair.split(':');
      const count = Number(countStr);
      if (!name || !Number.isInteger(count) || count <= 0) {
        throw new Error(`Bad --departments entry "${pair}" — expected "Name:count" with a positive integer count.`);
      }
      return { name: name.trim(), count };
    });
    if (new Set(departments.map((d) => d.name)).size !== departments.length) {
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
  return {
    departments,
    seed: get('seed', 424242),
    concurrency: get('concurrency', defaultSimulationConcurrency()),
    rounds: get('rounds', 4),
    periodDays: get('periodDays', 14),
    requestsMin,
    requestsMax,
    adminEmail: getStr('adminEmail', 'admin@demo.staffscheduler.local'),
    adminPassword: getStr('adminPassword', 'demo1234'),
  };
}

const todayUtc = (): string => new Date().toISOString().slice(0, 10);

async function main(): Promise<void> {
  const a = parseArgs();
  if (config.server.env !== 'test') {
    throw new Error('The simulation requires NODE_ENV=test (the login limiter allows only 10 attempts per 15 minutes otherwise).');
  }
  const startedAt = new Date();
  const log = new MegaLog(path.join(__dirname, 'output', `sim-${startedAt.toISOString().replace(/[:.]/g, '-')}.log`));
  const structure = a.departments.map((d) => `${d.name}:${d.count}`).join(',');
  log.section(
    `WORKFORCE SIMULATION over HTTP — seed=${a.seed}, departments=${structure}, rounds=${a.rounds}, ` +
      `periodDays=${a.periodDays}, requests/round=${a.requestsMin}-${a.requestsMax}, concurrency=${a.concurrency}`
  );
  log.info(`Log file: ${log.filePath}`);
  // The app's logger is silent under NODE_ENV=test. A 500 the simulation
  // reports needs the server's side of it (stack, SQL error) as evidence, so
  // errors — and only errors — are written next to the run log; each carries
  // the request id the finding quotes from the response.
  const serverLog = log.filePath.replace(/\.log$/, '-server-errors.log');
  logger.silent = false;
  logger.add(new winston.transports.File({ filename: serverLog, level: 'error' }));
  log.info(`Server error log: ${serverLog}`);

  const pool = createPool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database,
    waitForConnections: true,
    connectionLimit: Math.max(a.concurrency + 5, 10),
    queueLimit: 0,
    connectTimeout: config.database.connectTimeout,
  });

  const { buildApp } = await import('../../src/app');
  const app = buildApp(pool, { silent: true });
  const server = await new Promise<import('http').Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  // The worker runs in this process exactly as src/index.ts runs it next to
  // the app: without it a queued generation would never complete.
  if (isOptimizationQueueEnabled()) initOptimizationWorker(pool);
  log.info(`App listening on http://127.0.0.1:${port}/api/v1 (optimization queue ${isOptimizationQueueEnabled() ? 'on' : 'off — generation is synchronous'}).`);

  const world = new World(pool, log, a.seed, `http://127.0.0.1:${port}`);
  const ledger = newLedger();
  try {
    world.admin = await login(world, 'ADMIN', a.adminEmail, a.adminPassword);
    await refresh(world, world.admin);
    await setupSimOrgs(world, a.departments, a.concurrency);
    await loginEveryone(world, a.concurrency);

    // A tag that is deterministic on a fresh database and still unique when a
    // run is repeated on the same one: names of configuration entities are
    // unique, so a second run must not collide with the first.
    const skills = await world.admin.client.get<Array<{ name: string }>>('/skills');
    const priorRuns = (Array.isArray(skills.body.data) ? skills.body.data : []).filter((s) => s.name.startsWith('SIM skill ')).length;
    const tag = `${a.seed}-${priorRuns}`;
    const adminState = await configure(world, tag);
    await importAccounts(world, tag, ledger.imported);
    const dept0 = world.departments[0];
    if (dept0.employees.length > 1) await twoFactor(world, dept0.employees[1]);
    if (dept0.employees.length > 0) await pushRegistration(world, dept0.employees[0]);

    const rounds = new Map<number, DeptRound>();
    const allRounds: Array<Map<number, DeptRound>> = [];
    for (let r = 1; r <= a.rounds; r++) {
      const periodStart = addDays(todayUtc(), 7 + (r - 1) * a.periodDays);
      const ctx: RoundContext = {
        round: r,
        runSeed: a.seed + r * 1_000_003,
        periodStart,
        periodEnd: addDays(periodStart, a.periodDays - 1),
        requestsMin: a.requestsMin,
        requestsMax: a.requestsMax,
        ledger,
        exceptionPolicyId: adminState.exceptionPolicyId,
      };
      const thoroughRound = r === 1;
      log.section(`ROUND ${r}/${a.rounds}: ${ctx.periodStart}..${ctx.periodEnd}`);

      // Everyone re-reads their profile, as the SPA does on load: roles and
      // delegations granted since (the configure step grants some) change
      // what an actor may do, and expectations must follow.
      await runWithConcurrency([...world.heads(), ...world.allEmployees()], a.concurrency, (x) => loadProfile(world, x));

      // PLAN
      rounds.clear();
      for (const dept of world.departments) {
        const planned = await planRound(world, dept, ctx, thoroughRound);
        if (planned) rounds.set(dept.departmentId, planned);
      }
      allRounds.push(new Map(rounds));
      const filed = [];
      for (const dept of world.departments) filed.push(...(await lendEmployee(world, dept, ctx, thoroughRound)));

      // FILE — every employee in every department, globally bounded.
      const tasks = world.departments.flatMap((dept) =>
        dept.employees.map((e, i) => ({ e, thorough: i === 0, colleague: dept.employees[(i + 1) % dept.employees.length] ?? null }))
      );
      const perEmployee = await runWithConcurrency(tasks, a.concurrency, (t) => {
        const othersTimeOff = ledger.requests.find((q) => q.kind === 'time_off' && q.userId !== t.e.userId)?.id ?? null;
        return runEmployeeTurn(world, t.e, ctx, t.thorough, t.colleague === t.e ? null : t.colleague, othersTimeOff);
      });
      filed.push(...perEmployee.flat());
      ledger.requests.push(...filed);
      log.info(`Filed ${filed.length} requests this round (${ledger.requests.length} in total).`);

      // ANSWER
      // Heads too: a swap candidate can be a shift the head works themselves.
      await runWithConcurrency([...world.heads(), ...world.allEmployees()], a.concurrency, (e) => answerSwaps(world, e, ctx));

      // MANAGE + PROBE — before the decisions, so what a head proposes or
      // delegates this round is decided this round.
      for (const dept of world.departments) {
        await manage(world, dept, ctx, thoroughRound, rounds.get(dept.departmentId) ?? null);
        await probeScope(world, dept, ctx, rounds, ledger.requests);
      }
      if (adminState.kioskToken) {
        const code = (e: { email: string }): string => e.email.replace(/^sim\.([a-z0-9]+)\.(\d+)@.*$/, (_m, s, n) => `SIM-${s}-${n}`);
        await kioskShift(world, adminState.kioskToken, dept0.employees.slice(0, 3), code, ledger);
      }

      // DECIDE — every head's first pass takes every decision route in turn
      // (thorough), then delegates, a mop-up, the administrator's own queue.
      const delegates = new Set<number>();
      for (const dept of world.departments) {
        for (const u of await decideQueue(world, dept, ctx, true, false)) delegates.add(u);
      }
      const delegateActors = world.allEmployees().filter((e) => delegates.has(e.userId));
      await runWithConcurrency(delegateActors, a.concurrency, (e) => runDelegateTurn(world, e, ctx));
      for (const dept of world.departments) await decideQueue(world, dept, ctx, false, true);
      for (const dept of world.departments) await decideOther(world, dept, ctx);
      // The administrator reviews on the entity routes first, then clears
      // whatever is left in their own approval queue.
      await review(world, ctx, thoroughRound);
      await runDelegateTurn(world, world.admin, ctx);

      // VERIFY this round's requests, then GENERATE and check constraints.
      await verifyRequests(world, ledger, filed);
      for (const dept of world.departments) {
        const planned = rounds.get(dept.departmentId);
        if (!planned) continue;
        await generateAndPublish(world, dept, planned.scheduleId, thoroughRound);
        await verifyComplianceForSchedule(world, planned.scheduleId, `${dept.name} round ${r}`);
      }
    }

    // FINALLY
    log.section('FINAL STEPS');
    await calendarFeeds(world, dept0.head, dept0.departmentId);
    await moduleToggle(world, dept0.head, dept0.departmentId, todayUtc(), addDays(todayUtc(), 7 + a.rounds * a.periodDays));
    const lastSchedule = allRounds[allRounds.length - 1]?.get(dept0.departmentId)?.scheduleId ?? null;
    if (lastSchedule) {
      await replan(world, dept0, lastSchedule);
      await verifyComplianceForSchedule(world, lastSchedule, `${dept0.name} after replan`);
    }
    await destroy(world, adminState, tag, lastSchedule);
    await verifyLedger(world, ledger);

    log.section('LOGOUT: every session ends, and stays ended');
    await expireAccessToken(world, dept0.head);
    if (dept0.employees[0]) await expireAccessToken(world, dept0.employees[0]);
    await runWithConcurrency([...world.heads(), ...world.allEmployees()], a.concurrency, (actor) => endSession(world, actor));
    await endSession(world, world.admin);
    const refreshes = [...world.heads(), ...world.allEmployees(), world.admin].reduce((n, x) => n + x.client.refreshes, 0);
    log.info(`Automatic access-token refreshes during the run: ${refreshes}.`);

    // COVERAGE
    log.section('COVERAGE: every operation in openapi.json');
    const cov = summarize(world.recorder);
    log.info(`Operations: ${cov.total}; reached ${cov.reached}; succeeded at least once ${cov.succeeded}.`);
    for (const key of cov.unreached) world.dbFinding(`coverage ${key}`, 'operation never reached by any actor');
    for (const [key, statuses] of cov.reachedNeverSucceeded) {
      if (NEVER_SUCCEEDS[key]) log.info(`reached, never successful by design — ${key} ${statuses}: ${NEVER_SUCCEEDS[key]}`);
      else world.dbFinding(`coverage ${key}`, `reached but never successful (${statuses})`);
    }
    for (const [req, n] of world.recorder.unmatchedRequests()) world.dbFinding(`unmounted path ${req}`, `${n} request(s) hit no route`);

    // FINDINGS
    const counters = log.getCounters();
    const failures = counters['verify.fail'] ?? 0;
    const distinct = new Map<string, number>();
    for (const f of world.findings) {
      const key = `${f.kind} | ${f.operation.replace(/\/\d+/g, '/{id}').replace(/\?.*$/, '')} | ${f.note}`;
      distinct.set(key, (distinct.get(key) ?? 0) + 1);
    }
    log.summary([
      '',
      `  operations reached: ${cov.reached}/${cov.total}, succeeded: ${cov.succeeded}/${cov.total}`,
      `  distinct findings: ${distinct.size}`,
      ...[...distinct.entries()].map(([k, n]) => `    ${n}× ${k}`),
      failures === 0 ? '  RESULT: all verifications passed.' : `  RESULT: ${failures} verification(s) FAILED — see [VERIFY:FAIL] lines.`,
    ]);
    await log.close();
    process.exitCode = failures === 0 ? 0 : 1;
  } finally {
    // closeAllConnections: fetch keeps idle keep-alive sockets, and close()
    // alone waits for them forever (campaign.ts would hit its 3-hour timeout).
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeOptimizationQueue().catch(() => undefined);
    // Bounded: a pool that thousands of actors raced on can keep a connection
    // mysql2 does not consider idle; the job is done, do not hang on it.
    await Promise.race([pool.end(), new Promise((resolve) => setTimeout(resolve, 10_000))]);
  }
}

main()
  .catch((err) => {
    console.error('Simulation crashed:', err);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
