#!/usr/bin/env ts-node
/**
 * Simulation campaign runner — many full workforce simulations, each against
 * a freshly generated organization structure.
 *
 * For every run it deterministically derives (from `--baseSeed` and the run
 * index, via the same seeded PRNG the simulation itself uses — no AI, no
 * wall-clock randomness):
 *   - the structure: 2-6 departments with distinct names and varying
 *     employee counts (total >= 2000 per run);
 *   - the pacing: rounds, period length, and per-round request bounds sized
 *     so every employee submits at least 50 requests across the run;
 *   - the authorization model: which approver scope grants each request
 *     type (single unit manager vs. the whole unit structure with
 *     keep/delegate/open-to-team), varied per run.
 *
 * Each run gets a completely fresh database (drop, re-create, schema init,
 * demo seed) so no state leaks between runs, then executes the real
 * simulation harness (scripts/simulation/index.ts), which self-verifies
 * every request outcome and re-checks every generated assignment against
 * the production ComplianceEngine. The campaign fans runs out over N
 * parallel "lanes", each with its own database on the same MySQL server.
 *
 * Results land in scripts/simulation/output/campaign-<timestamp>/:
 *   - run-XX.log     — full stdout/stderr of each simulation
 *   - summary.log    — one line per run (config, pass/fail counts, timing)
 * Exit code is non-zero if any run reports a verification failure.
 *
 * Required env: DB_ROOT_PASSWORD (or MYSQL_ROOT_PASSWORD) — root credentials
 * are needed to drop/create the per-lane databases and run the schema init
 * (which creates stored functions).
 *
 * Usage:
 *   DB_ROOT_PASSWORD=... npx ts-node scripts/simulation/campaign.ts \
 *     [--runs=40] [--baseSeed=20260712] [--lanes=4] [--concurrency=24] \
 *     [--minEmployees=2000] [--minRequests=50]
 *
 * `--minEmployees`/`--minRequests` exist for quick smoke tests of the
 * campaign machinery itself (e.g. --runs=2 --minEmployees=60 --minRequests=8);
 * the defaults are the real campaign spec.
 *
 * @author Luca Ostinelli
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { createConnection } from 'mysql2/promise';
import dotenv from 'dotenv';
import { Rng } from './prng';

dotenv.config();

const BACKEND_DIR = path.join(__dirname, '..', '..');
const OUTPUT_DIR = path.join(__dirname, 'output');

// Single-word names only: the --departments CLI format is "Name:count,...".
const DEPARTMENT_NAME_POOL = [
  'Emergency',
  'Surgery',
  'Pediatrics',
  'Nursing',
  'Radiology',
  'Oncology',
  'Cardiology',
  'Laboratory',
  'Pharmacy',
  'Rehabilitation',
  'Logistics',
  'Facilities',
  'Security',
  'Administration',
  'Housekeeping',
  'Maintenance',
  'Reception',
  'Neurology',
];

/** Who grants authorizations, per request type. Applied as SQL on the fresh
 *  seed before each run. `swap` is `unit_structure` in the default seed. */
const APPROVER_VARIANTS = [
  { name: 'default (timeoff/loan=manager, swap=structure)', sql: [] as string[] },
  {
    name: 'all-structure',
    sql: [
      `UPDATE approval_steps SET approver_scope='unit_structure'
        WHERE workflow_id IN (SELECT id FROM approval_workflows WHERE change_type IN ('TimeOff.Request','Loan.Request'))`,
    ],
  },
  {
    name: 'timeoff-structure',
    sql: [
      `UPDATE approval_steps SET approver_scope='unit_structure'
        WHERE workflow_id IN (SELECT id FROM approval_workflows WHERE change_type = 'TimeOff.Request')`,
    ],
  },
  {
    name: 'loan-structure',
    sql: [
      `UPDATE approval_steps SET approver_scope='unit_structure'
        WHERE workflow_id IN (SELECT id FROM approval_workflows WHERE change_type = 'Loan.Request')`,
    ],
  },
  {
    name: 'all-manager',
    sql: [
      `UPDATE approval_steps SET approver_scope='unit_manager'
        WHERE workflow_id IN (SELECT id FROM approval_workflows WHERE change_type = 'ShiftSwap.Request')`,
    ],
  },
];

