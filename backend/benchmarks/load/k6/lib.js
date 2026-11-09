/**
 * Shared plumbing for the k6 scenarios (#958): credentials from the demo seed,
 * one authenticated session per virtual user, and a request wrapper that
 * classifies every response and writes one JSON line per request.
 *
 * WHY ONE LINE PER REQUEST INSTEAD OF k6's OWN SUMMARY. k6's end-of-test
 * summary aggregates per metric, but the questions asked of a run are per
 * operation group, per endpoint, per second of a chaos timeline, and "did this
 * write land in MySQL". All of them are answered from the same record, so the
 * record is written once (k6 --console-output, raw format) and
 * check/report.ts derives every table from it. Percentiles are therefore exact
 * order statistics over the recorded durations, not a streaming estimate.
 *
 * WHY CREDENTIALS ARE READ FROM THE SEED FILES. The demo seed is the one place
 * that defines who exists and with which password; a copy here would drift the
 * day the seed changes. The emails come from fixtures/demo/data.json and the
 * password from the `DEMO_PASSWORD` constant in seed-demo.ts, both mounted
 * read-only by compose.yml. A seed the regex cannot read fails the run at init
 * rather than producing a run of 401s.
 *
 * @author Luca Ostinelli
 */

import http from 'k6/http';
import exec from 'k6/execution';

const SEED = JSON.parse(open('/seed/data.json'));
const PASSWORD_MATCH = /const DEMO_PASSWORD = '([^']+)'/.exec(open('/seed/seed-demo.ts'));
if (!PASSWORD_MATCH) throw new Error('DEMO_PASSWORD not found in seed-demo.ts — the seed changed shape');
const PASSWORD = PASSWORD_MATCH[1];

export const BASE = __ENV.BASE_URL || 'http://lb/api/v1';
// A request that has not completed by then is recorded as a timeout (status 0):
// the chaos run asserts failures are prompt envelopes, and a hang must show up
// as a hang rather than as an arbitrarily long latency sample.
const TIMEOUT = __ENV.REQUEST_TIMEOUT || '15s';

export const SEED_USERS = SEED.users.map((u) => ({
  email: u.email,
  role: u.role,
  departments: u.departments || [],
  managesDepartment: u.managesDepartment || null,
}));

export const envInt = (name, fallback) => {
  const v = parseInt(__ENV[name] || '', 10);
  return Number.isFinite(v) ? v : fallback;
};
export const envFloat = (name, fallback) => {
  const v = parseFloat(__ENV[name] || '');
  return Number.isFinite(v) ? v : fallback;
};

export const pick = (list) => list[Math.floor(Math.random() * list.length)];
export const isoDay = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

/**
 * A distinct client address per virtual user. The stack trusts two proxy hops
 * (compose.yml), so this header is what the backend sees as the caller —
 * N sessions behave as N users rather than as one address sharing the
 * IP-keyed login limiter.
 */
const clientIp = () => {
  const n = exec.vu.idInTest;
  return `10.77.${(n >> 8) & 255}.${n & 255}`;
};

/** Writes one raw JSON line to the console-output file. */
export const emit = (record) => console.log(JSON.stringify(record));

/**
 * The response contract every endpoint must honour (DOCUMENTATION.md §4): JSON with a
 * boolean `success`, and on failure an `error.code`. Anything else — an nginx
 * HTML 502, an empty body, a truncated stream — is an envelope violation.
 */
const parseEnvelope = (res) => {
  let body = null;
  try {
    body = res.json();
  } catch {
    return { body: null, envelope: false, code: null };
  }
  if (!body || typeof body.success !== 'boolean') return { body, envelope: false, code: null };
  if (body.success) return { body, envelope: true, code: null };
  const code = body.error && typeof body.error.code === 'string' ? body.error.code : null;
  return { body, envelope: code !== null, code };
};

const messageOf = (json, raw) => {
  if (json && json.error && typeof json.error.message === 'string') return json.error.message.slice(0, 160);
  return typeof raw === 'string' && raw.length > 0 ? raw.slice(0, 160) : null;
};

