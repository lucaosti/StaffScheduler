#!/usr/bin/env ts-node
/**
 * Turns one run's records (k6/lib.js writes one JSON line per request) into
 * the CSV tables methodology.md describes.
 *
 *   ts-node benchmarks/load/check/report.ts <run-dir> [warmup-seconds]
 *
 * Reads <run-dir>/records.jsonl and, for a chaos run, <run-dir>/events.csv
 * (written by run.sh: `t_ms,phase,action`). Writes summary.csv (per operation
 * group), endpoints.csv, errors.csv, generate.csv, race.csv, timeline.csv and
 * chaos.csv next to them — each only when the run produced its records.
 *
 * WHY EXACT PERCENTILES. A local run records a few tens of thousands of
 * requests, so sorting every duration costs nothing and leaves no estimation
 * error to explain; nearest-rank on the sorted sample is the definition used
 * throughout (p99 of 50 samples is therefore the maximum, and the CSV keeps
 * the sample count beside every percentile so a reader can tell).
 *
 * WHY A WARM-UP CUT. The first seconds carry the logins, cold connection
 * pools, the JIT and empty caches — none of which is the steady state a
 * capacity figure describes. Records sent before start + warmup are excluded
 * from summary.csv and endpoints.csv, and kept in every other table (the
 * timeline and the chaos windows are about what happened, not steady state).
 *
 * @author Luca Ostinelli
 */

import * as fs from 'fs';
import * as path from 'path';

interface Req {
  k: 'req';
  t: number;
  g: string;
  n: string;
  s: number;
  d: number;
  o: 'ok' | 'rejected' | 'throttled' | 'error';
  c: string | null;
  x: number | null;
  msg: string | null;
}
interface Health {
  k: 'health';
  t: number;
  s: number;
  status: string | null;
  database: string | null;
  redis: string | null;
}
interface Generate {
  k: 'generate';
  t: number;
  ms: number;
  state: string;
  engine: string | null;
  degraded: boolean | null;
  degradedReason: string | null;
}
interface Race {
  t: number;
  k: 'race';
  round: number;
  kind: string;
  concurrent: boolean;
  created: number;
  results: { status: number; code: string | null }[];
}
type AnyRecord = Req | Health | Generate | Race | { k: 'meta'; t: number } | { k: string; t: number };

const TIMEOUT_CODE = 1050;

const percentile = (sorted: number[], p: number): number =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];

const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const writeCsv = (file: string, header: string[], lines: unknown[][]): void => {
  fs.writeFileSync(file, [header.join(','), ...lines.map((l) => l.map(csvCell).join(','))].join('\n') + '\n');
};

/**
 * A response that arrived but broke the contract — no JSON envelope, or a
 * failure without `error.code` (lib.js records `c` only for a well-formed
 * failure) — as opposed to a 5xx that still carries a proper body.
 */
const isEnvelopeViolation = (r: Req): boolean => r.o === 'error' && r.s !== 0 && r.c === null;
const isTimeout = (r: Req): boolean => r.s === 0 && r.x === TIMEOUT_CODE;

function stats(list: Req[], windowS: number): unknown[] {
  const durations = list.filter((r) => r.s !== 0).map((r) => r.d).sort((a, b) => a - b);
  const count = (o: Req['o']) => list.filter((r) => r.o === o).length;
  const errors = count('error');
  return [
    list.length,
    fmt(windowS),
    fmt(list.length / Math.max(windowS, 1e-9)),
    fmt(percentile(durations, 50)),
    fmt(percentile(durations, 90)),
    fmt(percentile(durations, 95)),
    fmt(percentile(durations, 99)),
    fmt(durations.length ? durations[durations.length - 1] : 0),
    count('ok'),
    count('rejected'),
    count('throttled'),
    errors,
    fmt(list.length ? errors / list.length : 0),
    fmt(list.length ? count('rejected') / list.length : 0),
    list.filter(isEnvelopeViolation).length,
    list.filter(isTimeout).length,
  ];
}
const STATS_HEADER = [
  'requests', 'window_s', 'throughput_rps', 'p50_ms', 'p90_ms', 'p95_ms', 'p99_ms', 'max_ms',
  'ok', 'rejected', 'throttled', 'errors', 'error_rate', 'rejected_rate', 'envelope_violations', 'timeouts',
];

function groupBy<T>(list: T[], key: (t: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of list) map.set(key(item), [...(map.get(key(item)) ?? []), item]);
  return map;
}