interface CampaignSpec {
  /** Guaranteed minimum roster size per run (sum across departments). */
  minEmployees: number;
  /** Guaranteed minimum requests each employee submits across a run. */
  minRequests: number;
}

interface RunConfig {
  runIndex: number;
  seed: number;
  departments: Array<{ name: string; count: number }>;
  rounds: number;
  periodDays: number;
  requestsMin: number;
  requestsMax: number;
  variantIndex: number;
}

interface RunResult {
  config: RunConfig;
  exitCode: number;
  wallClockMs: number;
  counters: Record<string, number>;
  outcome: 'PASS' | 'FAIL' | 'CRASH' | 'TIMEOUT';
}

function parseArgs(): { runs: number; baseSeed: number; lanes: number; concurrency: number; spec: CampaignSpec } {
  const args = process.argv.slice(2);
  const get = (name: string, def: number): number => {
    const arg = args.find((a) => a.startsWith(`--${name}=`));
    return arg ? Number(arg.split('=')[1]) : def;
  };
  return {
    runs: get('runs', 40),
    baseSeed: get('baseSeed', 20260712),
    lanes: get('lanes', 4),
    concurrency: get('concurrency', 24),
    spec: {
      minEmployees: get('minEmployees', 2000),
      minRequests: get('minRequests', 50),
    },
  };
}

/** Derives run N's full configuration from the base seed — deterministic. */
function buildRunConfig(baseSeed: number, runIndex: number, spec: CampaignSpec): RunConfig {
  const rng = new Rng(baseSeed).child(`run:${runIndex}`);

  // Structure: 2-6 departments, distinct names, weighted sizes,
  // total >= spec.minEmployees.
  const deptCount = rng.int(2, 6);
  const namePool = [...DEPARTMENT_NAME_POOL];
  const names: string[] = [];
  for (let i = 0; i < deptCount; i++) {
    const pick = rng.int(0, namePool.length - 1);
    names.push(namePool.splice(pick, 1)[0]);
  }
  const total = rng.int(spec.minEmployees, spec.minEmployees + Math.ceil(spec.minEmployees * 0.4));
  const weights = names.map(() => 0.2 + rng.next()); // floor keeps every department non-trivial
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const departments = names.map((name, i) => ({
    name,
    count: Math.max(10, Math.round((total * weights[i]) / weightSum)),
  }));
  // Rounding can land the sum a hair under the target — top up the largest.
  const sum = departments.reduce((a, d) => a + d.count, 0);
  if (sum < spec.minEmployees) {
    departments.sort((a, b) => b.count - a.count)[0].count += spec.minEmployees - sum;
  }

  // Pacing: enough requests per round that rounds × min >= minRequests.
  const rounds = rng.int(4, 5);
  const requestsMin = Math.ceil(spec.minRequests / rounds);
  const requestsMax = requestsMin + 3;
  const periodDays = rng.pick([7, 10, 14]);

  return {
    runIndex,
    seed: baseSeed + runIndex * 7_919, // prime stride: distinct sim seeds per run
    departments,
    rounds,
    periodDays,
    requestsMin,
    requestsMax,
    variantIndex: rng.int(0, APPROVER_VARIANTS.length - 1),
  };
}

function rootCredentials(): { user: string; password: string; host: string; port: number } {
  const password = process.env.DB_ROOT_PASSWORD ?? process.env.MYSQL_ROOT_PASSWORD;
  if (!password) {
    throw new Error('DB_ROOT_PASSWORD (or MYSQL_ROOT_PASSWORD) must be set — needed to reset per-lane databases.');
  }
  return {
    user: process.env.DB_ROOT_USER ?? 'root',
    password,
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3306),
  };
}

