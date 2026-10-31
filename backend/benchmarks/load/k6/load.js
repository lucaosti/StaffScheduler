/**
 * Mixed workload (#958): N concurrent sessions — the administrator, scoped
 * managers and employees of the demo seed — each running the actions its role
 * performs in the product, plus a fixed-rate health probe.
 *
 * Closed model: every virtual user is one session that acts, thinks for
 * THINK_MS (uniformly 0.5x–1.5x), and acts again. Throughput is therefore an
 * outcome of the latency, not an input; that is what "N people using the
 * system" means, and what the numbers in methodology.md are read as. An
 * open-model (arrival-rate) run would measure a different thing — saturation
 * under a fixed offered load — and is left to a larger environment.
 *
 * WHERE WRITES GO, AND WHY. Managers add people to PUBLISHED schedules and the
 * administrator regenerates DRAFT ones. Regenerating a draft legitimately
 * replaces that draft's assignments, so an assignment written into a draft
 * could vanish for a correct reason and the lost-write check would report a
 * false positive. Keeping the two apart makes "a 201 whose row is gone" an
 * unambiguous defect.
 *
 * Every successful write and every decision is also written to the ledger
 * (k: 'write' / k: 'decision' lines) that check/invariants.ts reconciles
 * against MySQL after the run.
 *
 * Knobs (environment): VUS, DURATION, THINK_MS, MANAGER_SHARE, HEALTH_RPS,
 * GENERATE_EVERY_S, GENERATE_TIMEOUT_S, REQUEST_TIMEOUT, BASE_URL.
 *
 * @author Luca Ostinelli
 */

import { sleep } from 'k6';
import exec from 'k6/execution';
import { call, dataOf, emit, envFloat, envInt, isoDay, login, pick, roleFor } from './lib.js';

const VUS = envInt('VUS', 10);
const DURATION = __ENV.DURATION || '2m';
const THINK_MS = envInt('THINK_MS', 300);
const MANAGER_SHARE = envFloat('MANAGER_SHARE', 0.25);
const HEALTH_RPS = envInt('HEALTH_RPS', 2);
const GENERATE_EVERY_S = envInt('GENERATE_EVERY_S', 30);
const GENERATE_TIMEOUT_S = envInt('GENERATE_TIMEOUT_S', 120);

