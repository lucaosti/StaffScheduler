/**
 * Employee actor: one person's turn in a round, entirely over their own
 * session.
 *
 * Each employee draws, from a child RNG keyed by the run seed and their own
 * user id, a number of requests in [requestsMin, requestsMax] — time off for
 * the upcoming period, a direct swap with a colleague found through the
 * swap-candidates endpoint, or an open offer of one of their own shifts — and
 * then goes through the routine of someone using the app: reading the
 * dashboard and notifications, answering swaps addressed to them, claiming a
 * colleague's open offer, confirming or declining an assignment, clocking in
 * and out, saving preferences, and checking their calendar feed.
 *
 * Routine reads are taken with a probability so a 10,000-person run is not
 * dominated by them; the first employee of each department is "thorough" and
 * performs every one, which is what guarantees operation coverage at any
 * scale and any seed.
 *
 * Every employee also makes one forbidden attempt per round — approving
 * someone's time off, reading the audit log, reading a colleague's
 * preferences — chosen from what the server says they lack (`permissions`
 * from `/auth/verify`), so the expectation follows the authorization model.
 *
 * @author Luca Ostinelli
 */

import { Rng } from './prng';
import { Ledger, SubmittedRequest } from './requests';
import { Actor, World } from './world';

export interface RoundContext {
  round: number;
  runSeed: number;
  periodStart: string;
  periodEnd: string;
  requestsMin: number;
  requestsMax: number;
  ledger: Ledger;
  /** A global policy employees may ask an exception to (created by the admin). */
  exceptionPolicyId: number | null;
}

interface AssignmentRow {
  id: number;
  status?: string;
}

const TIME_OFF_TYPES = ['vacation', 'sick', 'personal', 'other'] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

export const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

export function randomRange(rng: Rng, start: string, end: string): [string, string] {
  const total = Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / DAY_MS) + 1);
  const span = rng.int(1, Math.min(4, total));
  const offset = rng.int(0, Math.max(0, total - span));
  return [addDays(start, offset), addDays(start, offset + span - 1)];
}

const listOf = <T>(data: unknown): T[] => {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object') {
    for (const v of Object.values(data as Record<string, unknown>)) if (Array.isArray(v)) return v as T[];
  }
  return [];
};

async function myAssignments(world: World, me: Actor): Promise<AssignmentRow[]> {
  const res = await me.client.get(`/assignments/user/${me.userId}`);
  world.expectOk(me, res, 'assignments.mine');
  return listOf<AssignmentRow>(res.body.data).filter((a) => a.status !== 'cancelled' && a.status !== 'declined');
}

async function fileTimeOff(world: World, me: Actor, rng: Rng, ctx: RoundContext): Promise<SubmittedRequest | null> {
  const [startDate, endDate] = randomRange(rng, ctx.periodStart, ctx.periodEnd);
  const type = rng.pick(TIME_OFF_TYPES);
  const res = await me.client.post<{ id: number }>('/time-off', { startDate, endDate, type, reason: `[SIM] ${type}` });
  if (!world.outcome(me, res, 'time_off.create')) return null;
  world.log.actor('EMPLOYEE', me.userId, `filed TIME_OFF #${res.body.data!.id} (${type}) ${startDate}..${endDate}`);
  return { kind: 'time_off', id: res.body.data!.id, userId: me.userId, startDate, endDate };
}

async function fileSwap(world: World, me: Actor, rng: Rng, mine: AssignmentRow[]): Promise<SubmittedRequest | null> {
  if (mine.length === 0) return null;
  const own = rng.pick(mine);
  const cand = await me.client.get<{ candidates: Array<{ assignmentId: number; userId: number }> }>(`/assignments/${own.id}/swap-candidates`);
  if (!world.outcome(me, cand, 'swap.candidates') || !cand.body.data || cand.body.data.candidates.length === 0) return null;
  const other = rng.pick(cand.body.data.candidates);
  const res = await me.client.post<{ id: number }>('/shift-swap', {
    requesterAssignmentId: own.id,
    targetAssignmentId: other.assignmentId,
    notes: '[SIM] swap',
  });
  if (!world.outcome(me, res, 'shift_swap.create')) return null;
  world.log.actor('EMPLOYEE', me.userId, `filed SHIFT_SWAP #${res.body.data!.id} ${own.id} <-> ${other.assignmentId} (user #${other.userId})`);
  return {
    kind: 'shift_swap',
    id: res.body.data!.id,
    userId: me.userId,
    targetUserId: other.userId,
    requesterAssignmentId: own.id,
    targetAssignmentId: other.assignmentId,
    startDate: '',
    endDate: '',
  };
}