async function resetLaneDatabase(dbName: string): Promise<void> {
  const root = rootCredentials();
  const conn = await createConnection({ host: root.host, port: root.port, user: root.user, password: root.password });
  try {
    await conn.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
    await conn.query(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } finally {
    await conn.end();
  }
}

async function applyVariantSql(dbName: string, variantIndex: number): Promise<void> {
  const statements = APPROVER_VARIANTS[variantIndex].sql;
  if (statements.length === 0) return;
  const root = rootCredentials();
  const conn = await createConnection({
    host: root.host,
    port: root.port,
    user: root.user,
    password: root.password,
    database: dbName,
  });
  try {
    for (const sql of statements) await conn.query(sql);
  } finally {
    await conn.end();
  }
}

/** Runs a ts-node script as a child process against the lane's database,
 *  streaming all output to `logStream`. Resolves with the exit code, or
 *  rejects only on spawn failure; a timeout kills the child and returns
 *  the sentinel exit code -2.
 *
 *  Spawns node directly on ts-node's entry point instead of going through
 *  `npx`: killing an npx wrapper does not reliably kill the node process it
 *  spawned, and an orphaned simulation still writing while the lane drops
 *  and recreates its database would corrupt every subsequent run. */
function runChild(
  scriptArgs: string[],
  dbName: string,
  logStream: fs.WriteStream,
  timeoutMs: number
): Promise<number> {
  const root = rootCredentials();
  const tsNodeBin = path.join(BACKEND_DIR, 'node_modules', 'ts-node', 'dist', 'bin.js');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsNodeBin, ...scriptArgs], {
      cwd: BACKEND_DIR,
      env: {
        ...process.env,
        DB_HOST: root.host,
        DB_PORT: String(root.port),
        DB_NAME: dbName,
        DB_USER: root.user,
        DB_PASSWORD: root.password,
      },
    });
    const timer = setTimeout(() => {
      logStream.write(`\n[campaign] TIMEOUT after ${timeoutMs}ms — killing child.\n`);
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (d) => logStream.write(d));
    child.stderr.on('data', (d) => logStream.write(d));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve(signal === 'SIGKILL' ? -2 : code ?? -1);
    });
  });
}

/** Pulls the harness's own counters (verify.pass, verify.fail, *.stuck, …)
 *  back out of the captured run log. */
function parseCounters(logPath: string): Record<string, number> {
  const counters: Record<string, number> = {};
  const text = fs.readFileSync(logPath, 'utf8');
  const summaryStart = text.lastIndexOf('SUMMARY');
  if (summaryStart === -1) return counters;
  for (const line of text.slice(summaryStart).split('\n')) {
    const m = line.match(/^\s{2}([a-z][a-z0-9_.]+)\s+(\d+)$/);
    if (m) counters[m[1]] = Number(m[2]);
  }
  return counters;
}

async function executeRun(config: RunConfig, dbName: string, campaignDir: string, concurrency: number): Promise<RunResult> {
  const runLabel = String(config.runIndex + 1).padStart(2, '0');
  const logPath = path.join(campaignDir, `run-${runLabel}.log`);
  const logStream = fs.createWriteStream(logPath);
  const startedAt = Date.now();

  const header =
    `[campaign] run ${runLabel} on ${dbName}\n` +
    `[campaign] structure: ${config.departments.map((d) => `${d.name}:${d.count}`).join(',')}\n` +
    `[campaign] rounds=${config.rounds} periodDays=${config.periodDays} requests/round=${config.requestsMin}-${config.requestsMax} seed=${config.seed}\n` +
    `[campaign] authorization variant: ${APPROVER_VARIANTS[config.variantIndex].name}\n`;
  logStream.write(header);

  try {
    await resetLaneDatabase(dbName);
    logStream.write('[campaign] database reset done.\n');

    const initCode = await runChild(['scripts/init-database.ts'], dbName, logStream, 5 * 60_000);
    if (initCode !== 0) throw new Error(`init-database exited ${initCode}`);
    const seedCode = await runChild(['scripts/seed-demo.ts'], dbName, logStream, 5 * 60_000);
    if (seedCode !== 0) throw new Error(`seed-demo exited ${seedCode}`);
    await applyVariantSql(dbName, config.variantIndex);
    logStream.write('[campaign] init + seed + authorization variant applied.\n');

    const simArgs = [
      'scripts/simulation/index.ts',
      `--departments=${config.departments.map((d) => `${d.name}:${d.count}`).join(',')}`,
      `--seed=${config.seed}`,
      `--concurrency=${concurrency}`,
      `--rounds=${config.rounds}`,
      `--periodDays=${config.periodDays}`,
      `--requestsMin=${config.requestsMin}`,
      `--requestsMax=${config.requestsMax}`,
    ];
    const simCode = await runChild(simArgs, dbName, logStream, 3 * 60 * 60_000);
    // Wait for the stream to flush before reading the file back — end()
    // alone is asynchronous, and a truncated read would misclassify the run.
    await new Promise<void>((res) => logStream.end(res));

    const counters = parseCounters(logPath);
    const outcome: RunResult['outcome'] =
      simCode === -2 ? 'TIMEOUT' : simCode === 0 ? 'PASS' : (counters['verify.fail'] ?? 0) > 0 ? 'FAIL' : 'CRASH';
    return { config, exitCode: simCode, wallClockMs: Date.now() - startedAt, counters, outcome };
  } catch (err) {
    logStream.write(`[campaign] run crashed: ${(err as Error).message}\n`);
    await new Promise<void>((res) => logStream.end(res));
    return {
      config,
      exitCode: -1,
      wallClockMs: Date.now() - startedAt,
      counters: parseCounters(logPath),
      outcome: 'CRASH',
    };
  }
}

