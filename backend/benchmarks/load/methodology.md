# Load, concurrency and chaos harness — methodology

The harness behind #958. It drives concurrent authenticated sessions through
the real API, injects dependency outages while they run, and then checks the
database for the states no amount of load may produce. Its numbers feed
`backend/benchmarks/performance.md`; this file says how each one is measured,
so a figure there can be read without re-reading the scripts.

## Layout

| Path | Role |
|---|---|
| `run.sh` | Scenario driver: `load`, `race`, `chaos`, `all`, `down`. All knobs are environment variables listed in its header. |
| `driver-compose.sh` + `compose.yml` | Runtime driver for a Docker host (workstation, CI). Default. |
| `driver-instances.sh` | Runtime driver for a host without a Docker daemon: Singularity/Apptainer instances on the loopback interface. `LOAD_DRIVER=instances`. |
| `k6/lib.js` | Credentials from the demo seed, session login, the per-request record. |
| `k6/load.js` | The mixed workload and the health probe. |
| `k6/race.js` | The #829 race and its two controls. |
| `check/invariants.ts` | Post-run invariants, directly in MySQL. |
| `check/report.ts` | Records → CSV tables. |

Both drivers run the same scenarios with the same images (MySQL 8.4.11,
Redis 7.4, nginx 1.27, k6 1.3.0, the backend built from this tree), so a run
on a workstation and a large run on a batch node differ only in scale and in
the points listed in `driver-instances.sh` (no per-service CPU caps there, a
static nginx upstream instead of Docker DNS, and an image that has the CP-SAT
solver).

## Topology

`k6 → nginx (ops/nginx/backend-lb.conf directives) → N backend replicas →
MySQL + Redis`. The load always goes through the load balancer, even with one
replica, so the request path does not change between a one-replica and an
N-replica run. The backend trusts two proxy hops and k6 sends one
`X-Forwarded-For` address per session: N sessions are N clients, as N users
would be, instead of one address sharing the IP-keyed login limiter.

The per-caller and per-organization rate limits are raised (`LOAD_RATE_LIMIT_*`)
so the handlers are measured rather than the limiter. At its defaults the
organization budget (2000 requests/min) caps the whole demo tenant at about
33 requests/s; set `LOAD_RATE_LIMIT_ORG_MAX=2000` to measure that ceiling
instead — 429s are reported in their own column (`throttled`).

## Sessions and workload (`k6/load.js`)

Closed model: each virtual user is one long-lived session (cookie jar kept
across iterations) that performs one action of its role, then thinks for
`THINK_MS` × U(0.5, 1.5). Throughput is an outcome, not an input.

- **Roles.** Slot 1 is the administrator; `MANAGER_SHARE` of the rest are
  managers (cycling through the three seeded ones, so several sessions share a
  manager and contend for the same approvals); the rest are employees, those of
  a managed department first. Credentials come only from the demo seed:
  emails from `scripts/fixtures/demo/data.json`, the password from the
  `DEMO_PASSWORD` constant of `scripts/seed-demo.ts`.
- **Employee:** 50 % reads (dashboard, own assignments, own schedules,
  notifications); 20 % time-off request; 15 % swap request (own future
  assignment → swap candidates → `POST /shift-swap`); 15 % answer an incoming
  swap.
- **Manager:** 45 % reads (dashboard, attention items, paginated schedules,
  shifts, employees and assignments, time-off list); 30 % decision on one of
  the two oldest pending approvals (70 % approve, `POST /pending-approvals/:id/…`);
  25 % add a department member to an open shift of a **published** schedule.
- **Administrator:** paginated reads across the organization, and every
  `GENERATE_EVERY_S` one generation of a **draft** schedule, polled to
  completion.

Writes go to published schedules and generation to drafts because
regenerating a draft legitimately replaces its assignments; mixing the two
would make the lost-write check report correct deletions.

## What is measured, and how

**Clock.** Every record carries the k6 process's wall clock at send time, in
ms. Fault events are stamped by `run.sh` on the same host's clock (ms with GNU
date, 1 s on macOS, where the Docker VM clock follows the host's); outage
windows are tens of seconds, so the quantum does not move a request across a
window boundary in any way that matters.

**Latency** is k6's `http_req_duration` — sending + waiting + receiving,
connection set-up excluded — so a refused connection is an error with
near-zero latency rather than a sample that drags the percentiles. Percentiles
are exact nearest-rank order statistics over all completed responses of the
group in the measured window; the sample count is beside them in every CSV.

**Throughput** is completed requests ÷ measured window (first record after
warm-up to the last record), per group.