/**
 * Outcome classes, decided per response:
 *   ok        2xx
 *   rejected  a 4xx business answer with a valid envelope (409 conflict, 404,
 *             400 validation) — expected under contention, not an error
 *   throttled 429 — reported apart: it is the limiter, not the handler
 *   error     5xx, a transport failure or timeout (status 0), 401 (a session
 *             that should be valid), or any response breaking the envelope
 */
const classify = (status, envelope) => {
  if (status >= 200 && status < 300) return envelope ? 'ok' : 'error';
  if (status === 429) return 'throttled';
  if (status >= 400 && status < 500 && status !== 401 && envelope) return 'rejected';
  return 'error';
};

/**
 * Issues one request and records it.
 *
 * `group` is the operation group the report aggregates by (read, write,
 * decision, generate, login, health); `name` is the endpoint label. The
 * timestamp is the k6 container's wall clock at send time, in ms — the same
 * clock for every record of a run, which is all the timeline needs.
 * `duration` is k6's `http_req_duration` (sending + waiting + receiving):
 * connection setup is excluded, so a refused connection shows as an error
 * with a near-zero duration rather than polluting the latency percentiles.
 */
export function call(method, path, body, group, name) {
  const params = {
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': clientIp() },
    timeout: TIMEOUT,
    tags: { group, name },
  };
  const t = Date.now();
  const res = http.request(method, BASE + path, body === null || body === undefined ? null : JSON.stringify(body), params);
  const { body: json, envelope, code } = parseEnvelope(res);
  const outcome = classify(res.status, envelope);
  emit({
    k: 'req',
    t,
    vu: exec.vu.idInTest,
    g: group,
    n: name,
    m: method,
    s: res.status,
    d: Math.round(res.timings.duration * 100) / 100,
    o: outcome,
    c: code,
    // k6's transport error code (1050 = request timeout, 1211/1212 = dial
    // refused/timeout, ...) — kept only when no HTTP response arrived; for a
    // response k6 merely mirrors the status (1400 + 4xx).
    x: res.status === 0 ? res.error_code || null : null,
    // The server's own words on anything but success: the evidence a defect
    // report quotes. Truncated — a full body per failure would dwarf the log.
    msg: outcome === 'ok' ? null : messageOf(json, res.body),
  });
  return { status: res.status, json, outcome };
}

/** The payload of a successful envelope, or null. */
export const dataOf = (r) => (r.outcome === 'ok' && r.json ? r.json.data : null);

/**
 * Logs in through the real endpoint. The session cookies land in the VU's
 * jar, which `noCookiesReset` (set by every scenario) keeps across iterations,
 * so each virtual user is one long-lived browser session.
 */
export function login(email) {
  const r = call('POST', '/auth/login', { email, password: PASSWORD }, 'login', 'POST /auth/login');
  const data = dataOf(r);
  if (!data || !data.user) return null;
  return { userId: data.user.id, email, permissions: data.user.permissions || [] };
}

/**
 * Which seeded account a virtual user plays. VU 1 is the administrator; the
 * next `managerShare` of the rest are managers (cycling through the seeded
 * ones, so several VUs share a manager and contend for that manager's
 * approvals); the remainder are employees, those of a managed department
 * first so their requests reach a manager who is also under load.
 */
export function roleFor(vu, vus, managerShare) {
  const admins = SEED_USERS.filter((u) => u.role === 'admin');
  const managers = SEED_USERS.filter((u) => u.role === 'manager');
  const managed = new Set(managers.map((m) => m.managesDepartment));
  const employees = SEED_USERS.filter((u) => u.role === 'employee').sort(
    (a, b) => Number(!a.departments.some((d) => managed.has(d))) - Number(!b.departments.some((d) => managed.has(d)))
  );
  if (vu === 1) return admins[0];
  const nManagers = Math.max(1, Math.round((vus - 1) * managerShare));
  if (vu - 2 < nManagers) return managers[(vu - 2) % managers.length];
  return employees[(vu - 2 - nManagers) % employees.length];
}
