/**
 * Targeted race for #829: many concurrent POST /assignments for ONE person
 * onto mutually overlapping shifts. The correct outcome of every round is
 * exactly one 201 and K-1 409s; two or more 201s is the double booking the
 * issue describes, reproduced over HTTP.
 *
 * Two controls run in every round:
 *   overlap-sequential  the same request shape sent one at a time to another
 *                       person. It must yield exactly one 201; otherwise the
 *                       overlap check is missing outright and the concurrent
 *                       result says nothing about a race.
 *   capacity-control    K DIFFERENT people onto ONE shift with max_staff = 1,
 *                       concurrently. That path locks the shift row (FOR
 *                       UPDATE) and must serialize, so it shows the harness
 *                       can tell a serialized write path from an unserialized
 *                       one under the same concurrency.
 *
 * WHY http.batch AND ONE SESSION. The race needs requests in flight at the
 * same instant, not N sessions that drift apart by their think times. k6
 * sends a batch's requests in parallel on separate connections (batchPerHost
 * = K), so all K transactions open within the same few milliseconds. One
 * administrator session is enough: the defect is in the service's locking,
 * which does not depend on who calls it.
 *
 * Fixtures are created through the API in setup() — a draft schedule far in
 * the future and fresh shifts per round — so a round never collides with the
 * seed or with another round, and every person used has no other assignment
 * that day (each round uses its own date, days apart).
 *
 * Knobs: RACE_ROUNDS (default 10), RACE_CONCURRENCY (K, default 8),
 * RACE_DAYS_AHEAD (default 400).
 *
 * @author Luca Ostinelli
 */

import exec from 'k6/execution';
import http from 'k6/http';
import { BASE, SEED_USERS, call, dataOf, emit, envInt, isoDay, login } from './lib.js';

const ROUNDS = envInt('RACE_ROUNDS', 10);
const K = envInt('RACE_CONCURRENCY', 8);
const DAYS_AHEAD = envInt('RACE_DAYS_AHEAD', 400);
// Rounds nine days apart: wider than the 7-day rolling window the weekly-hours
// compliance check reads, so the K overlapping shifts one round may wrongly
// leave behind cannot turn a later round's control into a compliance refusal.
const ROUND_SPACING_DAYS = 9;

export const options = {
  scenarios: { race: { executor: 'shared-iterations', vus: 1, iterations: ROUNDS, maxDuration: '20m' } },
  batch: K,
  batchPerHost: K,
  noCookiesReset: true,
  setupTimeout: '5m',
};

const ADMIN = SEED_USERS.find((u) => u.role === 'admin').email;

/** Creates one shift or throws: a round without its fixture proves nothing. */
function createShift(scheduleId, departmentId, date, startTime, endTime, maxStaff) {
  const data = dataOf(
    call(
      'POST',
      '/shifts',
      { scheduleId, departmentId, date, startTime, endTime, minStaff: 0, maxStaff, notes: 'race fixture' },
      'setup',
      'POST /shifts'
    )
  );
  if (!data) throw new Error(`could not create shift on ${date} ${startTime}`);
  return data.id;
}

