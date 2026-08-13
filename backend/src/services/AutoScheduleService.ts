/**
 * Auto-schedule orchestrator (F09).
 *
 * Glues the optimization engine to the database as five named steps:
 *
 *   load    → AutoScheduleInputLoader, which owns every read
 *   build   → buildOptimizationProblem, a pure function over those rows
 *   solve   → the selected engine, with any degradation surfaced
 *   diff    → which published commitments this run kept and which it broke
 *   persist → a replan proposal for a published schedule, rows for a draft
 *
 * WHY THE STEPS ARE SEPARATE MODULES. This was one 474-line method in which the
 * eleven reads, the problem assembly, the engine call and both persistence
 * paths were divided only by comments. The assembly in particular — skill
 * parsing, contract-over-preference precedence, carried loads — could not be
 * tested without first standing up a fake pool and answering every read, so the
 * densest logic in the file was also the least reachable. It is now a pure
 * function called directly.
 *
 * Engine selection (OPTIMIZATION_ENGINE):
 *   - 'or-tools' (DEFAULT): route through the Python OR-Tools CP-SAT solver —
 *     the most optimal engine. If Python is unavailable or times out it still
 *     produces a schedule via the greedy solver, but that fallback is never
 *     silent: the result reports engine='greedy' with degraded=true and a
 *     reason, and a warning is logged. The optimum is always attempted first.
 *   - 'greedy' (a.k.a. legacy 'javascript'): explicit DRAFT mode — the fast
 *     best-effort greedy pass, chosen deliberately. Reports engine='greedy'
 *     with degraded=false so callers can tell an intentional draft from a
 *     degraded fallback.
 *
 * Because both engines are held to one shared constraint definition (see
 * optimization/constraintValidator.ts and the optimizer.parity.test.ts suite),
 * either engine's output respects the same hard rules; they differ only in how
 * close to optimal the coverage/fairness is.
 *
 * @author Luca Ostinelli
 */

import { Pool, ResultSetHeader } from 'mysql2/promise';
import { withTransaction } from '../utils/transaction';
import { ScheduleOptimizer } from '../optimization/ScheduleOptimizerORTools';
import type { OptimizationProblem, ScheduleAssignment } from '../optimization/types';
import { logger } from '../config/logger';
import { config } from '../config';
import { ReplanProposalService } from './ReplanProposalService';
import { AutoScheduleInputLoader } from './AutoScheduleInputLoader';
import { buildOptimizationProblem, type ScheduleInputs } from './autoScheduleProblem';

export interface AutoScheduleResult {
  scheduleId: number;
  assignmentsCreated: number;
  totalShifts: number;
  coveragePercentage: number;
  status: string;
  /**
   * Set when `status` is `PROPOSED`: the schedule was published, so the run
   * recorded a plan for approval instead of writing it.
   */
  proposalId?: number;
  /** How many assignments the pending proposal contains. */
  proposedAssignments?: number;
  /** The engine that actually produced this schedule. */
  engine: 'or-tools' | 'greedy';
  /**
   * Published assignments this run preserved.
   *
   * Reported alongside the broken ones because "nothing moved" is exactly the
   * answer a re-run on unchanged inputs should give, and an empty broken list
   * on its own is indistinguishable from a diff that was never computed.
   */
  keptCommitments: number;
  /**
   * Published assignments this run had to break — someone was told they were
   * working and now is not. The one outcome a re-solve must never produce
   * silently.
   */
  brokenCommitments: Array<{ userId: number; shiftId: number }>;
  /**
   * True when the optimal engine (or-tools) was requested but the run fell back
   * to greedy (Python unavailable/timed out, or the solver errored). Always
   * false for an intentionally-selected greedy draft. Lets the UI flag "this is
   * a draft, not the optimum" clearly rather than silently.
   */
  degraded: boolean;
  /** Why the run degraded, when it did (for logs and the UI banner). */
  degradedReason?: string;
}

/** Which engine ran, and whether that was the one asked for. */
interface SolveOutcome {
  assignments: ScheduleAssignment[];
  engine: 'or-tools' | 'greedy';
  degraded: boolean;
  degradedReason?: string;
}