/** Answers every swap addressed to me that waits for my response. */
export async function answerSwaps(world: World, me: Actor, ctx: RoundContext): Promise<void> {
  const rng = new Rng(ctx.runSeed).child(`answer:${me.userId}`);
  const res = await me.client.get<Array<{ id: number; targetUserId: number; status: string }>>('/shift-swap', { status: 'pending_target' });
  if (!world.expectOk(me, res, 'shift_swap.list')) return;
  for (const swap of listOf<{ id: number; targetUserId: number; status: string }>(res.body.data)) {
    if (swap.targetUserId !== me.userId || swap.status !== 'pending_target') continue;
    const detail = await me.client.get(`/shift-swap/${swap.id}`);
    world.expectOk(me, detail, 'shift_swap.get');
    const accepted = rng.chance(0.75);
    const answer = await me.client.post(`/shift-swap/${swap.id}/respond`, { accepted, notes: '[SIM] answer' });
    world.outcome(me, answer, 'shift_swap.respond');
  }
}

async function routine(world: World, me: Actor, rng: Rng, ctx: RoundContext, thorough: boolean, mine: AssignmentRow[]): Promise<void> {
  const maybe = (p: number): boolean => thorough || rng.chance(p);
  const c = me.client;
  const { ledger } = ctx;

  if (maybe(0.2)) {
    world.expectOk(me, await c.get('/dashboard/stats'), 'dashboard.stats');
    world.expectOk(me, await c.get('/dashboard/attention-items'), 'dashboard.attention');
  }
  if (maybe(0.3)) {
    world.expectOk(me, await c.get('/notifications/unread-count'), 'notifications.count');
    const list = await c.get<Array<{ id: number; isRead?: boolean }>>('/notifications', { unreadOnly: 1, limit: 20 });
    if (world.expectOk(me, list, 'notifications.list')) {
      const unread = listOf<{ id: number }>(list.body.data);
      if (unread.length > 0) {
        const one = rng.pick(unread);
        if (world.expectOk(me, await c.patch(`/notifications/${one.id}/read`), 'notifications.read')) {
          const read = ledger.notificationsRead.get(me.userId) ?? new Set<number>();
          read.add(one.id);
          ledger.notificationsRead.set(me.userId, read);
        }
      }
      if (thorough || rng.chance(0.2)) {
        if (world.expectOk(me, await c.patch('/notifications/read-all'), 'notifications.read_all')) ledger.readAll.add(me.userId);
      }
    }
  }
  if (maybe(0.15)) {
    world.expectOk(me, await c.get('/preferences/me'), 'preferences.me');
    const notes = `[SIM] round ${ctx.round} prefers ${rng.pick(['mornings', 'evenings', 'nights'])}`;
    if (world.expectOk(me, await c.put('/preferences/me', { notes }), 'preferences.save')) ledger.preferenceNotes.set(me.userId, notes);
  }
  if (maybe(0.15)) {
    world.expectOk(me, await c.get('/on-call/me', { start: ctx.periodStart, end: ctx.periodEnd }), 'on_call.me');
    world.expectOk(me, await c.get('/directory/me'), 'directory.me');
    world.expectOk(me, await c.get(`/schedules/user/${me.userId}`), 'schedules.mine');
    world.expectOk(me, await c.get('/org/manager-chain'), 'org.manager_chain');
    world.expectOk(me, await c.get('/org/authority'), 'org.authority');
    world.expectOk(me, await c.get('/org/history', { asOf: ctx.periodStart }), 'org.history');
    world.expectOk(me, await c.get('/timeline', { from: ctx.periodStart, to: ctx.periodEnd }), 'timeline');
    world.expectOk(me, await c.get('/time-off'), 'time_off.mine');
    world.expectOk(me, await c.get('/org/loans'), 'loans.mine');
    world.expectOk(me, await c.get('/pending-approvals/count'), 'pending.count');
    world.expectOk(me, await c.get('/policies/approval-matrix'), 'policies.matrix');
    world.expectOk(me, await c.get('/settings/currency'), 'settings.currency');
    world.expectOk(me, await c.get('/settings/time-period'), 'settings.time_period');
    world.expectOk(me, await c.get('/delegations'), 'delegations.mine');
    world.expectOk(me, await c.get('/responsibility-rules/my-responsibilities'), 'responsibility.mine');
    world.expectOk(me, await c.get('/auth/2fa/methods'), '2fa.methods');
  }

  // Assignment confirmation, then a shift's attendance. Clocking uses the
  // current time — attendance has no back-dating — so it is independent of
  // which period the assignment is in.
  // A thorough employee declines their first pending assignment and confirms
  // the next, so both answers occur whatever the draw.
  const pendingMine = mine.filter((a) => a.status === 'pending');
  if (thorough && pendingMine.length >= 2) {
    world.outcome(me, await c.patch(`/assignments/${pendingMine[0].id}/decline`), 'assignment.decline');
    world.outcome(me, await c.patch(`/assignments/${pendingMine[1].id}/confirm`), 'assignment.confirm');
  } else if (mine.length > 0 && maybe(0.3)) {
    const a = rng.pick(mine);
    if (a.status === 'pending') {
      world.outcome(me, await c.patch(`/assignments/${a.id}/${rng.chance(0.85) ? 'confirm' : 'decline'}`), 'assignment.respond');
    }
    world.outcome(me, await c.get(`/assignments/${a.id}`), 'assignment.get');
  }
  if (maybe(0.2)) {
    const open = await c.post<{ id: number }>('/attendance/clock-in', { notes: '[SIM] in' });
    if (world.outcome(me, open, 'attendance.clock_in')) {
      const id = open.body.data!.id;
      ledger.attendanceOwners.set(id, me.userId);
      world.expectOk(me, await c.post(`/attendance/${id}/clock-out`, { notes: '[SIM] out' }), 'attendance.clock_out');
      world.expectOk(me, await c.get(`/attendance/${id}`), 'attendance.get');
    }
    world.expectOk(me, await c.get('/attendance'), 'attendance.mine');
  }

  // Open offers: claim a colleague's, or withdraw one of my own.
  if (mine.length > 0 && maybe(0.2)) {
    const offers = await c.get<Array<{ id: number; offeredByUserId?: number; requesterUserId?: number }>>('/shift-swap/open');
    if (world.expectOk(me, offers, 'shift_swap.open.list')) {
      const others = listOf<{ id: number; requesterUserId?: number; offeredByUserId?: number }>(offers.body.data).filter(
        (o) => (o.requesterUserId ?? o.offeredByUserId) !== me.userId
      );
      if (others.length > 0) {
        const offer = rng.pick(others);
        const claim = await c.post(`/shift-swap/open/${offer.id}/claim`, { assignmentId: rng.pick(mine).id, notes: '[SIM] claim' });
        world.outcome(me, claim, 'shift_swap.open.claim');
      }
    }
    const minePosted = await c.get<Array<{ id: number; status?: string }>>('/shift-swap/open', { mine: 1 });
    if (world.expectOk(me, minePosted, 'shift_swap.open.mine')) {
      const withdrawable = listOf<{ id: number; status?: string }>(minePosted.body.data);
      if (withdrawable.length > 0 && (thorough || rng.chance(0.3))) {
        world.outcome(me, await c.post(`/shift-swap/open/${withdrawable[0].id}/cancel`), 'shift_swap.open.cancel');
      }
    }
  }

  // Calendar: subscribe, read the feed by token (no session — a calendar app
  // fetching it), and rotate the token now and then.
  if (maybe(0.1)) {
    const token = await c.post<{ id: number; token: string }>('/calendar/tokens', { label: `[SIM] round ${ctx.round}` });
    if (world.expectOk(me, token, 'calendar.token.create')) {
      ledger.calendarTokens.set(token.body.data.id, true);
      const anonymous = world.newClient();
      const feed = await anonymous.get('/calendar/feed.ics', { token: token.body.data.token });
      if (world.expectOk(me, feed, 'calendar.feed') && !(feed.text ?? '').includes('BEGIN:VCALENDAR')) {
        world.dbFinding(`calendar feed of ${world.label(me)}`, 'feed.ics is not an iCalendar document');
      }
      world.expectOk(me, await c.get('/calendar/tokens'), 'calendar.token.list');
      if (thorough || rng.chance(0.5)) {
        if (world.expectOk(me, await c.delete(`/calendar/tokens/${token.body.data.id}`), 'calendar.token.revoke')) {
          ledger.calendarTokens.set(token.body.data.id, false);
          const dead = await anonymous.get('/calendar/feed.ics', { token: token.body.data.token });
          if (dead.status === 200) world.dbFinding(`calendar token #${token.body.data.id}`, 'a revoked token still serves the feed');
        }
      }
    }
  }

  // A policy exception for myself, sometimes withdrawn before a decision
  // (thorough: two, the second withdrawn).
  const exceptions = ctx.exceptionPolicyId === null ? 0 : thorough ? 2 : rng.chance(0.08) ? 1 : 0;
  for (let i = 0; i < exceptions; i++) {
    const ex = await c.post<{ id: number }>('/policies/exceptions', {
      policyId: ctx.exceptionPolicyId,
      targetType: 'user',
      targetId: me.userId,
      reason: `[SIM] exception ${i + 1}`,
    });
    if (world.outcome(me, ex, 'policy_exception.create')) {
      const id = ex.body.data!.id;
      ctx.ledger.policyExceptions.set(id, 'pending');
      if (i === 1 || rng.chance(0.25)) {
        if (world.outcome(me, await c.post(`/policies/exceptions/${id}/cancel`), 'policy_exception.cancel')) {
          ctx.ledger.policyExceptions.set(id, 'cancelled');
        }
      }
    }
  }
}