export function setup() {
  if (!login(ADMIN)) throw new Error('administrator login failed');
  const departments = dataOf(call('GET', '/departments', null, 'setup', 'GET /departments')) || [];
  const dept = departments.find((d) => d.employeeCount >= K + 1);
  if (!dept) throw new Error(`no department with ${K + 1} employees`);
  const staff = (dataOf(call('GET', `/employees?department=${dept.id}&pageSize=100`, null, 'setup', 'GET /employees')) || [])
    .filter((e) => e.isActive)
    .map((e) => e.id);
  if (staff.length < K + 1) throw new Error(`department ${dept.name} has only ${staff.length} active employees`);

  const startDay = DAYS_AHEAD;
  const schedule = dataOf(
    call(
      'POST',
      '/schedules',
      { name: `race-829 ${Date.now()}`, startDate: isoDay(startDay), endDate: isoDay(startDay + ROUNDS * ROUND_SPACING_DAYS + 1), departmentId: dept.id },
      'setup',
      'POST /schedules'
    )
  );
  if (!schedule) throw new Error('could not create the race schedule');

  const rounds = [];
  for (let r = 0; r < ROUNDS; r++) {
    const date = isoDay(startDay + r * ROUND_SPACING_DAYS);
    // K overlapping windows staggered by 15 minutes: every pair overlaps, and
    // no two are identical, so a fix keyed on equal start times would not
    // pass by accident.
    const overlapping = () => {
      const ids = [];
      for (let i = 0; i < K; i++) {
        const h = 8 + Math.floor((i * 15) / 60);
        const m = (i * 15) % 60;
        const pad = (n) => String(n).padStart(2, '0');
        ids.push(createShift(schedule.id, dept.id, date, `${pad(h)}:${pad(m)}`, `${pad(h + 6)}:${pad(m)}`, 5));
      }
      return ids;
    };
    const overlapUser = staff[r % staff.length];
    const sequentialUser = staff[(r + 1) % staff.length];
    rounds.push({
      date,
      overlapShifts: overlapping(),
      overlapUser,
      sequentialShifts: overlapping(),
      sequentialUser,
      // The next morning, so no outcome of the overlap rounds can feed this
      // round's rest or daily-hours checks; its people exclude both of them.
      controlShift: createShift(schedule.id, dept.id, isoDay(startDay + r * ROUND_SPACING_DAYS + 1), '08:00', '11:00', 1),
      controlUsers: staff.filter((id) => id !== overlapUser && id !== sequentialUser).slice(0, K),
    });
  }
  emit({ k: 'meta', t: Date.now(), scenario: 'race', rounds: ROUNDS, concurrency: K, scheduleId: schedule.id, departmentId: dept.id });
  return { rounds };
}

function fire(kind, round, requests, concurrent) {
  const params = { headers: { 'Content-Type': 'application/json' }, timeout: '30s', tags: { group: 'race', name: `race:${kind}` } };
  const t = Date.now();
  const responses = concurrent
    ? http.batch(requests.map((body) => ['POST', `${BASE}/assignments`, JSON.stringify(body), params]))
    : requests.map((body) => http.post(`${BASE}/assignments`, JSON.stringify(body), params));
  const results = responses.map((res, i) => {
    let json = null;
    try {
      json = res.json();
    } catch {
      /* recorded as a non-envelope response below */
    }
    return {
      userId: requests[i].userId,
      shiftId: requests[i].shiftId,
      status: res.status,
      ms: Math.round(res.timings.duration),
      assignmentId: res.status === 201 && json && json.data ? json.data.id : null,
      code: json && json.error ? json.error.code : null,
      message: json && json.error ? String(json.error.message).slice(0, 160) : null,
    };
  });
  const created = results.filter((r) => r.status === 201);
  for (const c of created) emit({ k: 'write', t, entity: 'shift_assignment', id: c.assignmentId, shiftId: c.shiftId, userId: c.userId });
  emit({ k: 'race', t, kind, round: round.index, date: round.date, concurrent, created: created.length, results });
}

let session = null;

export default function (data) {
  if (!session) session = login(ADMIN);
  if (!session) throw new Error('administrator login failed');
  const index = exec.scenario.iterationInTest;
  const round = data.rounds[index];
  const roundInfo = { index, date: round.date };
  // Sequential first: if one-at-a-time requests are not refused either, the
  // service has no overlap check at all and a concurrent result proves
  // nothing about a race.
  const sequential = round.sequentialShifts.map((shiftId) => ({ shiftId, userId: round.sequentialUser, notes: 'race-sequential' }));
  fire('overlap-sequential', roundInfo, sequential, false);
  fire('overlap-concurrent', roundInfo, round.overlapShifts.map((shiftId) => ({ shiftId, userId: round.overlapUser, notes: 'race-829' })), true);
  fire('capacity-control', roundInfo, round.controlUsers.map((userId) => ({ shiftId: round.controlShift, userId, notes: 'race-control' })), true);
}