/**
 * How many assignment rows go into one INSERT.
 *
 * A month-long schedule produces hundreds to thousands, and a statement per row
 * held an open transaction — and a pooled connection shared with request
 * traffic — for the whole time. Chunking keeps each statement well under
 * max_allowed_packet.
 */
const INSERT_CHUNK_SIZE = 500;

/**
 * An outcome, with the zeros every branch shares filled in.
 *
 * The three outcomes differ in four fields out of eleven, and spelling all
 * eleven out three times buried that: whether PROPOSED reports a coverage
 * figure, or EMPTY a broken commitment, took a diff of two literals to answer.
 * Stating only what differs makes each branch's claim the thing you read.
 */
const outcome = (
  fields: Partial<AutoScheduleResult> &
    Pick<AutoScheduleResult, 'scheduleId' | 'status' | 'engine'>
): AutoScheduleResult => ({
  assignmentsCreated: 0,
  totalShifts: 0,
  coveragePercentage: 0,
  keptCommitments: 0,
  brokenCommitments: [],
  degraded: false,
  ...fields,
});

export class AutoScheduleService {
  private loader: AutoScheduleInputLoader;

  constructor(private pool: Pool) {
    this.loader = new AutoScheduleInputLoader(pool);
  }

  async generate(scheduleId: number, createdBy: number): Promise<AutoScheduleResult> {
    // Null means the schedule holds no shifts — nothing to solve, so the loader
    // stopped before the reads that could only describe who might have worked
    // them, and there are no commitments to keep or break.
    const inputs = await this.loader.load(scheduleId);
    if (inputs === null) {
      const engine = config.optimization.engine === 'or-tools' ? 'or-tools' : 'greedy';
      return outcome({ scheduleId, status: 'EMPTY', engine });
    }

    const totalShifts = inputs.shifts.length;
    const solved = await this.solve(buildOptimizationProblem(inputs), scheduleId);
    const diff = this.diffCommitments(inputs, solved.assignments, scheduleId);
    const { engine, degraded, degradedReason } = solved;

    // A PUBLISHED schedule is not re-planned in place; it is PROPOSED.
    //
    // Applying first and reporting afterwards inverts the decision: the change
    // to people's commitments has already happened by the time the planner can
    // judge whether it was worth making. For a draft that is right — nobody has
    // been told anything — so drafts keep the immediate path.
    //
    // Nothing is written to `shift_assignments` here: the proposal carries the
    // whole solved set, and approving it is what writes and removes rows. See
    // `ReplanProposalService` for why verify-at-apply beat re-solving at
    // approval time. `assignmentsCreated` and `coveragePercentage` stay zero
    // because reporting the proposed count would say work happened that has not.
    if (inputs.schedule.status === 'published') {
      const proposal = await new ReplanProposalService(this.pool).propose({
        scheduleId,
        proposedBy: createdBy,
        engine,
        payload: {
          assignments: solved.assignments.map((a) => ({
            shiftId: Number(a.shiftId),
            userId: Number(a.employeeId),
          })),
          ...diff,
          totalShifts,
        },
      });
      return outcome({
        scheduleId,
        status: 'PROPOSED',
        totalShifts,
        engine,
        degraded,
        degradedReason,
        proposalId: proposal.id,
        proposedAssignments: proposal.payload.assignments.length,
        ...diff,
      });
    }

    const assignmentsCreated = await this.insertAssignments(solved.assignments, createdBy);
    const coveragePercentage = Math.min(
      100,
      Math.round((assignmentsCreated / totalShifts) * 100)
    );
    logger.info(
      `Auto-schedule done for schedule=${scheduleId}: ${assignmentsCreated}/${totalShifts} (${coveragePercentage}%)`
    );
    return outcome({
      scheduleId,
      status: 'OK',
      assignmentsCreated,
      totalShifts,
      coveragePercentage,
      engine,
      degraded,
      degradedReason,
      ...diff,
    });
  }