**Warm-up.** Records sent in the first `WARMUP_S` seconds (logins, cold pools,
JIT, empty caches) are excluded from `summary.csv` and `endpoints.csv` and kept
everywhere else.

**Outcomes**, decided per response by `k6/lib.js`:

| Outcome | Meaning |
|---|---|
| `ok` | 2xx with a valid envelope |
| `rejected` | 4xx business answer with a valid envelope (409, 404, 400, 403) — expected under contention |
| `throttled` | 429 |
| `error` | 5xx, transport failure, timeout (`REQUEST_TIMEOUT`, default 15 s), 401, or any response breaking the envelope contract |

`error_rate` = errors ÷ requests. `envelope_violations` counts responses that
arrived without `{success, error.code}` (an nginx HTML 502, an empty body);
`timeouts` counts requests that got no answer in time — a hang.

**Generation** (`generate.csv`) is measured end to end, enqueue to `completed`,
polled once a second; the table records which engine ran and whether it
degraded.

## The #829 race (`k6/race.js`)

Per round, on fixtures created through the API in a draft schedule 400+ days
ahead (rounds nine days apart, wider than the 7-day weekly-hours window):

1. `overlap-sequential` — K overlapping shifts posted one at a time for one
   person. Must give exactly one 201: proves the overlap check exists.
2. `overlap-concurrent` — K overlapping shifts posted at once (`http.batch`, K
   parallel connections) for another person. Exactly one 201 is correct; more
   is the double booking. `race.csv` marks the round `reproduced`.
3. `capacity-control` — K different people posted at once onto one shift with
   `max_staff = 1`. That path locks the shift row; exactly one 201 shows the
   harness distinguishes a serialized path from an unserialized one.

## Chaos (`run.sh chaos`)

Load runs throughout (`REPLICAS=2` by default). After `WARMUP_S`, each target
in `CHAOS_TARGETS` goes down for `CHAOS_HOLD_S`, comes back, and is observed
for `CHAOS_RECOVER_S`: `db` (MySQL), `redis`, `replica` (the last backend
replica; the load balancer must keep serving from the others). `CHAOS_MODE`
is `stop` (SIGTERM), `kill` (SIGKILL) or `pause` (SIGSTOP — the peer keeps its
connections and never answers, the hardest case for timeouts).

A 2-per-second health probe runs alongside. `chaos.csv` has one row per fault:
requests, errors, timeouts and envelope violations inside the outage, the
error kinds seen, the health answers seen, how long after the fault health
reported degradation, recovery time (from the `up` event to the first of five
consecutive seconds with a 200 health answer and no request error), and the
error rate in the 30 s after recovery. A backend process crash is a restart
counted in `containers.csv` (compose's `RestartCount`; the instance driver's
restart loop appends to `exits.csv`) — the #825 signal.

## Invariants (`check/invariants.ts`)

Taken once after seeding (baseline) and once after the run; only what the run
**added** fails, because the hand-written seed does not satisfy every rule
(it double-books its administrator across two departments, and its published
schedules break the rest rules the validator checks).

| Check | Definition |
|---|---|
| `double-booking` | two live assignments of one person overlapping in absolute time, using the API's own predicate (`SHIFT_ABS_END_SQL`, overnight-aware) |
| `validator` | every non-archived schedule's live assignments through `findConstraintViolations`, on the problem `AutoScheduleInputLoader` builds |
| `decided-twice` | more than one final decision per entity in the audit trail, more than one unavailability row per time-off request, or a workflow step decided twice |
| `decision-effect` | a decided approval whose entity is still pending with no later step, or carries the opposite outcome |
| `lost-write` | a create acknowledged with 2xx whose row is gone, or a 2xx decision the database does not hold |
| `decided-twice (acknowledged)` | one pending approval acknowledged with 2xx more than once |

`invariants.json` holds the offending rows — the evidence a defect report
quotes.

## Running

```bash
# Workstation (Docker); at most ~20 sessions in an 8 GB VM.
VUS=10 DURATION=3m backend/benchmarks/load/run.sh load
backend/benchmarks/load/run.sh race
VUS=10 backend/benchmarks/load/run.sh chaos
CHAOS_MODE=pause VUS=10 backend/benchmarks/load/run.sh chaos

# A host without Docker: images as files, repository installed and built.
LOAD_DRIVER=instances TOOLCHAIN_SIF=… MYSQL_SIF=… REDIS_SIF=… NGINX_SIF=… K6_SIF=… \
  LOAD_PORT_BASE=32000 VUS=40 backend/benchmarks/load/run.sh load
```

Results land in `results/<scenario>-<timestamp>/` (git-ignored); `run.env`
records every knob, the commit and the CPUs/memory available, so a figure is
never transcribed without its configuration.