export const options = {
  scenarios: {
    sessions: { executor: 'constant-vus', vus: VUS, duration: DURATION, gracefulStop: '30s', exec: 'session' },
    health: {
      executor: 'constant-arrival-rate',
      rate: HEALTH_RPS,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 4,
      maxVUs: 40,
      exec: 'health',
    },
  },
  noCookiesReset: true,
  // Thresholds are not the verdict (report.ts and invariants.ts are); k6's
  // own summary is kept for a human glance at the console.
  summaryTrendStats: ['avg', 'p(50)', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  emit({ k: 'meta', t: Date.now(), scenario: 'load', vus: VUS, duration: DURATION, thinkMs: THINK_MS });
}

// Per-VU state. Module scope lives for the VU's whole life in k6, so it is
// the session, not a per-iteration value.
let me = null;
let identity = null;
const cache = {};
let lastGenerateAt = 0;

const think = () => sleep((THINK_MS * (0.5 + Math.random())) / 1000);

function ensureSession() {
  if (me) return true;
  // The role slot comes from the scenario's iteration counter, not the VU id:
  // k6 numbers VUs across all scenarios, so the health probe's VUs can take
  // any ids and `idInTest` would leave gaps (or no administrator at all).
  // Every session VU starts its first iteration at t=0 and that iteration
  // includes a login, so the first VUS iteration numbers land one per VU.
  if (!identity) identity = roleFor((exec.scenario.iterationInTest % VUS) + 1, VUS, MANAGER_SHARE);
  me = login(identity.email);
  if (!me) {
    sleep(1);
    return false;
  }
  emit({ k: 'session', t: Date.now(), vu: exec.vu.idInTest, role: identity.role, email: identity.email, userId: me.userId });
  return true;
}

function departments() {
  if (!cache.departments) {
    const data = dataOf(call('GET', '/departments', null, 'read', 'GET /departments'));
    if (data) cache.departments = data;
  }
  return cache.departments || [];
}

function myDepartmentId() {
  const name = identity.managesDepartment || identity.departments[0];
  const dept = departments().find((d) => d.name === name);
  return dept ? dept.id : null;
}

function schedulesByStatus(departmentId, status) {
  const key = `sched:${departmentId}:${status}`;
  if (!cache[key]) {
    const q = departmentId ? `departmentId=${departmentId}&status=${status}` : `status=${status}`;
    const data = dataOf(call('GET', `/schedules?${q}&pageSize=50`, null, 'read', 'GET /schedules?status'));
    if (data) cache[key] = data;
  }
  return cache[key] || [];
}

// ── Employee ────────────────────────────────────────────────────────────────

function employeeReads() {
  call('GET', '/dashboard/stats', null, 'read', 'GET /dashboard/stats');
  call('GET', `/assignments/user/${me.userId}`, null, 'read', 'GET /assignments/user/:id');
  call('GET', `/schedules/user/${me.userId}`, null, 'read', 'GET /schedules/user/:id');
  call('GET', '/notifications', null, 'read', 'GET /notifications');
}

function requestTimeOff() {
  // Far enough ahead to stay clear of the seeded schedules, short enough to
  // look like real leave. Overlapping pending requests are allowed by the API.
  const start = 60 + Math.floor(Math.random() * 300);
  const r = call(
    'POST',
    '/time-off',
    { startDate: isoDay(start), endDate: isoDay(start + Math.floor(Math.random() * 3)), type: 'vacation', reason: 'load test' },
    'write',
    'POST /time-off'
  );
  const data = dataOf(r);
  if (data) emit({ k: 'write', t: Date.now(), entity: 'time_off_request', id: data.id, userId: me.userId });
}

function requestSwap() {
  const mine = dataOf(call('GET', `/assignments/user/${me.userId}`, null, 'read', 'GET /assignments/user/:id')) || [];
  const today = isoDay(0);
  const future = mine.filter((a) => a.status !== 'cancelled' && String(a.shiftDate).slice(0, 10) > today);
  if (future.length === 0) return;
  const own = pick(future);
  const found = dataOf(call('GET', `/assignments/${own.id}/swap-candidates`, null, 'read', 'GET /assignments/:id/swap-candidates'));
  if (!found || !found.candidates || found.candidates.length === 0) return;
  const target = pick(found.candidates);
  const r = call(
    'POST',
    '/shift-swap',
    { requesterAssignmentId: own.id, targetAssignmentId: target.assignmentId, notes: 'load test' },
    'write',
    'POST /shift-swap'
  );
  const data = dataOf(r);
  if (data) emit({ k: 'write', t: Date.now(), entity: 'shift_swap_request', id: data.id, userId: me.userId });
}

function answerSwaps() {
  const swaps = dataOf(call('GET', '/shift-swap', null, 'read', 'GET /shift-swap')) || [];
  const incoming = swaps.filter((s) => s.targetUserId === me.userId && s.status === 'pending_target');
  if (incoming.length === 0) return;
  const swap = pick(incoming);
  call('POST', `/shift-swap/${swap.id}/respond`, { accepted: Math.random() < 0.7 }, 'decision', 'POST /shift-swap/:id/respond');
}

function employeeIteration() {
  const roll = Math.random();
  if (roll < 0.5) employeeReads();
  else if (roll < 0.7) requestTimeOff();
  else if (roll < 0.85) requestSwap();
  else answerSwaps();
}

// ── Manager ─────────────────────────────────────────────────────────────────

function managerReads(deptId) {
  const page = 1 + Math.floor(Math.random() * 3);
  call('GET', '/dashboard/stats', null, 'read', 'GET /dashboard/stats');
  call('GET', '/dashboard/attention-items', null, 'read', 'GET /dashboard/attention-items');
  call('GET', `/schedules?page=1&pageSize=20`, null, 'read', 'GET /schedules?page');
  call('GET', `/shifts?departmentId=${deptId}&page=${page}&pageSize=20`, null, 'read', 'GET /shifts?page');
  call('GET', `/employees?department=${deptId}&page=1&pageSize=20`, null, 'read', 'GET /employees?page');
  call('GET', `/assignments?departmentId=${deptId}&page=${page}&pageSize=20`, null, 'read', 'GET /assignments?page');
  call('GET', '/time-off', null, 'read', 'GET /time-off');
}

function decide() {
  const list = dataOf(call('GET', '/pending-approvals', null, 'read', 'GET /pending-approvals'));
  const items = list && list.items ? list.items.filter((i) => i.status === 'pending') : [];
  if (items.length === 0) return;
  // The head of the queue, not a random item: two VUs playing the same
  // manager then reach for the same approval, which is the contention a
  // "decided twice" defect needs in order to show.
  const item = items[Math.floor(Math.random() * Math.min(2, items.length))];
  const decision = Math.random() < 0.7 ? 'approved' : 'rejected';
  const verb = decision === 'approved' ? 'approve' : 'reject';
  const r = call('POST', `/pending-approvals/${item.id}/${verb}`, { note: 'load test' }, 'decision', `POST /pending-approvals/:id/${verb}`);
  emit({
    k: 'decision',
    t: Date.now(),
    pendingApprovalId: item.id,
    entityType: item.targetEntityType,
    entityId: item.targetEntityId,
    decision,
    status: r.status,
    outcome: r.outcome,
    userId: me.userId,
  });
}

function assign(deptId) {
  const published = schedulesByStatus(deptId, 'published');
  if (published.length === 0) return;
  const schedule = pick(published);
  const from = isoDay(1);
  const shifts =
    dataOf(call('GET', `/shifts?scheduleId=${schedule.id}&startDate=${from}&pageSize=50`, null, 'read', 'GET /shifts?scheduleId')) || [];
  const open = shifts.filter((s) => s.assignedStaff < s.maxStaff && s.status !== 'cancelled');
  if (open.length === 0) return;
  if (!cache.staff) {
    const staff = dataOf(call('GET', `/employees?department=${deptId}&pageSize=50`, null, 'read', 'GET /employees?page'));
    if (staff) cache.staff = staff;
  }
  if (!cache.staff || cache.staff.length === 0) return;
  const shift = pick(open);
  const user = pick(cache.staff);
  const r = call('POST', '/assignments', { shiftId: shift.id, userId: user.id, notes: 'load test' }, 'write', 'POST /assignments');
  const data = dataOf(r);
  if (data) emit({ k: 'write', t: Date.now(), entity: 'shift_assignment', id: data.id, shiftId: shift.id, userId: user.id });
}

function managerIteration() {
  const deptId = myDepartmentId();
  if (!deptId) return;
  const roll = Math.random();
  if (roll < 0.45) managerReads(deptId);
  else if (roll < 0.75) decide();
  else assign(deptId);
}

// ── Administrator ───────────────────────────────────────────────────────────

function adminReads() {
  const page = 1 + Math.floor(Math.random() * 4);
  call('GET', '/dashboard/stats', null, 'read', 'GET /dashboard/stats');
  call('GET', `/employees?page=${page}&pageSize=20`, null, 'read', 'GET /employees?page');
  call('GET', `/shifts?page=${page}&pageSize=50`, null, 'read', 'GET /shifts?page');
  call('GET', `/assignments?page=${page}&pageSize=50`, null, 'read', 'GET /assignments?page');
  call('GET', `/audit-logs?page=1&pageSize=20`, null, 'read', 'GET /audit-logs?page');
}

/**
 * One generation, measured end to end: the 202 is a queue receipt, so the
 * time a planner waits is enqueue-to-completed, polled once a second. That
 * span is recorded as its own pseudo-endpoint in the `generate` group; the
 * poll requests themselves are reads.
 */
function generate() {
  const drafts = schedulesByStatus(null, 'draft');
  if (drafts.length === 0) return;
  const schedule = pick(drafts);
  const started = Date.now();
  const r = call('POST', `/schedules/${schedule.id}/generate`, null, 'generate', 'POST /schedules/:id/generate');
  if (r.status !== 202 && r.status !== 200) return;
  let state = r.status === 200 ? 'completed' : 'queued';
  let result = r.status === 200 ? dataOf(r) : null;
  while (state !== 'completed' && state !== 'failed' && Date.now() - started < GENERATE_TIMEOUT_S * 1000) {
    sleep(1);
    const status = dataOf(call('GET', `/schedules/${schedule.id}/optimization`, null, 'read', 'GET /schedules/:id/optimization'));
    if (status) {
      state = status.state;
      result = status.result || null;
    }
  }
  emit({
    k: 'generate',
    t: started,
    scheduleId: schedule.id,
    state,
    ms: Date.now() - started,
    engine: result ? result.engine : null,
    degraded: result ? result.degraded : null,
    degradedReason: result ? result.degradedReason || null : null,
    assignmentsCreated: result ? result.assignmentsCreated : null,
  });
}

function adminIteration() {
  if (GENERATE_EVERY_S > 0 && Date.now() - lastGenerateAt > GENERATE_EVERY_S * 1000) {
    lastGenerateAt = Date.now();
    generate();
  } else {
    adminReads();
  }
}

export function session() {
  if (!ensureSession()) return;
  if (identity.role === 'admin') adminIteration();
  else if (identity.role === 'manager') managerIteration();
  else employeeIteration();
  think();
}

export function health() {
  const t = Date.now();
  const r = call('GET', '/health', null, 'health', 'GET /health');
  const data = r.json && r.json.data ? r.json.data : null;
  emit({
    k: 'health',
    t,
    s: r.status,
    status: data ? data.status : null,
    database: data && data.services ? data.services.database : null,
    redis: data && data.services ? data.services.redis || null : null,
  });
}
