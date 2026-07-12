/**
 * Employee actor ("employee thread").
 *
 * Each employee independently decides — via its own deterministic child RNG,
 * derived from the run seed and its own user id — to file a configurable
 * number of requests per round (time-off, shift-swap, loan), with randomly
 * (but deterministically) chosen parameters drawn from real data (its own
 * baseline assignments, another employee's assignment, another org unit).
 * Requests are submitted through the real service layer — the same code the
 * HTTP routes call. The per-round bounds times the round count set the
 * guaranteed per-employee minimum across the run.
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { TimeOffService } from '../../src/services/TimeOffService';
import { EmployeeLoanService } from '../../src/services/EmployeeLoanService';
import { ShiftSwapService } from '../../src/services/ShiftSwapService';
import { Rng } from './prng';
import { MegaLog } from './megaLog';

export type RequestKind = 'time_off' | 'loan' | 'shift_swap';

export interface SubmittedRequest {
  kind: RequestKind;
  id: number;
  userId: number;
  /** Populated only for shift_swap: the other assignment's owner. */
  targetUserId?: number;
  /** Populated only for shift_swap: the two assignment ids swapped. */
  requesterAssignmentId?: number;
  targetAssignmentId?: number;
  /** Populated only for loan: the target org unit. */
  toOrgUnitId?: number;
  startDate: string;
  endDate: string;
}

export interface EmployeeActorContext {
  pool: Pool;
  log: MegaLog;
  runSeed: number;
  orgUnitId: number;
  otherOrgUnitIds: number[];
  /** Assignment ids owned by each employee in the baseline schedule. */
  baselineAssignmentsByUser: Map<number, number[]>;
  futureStartDate: string;
  futureEndDate: string;
  /** Inclusive bounds on how many requests each employee submits per round. */
  requestsMin: number;
  requestsMax: number;
  timeOffService: TimeOffService;
  loanService: EmployeeLoanService;
  shiftSwapService: ShiftSwapService;
}

const TIME_OFF_TYPES = ['vacation', 'sick', 'personal', 'other'] as const;

function randomDateWithin(rng: Rng, start: string, end: string): [string, string] {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const totalDays = Math.max(1, Math.round((endMs - startMs) / dayMs));
  const spanDays = rng.int(1, Math.min(4, totalDays));
  const offset = rng.int(0, Math.max(0, totalDays - spanDays));
  const s = new Date(startMs + offset * dayMs);
  const e = new Date(startMs + (offset + spanDays - 1) * dayMs);
  return [s.toISOString().slice(0, 10), e.toISOString().slice(0, 10)];
}

/** Runs one employee's turn: files between ctx.requestsMin and
 *  ctx.requestsMax *successfully submitted* requests, logs each. A
 *  shift-swap pick with no baseline assignment to offer is a skip, not a
 *  submission — so the loop keeps drawing new attempts until the target is
 *  actually met, up to a generous attempt cap, rather than counting
 *  skipped/failed picks toward the target. The per-round bounds times the
 *  round count set the guaranteed per-employee minimum across the run. */
export async function runEmployeeActor(
  ctx: EmployeeActorContext,
  userId: number
): Promise<SubmittedRequest[]> {
  const rng = new Rng(ctx.runSeed).child(userId);
  const targetCount = rng.int(ctx.requestsMin, ctx.requestsMax);
  const maxAttempts = targetCount * 4;
  const submitted: SubmittedRequest[] = [];

  for (let i = 0; submitted.length < targetCount && i < maxAttempts; i++) {
    const kind = rng.pick<RequestKind>(['time_off', 'loan', 'shift_swap']);
    try {
      if (kind === 'time_off') {
        const [start, end] = randomDateWithin(rng, ctx.futureStartDate, ctx.futureEndDate);
        const type = rng.pick(TIME_OFF_TYPES);
        const created = await ctx.timeOffService.create({
          userId,
          startDate: start,
          endDate: end,
          type,
          reason: `[SIM] ${type} request from employee #${userId}`,
        });
        ctx.log.actor('EMPLOYEE', userId, `filed TIME_OFF #${created.id} (${type}) ${start}..${end}`);
        ctx.log.count('requests.time_off.filed');
        submitted.push({ kind: 'time_off', id: created.id, userId, startDate: start, endDate: end });
      } else if (kind === 'loan') {
        const toOrgUnitId = rng.pick(ctx.otherOrgUnitIds);
        const [start, end] = randomDateWithin(rng, ctx.futureStartDate, ctx.futureEndDate);
        const created = await ctx.loanService.create({
          userId,
          fromOrgUnitId: ctx.orgUnitId,
          toOrgUnitId,
          startDate: start,
          endDate: end,
          reason: `[SIM] loan request from employee #${userId}`,
          requestedBy: userId,
        });
        ctx.log.actor(
          'EMPLOYEE',
          userId,
          `filed LOAN #${created.id} to org unit ${toOrgUnitId} ${start}..${end} (status=${created.status})`
        );
        ctx.log.count('requests.loan.filed');
        submitted.push({ kind: 'loan', id: created.id, userId, toOrgUnitId, startDate: start, endDate: end });
      } else {
        const myAssignments = ctx.baselineAssignmentsByUser.get(userId) ?? [];
        if (myAssignments.length === 0) {
          ctx.log.actor('EMPLOYEE', userId, `skipped SHIFT_SWAP — no baseline assignment to offer`);
          continue;
        }
        const otherUserIds = [...ctx.baselineAssignmentsByUser.keys()].filter((u) => u !== userId);
        if (otherUserIds.length === 0) continue;
        const targetUserId = rng.pick(otherUserIds);
        const targetAssignments = ctx.baselineAssignmentsByUser.get(targetUserId) ?? [];
        if (targetAssignments.length === 0) continue;

        const requesterAssignmentId = rng.pick(myAssignments);
        const targetAssignmentId = rng.pick(targetAssignments);

        const created = await ctx.shiftSwapService.create({
          requesterUserId: userId,
          requesterAssignmentId,
          targetAssignmentId,
          notes: `[SIM] swap request from employee #${userId}`,
        });
        ctx.log.actor(
          'EMPLOYEE',
          userId,
          `filed SHIFT_SWAP #${created.id} assignment ${requesterAssignmentId} <-> ${targetAssignmentId} (with user #${targetUserId})`
        );
        ctx.log.count('requests.shift_swap.filed');
        submitted.push({
          kind: 'shift_swap',
          id: created.id,
          userId,
          targetUserId,
          requesterAssignmentId,
          targetAssignmentId,
          startDate: ctx.futureStartDate,
          endDate: ctx.futureEndDate,
        });
      }
    } catch (err) {
      // A request that fails validation (e.g. picked an assignment the
      // target already offered in another swap) is itself a legitimate,
      // deterministic outcome — log it and move on, don't crash the actor.
      ctx.log.actor('EMPLOYEE', userId, `request #${i + 1} (${kind}) rejected at creation: ${(err as Error).message}`);
      ctx.log.count(`requests.${kind}.creation_failed`);
    }
  }
  return submitted;
}