function main(): void {
  const [runDir, warmupArg] = process.argv.slice(2);
  if (!runDir) {
    process.stderr.write('usage: report.ts <run-dir> [warmup-seconds]\n');
    process.exit(2);
  }
  const warmupMs = Number(warmupArg ?? 0) * 1000;
  const records: AnyRecord[] = fs
    .readFileSync(path.join(runDir, 'records.jsonl'), 'utf8')
    .split('\n')
    .filter((l) => l.startsWith('{'))
    .map((l) => JSON.parse(l));

  const reqs = records.filter((r): r is Req => r.k === 'req' && (r as Req).g !== 'setup');
  const health = records.filter((r): r is Health => r.k === 'health');
  if (reqs.length === 0) {
    process.stdout.write('no request records\n');
    return;
  }
  const t0 = Math.min(...records.map((r) => r.t));
  const tEnd = Math.max(...reqs.map((r) => r.t));
  const measured = reqs.filter((r) => r.t >= t0 + warmupMs);
  const windowS = (tEnd - (t0 + warmupMs)) / 1000;

  writeCsv(
    path.join(runDir, 'summary.csv'),
    ['group', ...STATS_HEADER],
    [...groupBy(measured, (r) => r.g)].sort().map(([g, list]) => [g, ...stats(list, windowS)])
  );
  writeCsv(
    path.join(runDir, 'endpoints.csv'),
    ['group', 'endpoint', ...STATS_HEADER],
    [...groupBy(measured, (r) => `${r.g}\t${r.n}`)].sort().map(([k, list]) => [...k.split('\t'), ...stats(list, windowS)])
  );

  // Every distinct failure, counted — the raw material of a defect report.
  const failures = groupBy(
    reqs.filter((r) => r.o !== 'ok'),
    (r) => [r.g, r.n, r.s, r.o, r.c ?? '', r.x ?? '', r.msg ?? ''].join('\t')
  );
  writeCsv(
    path.join(runDir, 'errors.csv'),
    ['group', 'endpoint', 'status', 'outcome', 'code', 'transport_error', 'message', 'count', 'first_at_s', 'last_at_s'],
    [...failures]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([k, list]) => [
        ...k.split('\t'),
        list.length,
        fmt((Math.min(...list.map((r) => r.t)) - t0) / 1000),
        fmt((Math.max(...list.map((r) => r.t)) - t0) / 1000),
      ])
  );

  const generations = records.filter((r): r is Generate => r.k === 'generate');
  if (generations.length > 0) {
    const ms = generations.map((g) => g.ms).sort((a, b) => a - b);
    const by = groupBy(generations, (g) => `${g.state}\t${g.engine}\t${g.degraded}\t${g.degradedReason ?? ''}`);
    writeCsv(
      path.join(runDir, 'generate.csv'),
      ['state', 'engine', 'degraded', 'degraded_reason', 'runs', 'p50_ms', 'p95_ms', 'max_ms'],
      [...by].map(([k, list]) => {
        const sorted = list.map((g) => g.ms).sort((a, b) => a - b);
        return [...k.split('\t'), list.length, percentile(sorted, 50), percentile(sorted, 95), sorted[sorted.length - 1]];
      })
    );
    process.stdout.write(`generate: ${generations.length} runs, p50 ${percentile(ms, 50)} ms\n`);
  }

  const races = records.filter((r): r is Race => r.k === 'race');
  if (races.length > 0) {
    writeCsv(
      path.join(runDir, 'race.csv'),
      ['round', 'kind', 'concurrent', 'requests', 'created', 'expected', 'reproduced', 'statuses'],
      races.map((r) => [
        r.round,
        r.kind,
        r.concurrent,
        r.results.length,
        r.created,
        1,
        r.created > 1,
        r.results.map((x) => `${x.status}${x.code ? `:${x.code}` : ''}`).join(' '),
      ])
    );
  }

  // Per-second timeline over the whole run (warm-up included).
  const seconds = groupBy(reqs, (r) => String(Math.floor((r.t - t0) / 1000)));
  const healthBySecond = groupBy(health, (h) => String(Math.floor((h.t - t0) / 1000)));
  const lastSecond = Math.floor((tEnd - t0) / 1000);
  const timeline: unknown[][] = [];
  for (let s = 0; s <= lastSecond; s++) {
    const list = seconds.get(String(s)) ?? [];
    const h = (healthBySecond.get(String(s)) ?? []).slice(-1)[0];
    const durations = list.filter((r) => r.s !== 0).map((r) => r.d).sort((a, b) => a - b);
    timeline.push([
      s,
      list.length,
      list.filter((r) => r.o === 'ok').length,
      list.filter((r) => r.o === 'rejected').length,
      list.filter((r) => r.o === 'error').length,
      list.filter(isTimeout).length,
      fmt(percentile(durations, 95)),
      h ? h.s : '',
      h ? h.status ?? '' : '',
      h ? h.database ?? '' : '',
      h ? h.redis ?? '' : '',
    ]);
  }
  writeCsv(
    path.join(runDir, 'timeline.csv'),
    ['second', 'requests', 'ok', 'rejected', 'errors', 'timeouts', 'p95_ms', 'health_http', 'health_status', 'health_database', 'health_redis'],
    timeline
  );

  const eventsFile = path.join(runDir, 'events.csv');
  if (fs.existsSync(eventsFile)) chaosTable(runDir, eventsFile, reqs, health, t0);
  process.stdout.write(fs.readFileSync(path.join(runDir, 'summary.csv'), 'utf8'));
}