  /**
   * Runs the configured engine.
   *
   * The default attempts the optimum first; any fall back to greedy is
   * surfaced (engine/degraded), never silent. An explicit 'greedy'/'javascript'
   * selection is an intentional draft and skips the child-process round-trip
   * entirely.
   */
  private async solve(problem: OptimizationProblem, scheduleId: number): Promise<SolveOutcome> {
    const optimizer = new ScheduleOptimizer();

    if (config.optimization.engine !== 'or-tools') {
      logger.info(`Optimization for schedule=${scheduleId} using greedy draft engine (explicit)`);
      return {
        assignments: await optimizer.generateGreedySchedule(problem),
        engine: 'greedy',
        degraded: false,
      };
    }

    const result = await optimizer.optimize(problem);
    if (result.status !== 'GREEDY_FALLBACK' && result.status !== 'ERROR') {
      return { assignments: result.assignments, engine: 'or-tools', degraded: false };
    }

    // optimize() already ran the greedy fallback internally; make that visible
    // instead of pretending or-tools produced the schedule.
    const degradedReason =
      result.error ?? 'OR-Tools solver was unavailable; used the greedy fallback';
    logger.warn(
      `Optimization for schedule=${scheduleId} requested or-tools but degraded to greedy: ${degradedReason}`
    );
    return { assignments: result.assignments, engine: 'greedy', degraded: true, degradedReason };
  }

  /**
   * The DIFF IS THE DELIVERABLE, not the schedule.
   *
   * A planner approving a re-solve needs to know what CHANGED for whom, not to
   * re-read a whole month. And every broken commitment is someone who was told
   * they were working and now is not — the one thing a re-solve must never do
   * silently. `kept` is reported too, because "nothing moved" is exactly the
   * answer a re-run on unchanged inputs should give, and an empty diff is
   * indistinguishable from a diff that was never computed.
   */
  private diffCommitments(
    inputs: ScheduleInputs,
    assignments: ScheduleAssignment[],
    scheduleId: number
  ): Pick<AutoScheduleResult, 'keptCommitments' | 'brokenCommitments'> {
    const proposed = new Set(assignments.map((a) => `${a.employeeId}:${a.shiftId}`));
    const brokenCommitments = inputs.pinned
      .filter((p) => !proposed.has(`${p.employee_id}:${p.shift_id}`))
      .map((p) => ({ userId: Number(p.employee_id), shiftId: Number(p.shift_id) }));
    if (brokenCommitments.length > 0) {
      logger.warn(
        `Optimization for schedule=${scheduleId} broke ${brokenCommitments.length} published ` +
          `commitment(s); affected users: ${[...new Set(brokenCommitments.map((b) => b.userId))].join(', ')}`
      );
    }
    return { keptCommitments: inputs.pinned.length - brokenCommitments.length, brokenCommitments };
  }

  /**
   * Writes the solved set in one transaction, returning the rows the database
   * actually accepted.
   *
   * The count comes from `affectedRows`, not a manual tally: INSERT IGNORE
   * skips rows violating the unique (shift_id, user_id) constraint, so counting
   * attempts overstated the result whenever the optimizer re-proposed an
   * assignment that already existed — the reported coverage was wrong in
   * exactly the case where it mattered, a re-run.
   */
  private async insertAssignments(
    assignments: ScheduleAssignment[],
    createdBy: number
  ): Promise<number> {
    return withTransaction(this.pool, async (conn) => {
      let inserted = 0;
      for (let i = 0; i < assignments.length; i += INSERT_CHUNK_SIZE) {
        const chunk = assignments.slice(i, i + INSERT_CHUNK_SIZE);
        const [result] = await conn.execute<ResultSetHeader>(
          `INSERT IGNORE INTO shift_assignments (shift_id, user_id, status, assigned_by)
           VALUES ${chunk.map(() => '(?, ?, ?, ?)').join(', ')}`,
          chunk.flatMap((a) => [Number(a.shiftId), Number(a.employeeId), 'pending', createdBy])
        );
        inserted += result.affectedRows;
      }
      return inserted;
    });
  }
}