/** Forbidden attempts, chosen from what the server says this person lacks. */
async function probe(world: World, me: Actor, rng: Rng, colleague: Actor | null, othersTimeOff: number | null): Promise<void> {
  const c = me.client;
  const options: Array<() => Promise<void>> = [];
  if (!world.can(me, 'audit.read')) options.push(async () => world.expectDenied(me, await c.get('/audit-logs'), 'employee reads audit log'));
  if (!world.can(me, 'settings.manage')) options.push(async () => world.expectDenied(me, await c.get('/settings'), 'employee reads system settings'));
  if (!world.can(me, 'preferences.manage') && colleague) {
    options.push(async () => world.expectDenied(me, await c.get(`/preferences/${colleague.userId}`), "employee reads a colleague's preferences"));
  }
  if (!world.can(me, 'timeoff.approve') && othersTimeOff !== null) {
    options.push(async () => world.expectDenied(me, await c.post(`/time-off/${othersTimeOff}/approve`, {}), "employee approves a colleague's time off"));
  }
  if (!world.can(me, 'employee.manage')) {
    options.push(async () =>
      world.expectDenied(me, await c.post('/import/employees', { csv: 'email,firstName,lastName,role\n', defaultPassword: 'x' }), 'employee imports accounts')
    );
  }
  if (options.length > 0) await rng.pick(options)();
}