/**
 * One row per fault injected. The outage window runs from the `down` event to
 * the `up` event; recovery is measured from `up` to the first second that
 * starts five consecutive seconds with a 200 health answer and no request
 * errors — five, so that a single lucky request does not count as recovered.
 */
function chaosTable(runDir: string, eventsFile: string, reqs: Req[], health: Health[], t0: number): void {
  const events = fs
    .readFileSync(eventsFile, 'utf8')
    .split('\n')
    .slice(1)
    .filter(Boolean)
    .map((l) => {
      const [t, phase, action] = l.split(',');
      return { t: Number(t), phase, action };
    });
  const rows: unknown[][] = [];
  for (const [phase, list] of groupBy(events, (e) => e.phase)) {
    const down = list.find((e) => e.action === 'down');
    const up = list.find((e) => e.action === 'up');
    if (!down || !up) continue;
    const inOutage = reqs.filter((r) => r.t >= down.t && r.t < up.t);
    const healthInOutage = health.filter((h) => h.t >= down.t && h.t < up.t);
    const firstDegraded = healthInOutage.find((h) => h.s !== 200 || h.database !== 'connected' || (h.redis !== null && h.redis !== 'connected'));
    let recoveredAt: number | null = null;
    for (let s = up.t; s < up.t + 300_000 && recoveredAt === null; s += 1000) {
      let clean = true;
      for (let w = 0; w < 5 && clean; w++) {
        const from = s + w * 1000;
        const hs = health.filter((h) => h.t >= from && h.t < from + 1000);
        const rs = reqs.filter((r) => r.t >= from && r.t < from + 1000);
        clean = hs.length > 0 && hs.every((h) => h.s === 200) && rs.every((r) => r.o !== 'error');
      }
      if (clean) recoveredAt = s;
    }
    const after = reqs.filter((r) => recoveredAt !== null && r.t >= recoveredAt && r.t < recoveredAt + 30_000);
    const outageDurations = inOutage.filter((r) => r.s !== 0).map((r) => r.d).sort((a, b) => a - b);
    rows.push([
      phase,
      fmt((down.t - t0) / 1000),
      fmt((up.t - down.t) / 1000),
      // Session throughput just before the fault against during it: a
      // dependency whose loss stalls requests shows here even when every
      // stalled request eventually succeeds.
      fmt(reqs.filter((r) => r.g !== 'health' && r.t >= down.t - 10_000 && r.t < down.t).length / 10),
      fmt(inOutage.filter((r) => r.g !== 'health').length / Math.max((up.t - down.t) / 1000, 1e-9)),
      inOutage.length,
      inOutage.filter((r) => r.o === 'error').length,
      inOutage.filter((r) => r.o === 'ok').length,
      inOutage.filter(isTimeout).length,
      inOutage.filter(isEnvelopeViolation).length,
      fmt(outageDurations.length ? outageDurations[outageDurations.length - 1] : 0),
      [...new Set(inOutage.filter((r) => r.o === 'error').map((r) => `${r.s}:${r.c ?? 'none'}`))].join(' '),
      firstDegraded ? fmt((firstDegraded.t - down.t) / 1000) : '',
      [...new Set(healthInOutage.map((h) => `${h.s}/${h.status ?? '-'}/db=${h.database ?? '-'}/redis=${h.redis ?? '-'}`))].join(' '),
      recoveredAt === null ? '' : fmt((recoveredAt - up.t) / 1000),
      fmt(after.length ? after.filter((r) => r.o === 'error').length / after.length : 0),
    ]);
  }
  writeCsv(
    path.join(runDir, 'chaos.csv'),
    [
      'phase', 'down_at_s', 'outage_s', 'rps_10s_before', 'rps_in_outage', 'requests_in_outage', 'errors_in_outage', 'ok_in_outage', 'timeouts_in_outage',
      'envelope_violations_in_outage', 'max_latency_in_outage_ms', 'error_kinds', 'health_degraded_after_s',
      'health_answers_in_outage', 'recovery_after_up_s', 'error_rate_30s_after_recovery',
    ],
    rows
  );
}

main();
