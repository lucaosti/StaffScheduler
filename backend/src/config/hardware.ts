/**
 * Hardware-aware defaults for concurrency/pool-size settings.
 *
 * WHY THIS EXISTS. `DB_POOL_LIMIT`, `DB_QUEUE_LIMIT`, and the simulation
 * harness's actor concurrency were all fixed constants, independent of the
 * machine running them — the same numbers whether the process runs on a
 * Raspberry Pi or a datacenter Xeon. That under-uses large hardware and
 * over-commits small hardware, and correcting it required manually tuning
 * env vars per deployment. This derives a sensible default from the
 * detected hardware instead, so the same image/code self-tunes; an explicit
 * env var still always wins (see config/index.ts's `parseInt(... || X)`
 * call sites), so no deployment that already sets these is affected.
 *
 * WHY `os.availableParallelism()` AND NOT `os.cpus().length`. Mirrors the
 * exact reasoning already applied on the Python side
 * (`optimization-scripts/schedule_optimizer.py`'s `num_search_workers`):
 * inside a container with a CPU quota (Docker `--cpus`, a Kubernetes
 * `resources.limits.cpu`), `os.cpus().length` reports the HOST's physical
 * core count, not the quota — "all visible cores" can be a large overcommit
 * on a shared host. `os.availableParallelism()` (Node >=18.15/19.4, stable
 * since Node 20) correctly reflects the cgroup quota when running inside
 * one, and falls back to the host's core count outside a container — the
 * same value either way this project's own Dockerfiles produce, since
 * `node:22-alpine` ships a Node new enough for it.
 *
 * WHY A CAP RATHER THAN THE RAW VALUE. Again mirroring the Python side's
 * cap of 8: past a certain point, more connections/actors do not linearly
 * buy more throughput — MySQL's own connection-handling overhead and lock
 * contention grow instead, and a huge pool on a huge machine can starve
 * *other* processes sharing it (the API itself, in the pool-size case).
 * The caps below are deliberately conservative defaults; anyone who has
 * profiled their own deployment and wants more sets the env var — this
 * function is the estimate for whoever has not.
 *
 * @author Luca Ostinelli
 */

import * as os from 'os';

/**
 * Detected parallelism, floored at 1 (a value of 0 or negative would make
 * every derived default nonsensical; `availableParallelism()` should never
 * return that, but nothing about the platform API guarantees it).
 */
export function detectedParallelism(): number {
  return Math.max(1, os.availableParallelism());
}

/**
 * Default MySQL connection pool size: 4 connections per detected core,
 * bounded to [5, 60]. The floor keeps a single-core box (a Pi, a small VM)
 * from being limited to a pool too small to serve concurrent requests at
 * all; the ceiling is the same order of magnude as the pre-existing fixed
 * default (30) this replaces, so a very large machine gets meaningfully
 * more headroom without the pool itself becoming the next bottleneck.
 */
export function defaultDbPoolLimit(): number {
  return clamp(detectedParallelism() * 4, 5, 60);
}

/** Default MySQL pool queue limit: proportional to the pool size — the
 *  same ratio (100/30 ≈ 3.3x) the fixed defaults this replaces already
 *  used, so callers who only look at the ratio see no behavior change. */
export function defaultDbQueueLimit(): number {
  return Math.round(defaultDbPoolLimit() * (100 / 30));
}

/**
 * Default simulation-actor concurrency: 3 actors per detected core, bounded
 * to [4, 48]. Actors are I/O-bound (mostly awaiting DB round-trips or, with
 * --transport=mixed, HTTP calls into the in-process app), so more actors
 * than cores is expected and useful — unlike CPU-bound work, this isn't
 * capped at core count. The ceiling still exists because past it, actor
 * contention on the same rows (the deliberate concurrency stress this
 * harness is for) stops adding coverage and starts just adding wall-clock.
 */
export function defaultSimulationConcurrency(): number {
  return clamp(detectedParallelism() * 3, 4, 48);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