export async function runEmployeeTurn(
  world: World,
  me: Actor,
  ctx: RoundContext,
  thorough: boolean,
  colleague: Actor | null,
  othersTimeOff: number | null
): Promise<SubmittedRequest[]> {
  const rng = new Rng(ctx.runSeed).child(me.userId);
  const target = rng.int(ctx.requestsMin, ctx.requestsMax);
  const mine = await myAssignments(world, me);
  const filed: SubmittedRequest[] = [];

  // Draw until the target is met: a swap with no candidate is a skip, not a
  // submission, so it does not count (attempt cap keeps a degenerate roster
  // from looping).
  for (let i = 0; filed.length < target && i < target * 4; i++) {
    const kind = rng.pick(['time_off', 'time_off', 'shift_swap', 'open_offer'] as const);
    if (kind === 'time_off') {
      const req = await fileTimeOff(world, me, rng, ctx);
      if (req) filed.push(req);
    } else if (kind === 'shift_swap') {
      const req = await fileSwap(world, me, rng, mine);
      if (req) filed.push(req);
    } else if (mine.length > 0) {
      const offer = await me.client.post('/shift-swap/open', { assignmentId: rng.pick(mine).id, notes: '[SIM] offer' });
      world.outcome(me, offer, 'shift_swap.open.create');
    }
  }

  // Withdraw a swap before the colleague answers, now and then.
  const swaps = filed.filter((r) => r.kind === 'shift_swap');
  if (swaps.length > 0 && (thorough || rng.chance(0.1))) {
    world.outcome(me, await me.client.post(`/shift-swap/${swaps[swaps.length - 1].id}/cancel`), 'shift_swap.cancel');
  }

  // Withdraw one pending time-off now and then — before any decision.
  const pending = filed.filter((r) => r.kind === 'time_off');
  if (pending.length > 1 && (thorough || rng.chance(0.15))) {
    const victim = pending[pending.length - 1];
    if (world.outcome(me, await me.client.post(`/time-off/${victim.id}/cancel`), 'time_off.cancel')) {
      ctx.ledger.cancelledTimeOff.add(victim.id);
    }
    world.expectOk(me, await me.client.get(`/time-off/${victim.id}`), 'time_off.get');
  }

  await routine(world, me, rng, ctx, thorough, mine);
  await probe(world, me, rng, colleague, othersTimeOff);
  return filed;
}