function summaryLine(r: RunResult): string {
  const c = r.counters;
  const structure = r.config.departments.map((d) => `${d.name}:${d.count}`).join(',');
  const stuck = Object.entries(c)
    .filter(([k]) => k.endsWith('.stuck'))
    .reduce((a, [, v]) => a + v, 0);
  return [
    `run=${String(r.config.runIndex + 1).padStart(2, '0')}`,
    `outcome=${r.outcome}`,
    `pass=${c['verify.pass'] ?? 0}`,
    `fail=${c['verify.fail'] ?? 0}`,
    `stuck=${stuck}`,
    `minutes=${(r.wallClockMs / 60_000).toFixed(1)}`,
    `rounds=${r.config.rounds}`,
    `periodDays=${r.config.periodDays}`,
    `req/round=${r.config.requestsMin}-${r.config.requestsMax}`,
    `variant=${APPROVER_VARIANTS[r.config.variantIndex].name.split(' ')[0]}`,
    `structure=${structure}`,
  ].join('  ');
}

async function main(): Promise<void> {
  const { runs, baseSeed, lanes, concurrency, spec } = parseArgs();
  rootCredentials(); // fail fast if credentials are missing

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const campaignDir = path.join(OUTPUT_DIR, `campaign-${stamp}`);
  fs.mkdirSync(campaignDir, { recursive: true });
  const summaryPath = path.join(campaignDir, 'summary.log');

  const log = (line: string): void => {
    console.log(line);
    fs.appendFileSync(summaryPath, line + '\n');
  };

  log(
    `CAMPAIGN: ${runs} runs, baseSeed=${baseSeed}, ${lanes} parallel lanes, sim concurrency=${concurrency}/lane, ` +
      `>=${spec.minEmployees} employees and >=${spec.minRequests} requests/employee per run`
  );
  log(`Output: ${campaignDir}`);

  const configs = Array.from({ length: runs }, (_, i) => buildRunConfig(baseSeed, i, spec));
  const results: RunResult[] = new Array(runs);

  // Round-robin the runs over the lanes; each lane owns one database and
  // processes its share strictly sequentially.
  const laneWorkers = Array.from({ length: Math.min(lanes, runs) }, (_, lane) =>
    (async () => {
      const dbName = `staff_scheduler_simlane${lane + 1}`;
      for (let i = lane; i < runs; i += lanes) {
        const result = await executeRun(configs[i], dbName, campaignDir, concurrency);
        results[i] = result;
        log(summaryLine(result));
      }
    })()
  );
  await Promise.all(laneWorkers);

  const failed = results.filter((r) => r.outcome !== 'PASS');
  const totalPass = results.reduce((a, r) => a + (r.counters['verify.pass'] ?? 0), 0);
  const totalFail = results.reduce((a, r) => a + (r.counters['verify.fail'] ?? 0), 0);
  log('');
  log(`CAMPAIGN RESULT: ${runs - failed.length}/${runs} runs fully passed — ${totalPass} verifications passed, ${totalFail} failed.`);
  if (failed.length > 0) {
    log(`Runs needing analysis: ${failed.map((r) => String(r.config.runIndex + 1).padStart(2, '0')).join(', ')} (see run-XX.log).`);
  }
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error('Campaign crashed:', err);
  process.exit(1);
});
