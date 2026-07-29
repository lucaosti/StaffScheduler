/**
 * Re-solving a published schedule proposes; approving is what applies it.
 *
 * WHY THIS EXISTS. `generate` used to write its result and report the diff
 * afterwards, so a planner learned that fourteen people had moved by reading
 * the response. For a draft that is right — nobody has been told anything. For
 * a published schedule it inverts the decision: the change to people's
 * commitments has already happened before anyone can judge whether it was
 * worth making.
 *
 * WHAT THIS FIXED ALONG THE WAY. The old persist path was `INSERT IGNORE` and
 * nothing else — no delete. Assignments the optimizer chose NOT to re-propose
 * survived the run untouched, so `brokenCommitments` named people who were
 * still assigned in every read path the app has. It described a removal that
 * never happened, and a schedule re-solved twice was the union of both solves
 * rather than the second one. Applying a proposal removes what the approved
 * plan leaves out, which is what makes the diff true.
 *
 * THE STALENESS PROBLEM, AND WHY VERIFY-AT-APPLY WON. A proposal sits between
 * solving and deciding, and the world moves in between. Three approaches:
 *
 *   - re-solve at approval with the same pins and require the diff to match.
 *     Rejected: a solver is not required to return the same optimum twice, so
 *     an approved diff could legitimately fail to reproduce, and the planner
 *     would have approved a decision the system then declines to make.
 *   - apply wholesale and let the foreign keys complain. Rejected: it would
 *     half-apply, and the failure mode is people assigned to shifts that no
 *     longer exist.
 *   - verify the stored plan against live data and refuse as a whole if
 *     anything it depends on has changed. Chosen. What gets applied is exactly
 *     what was approved, or nothing, and the planner re-solves against the new
 *     reality — which is the honest answer to "the world moved".
 *
 * The verification is deliberately narrow: the shifts must still exist and
 * still belong to this schedule, and the people must still be active. It does
 * NOT re-run the constraint validator. The plan was legal when it was solved,
 * and re-litigating it here would mean two authorities on what is legal —
 * `constraintValidator` is the one, and a plan invalidated by a genuine change
 * in the inputs is caught by re-solving, not by a second opinion.
 *
 * @author Luca Ostinelli
 */

import { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { ConflictError, NotFoundError } from '../errors';
import { logger } from '../config/logger';
import { NotificationService } from './NotificationService';
import { AuditLogService } from './AuditLogService';
import { DateUtils } from '../utils';
import { inClause } from '../utils/sql';

export interface ProposedAssignment {
  shiftId: number;
  userId: number;
}

export interface ReplanPayload {
  assignments: ProposedAssignment[];
  brokenCommitments: Array<{ userId: number; shiftId: number }>;
  keptCommitments: number;
  totalShifts: number;
}

export type ReplanStatus = 'pending' | 'applied' | 'rejected' | 'superseded';

export interface ReplanProposal {
  id: number;
  scheduleId: number;
  proposedBy: number | null;
  status: ReplanStatus;
  engine: string;
  payload: ReplanPayload;
  decidedBy: number | null;
  decisionReason: string | null;
  createdAt: string;
}

const mapProposal = (row: RowDataPacket): ReplanProposal => ({
  id: row.id as number,
  scheduleId: row.schedule_id as number,
  proposedBy: (row.proposed_by as number | null) ?? null,
  status: row.status as ReplanStatus,
  engine: row.engine as string,
  // mysql2 parses a JSON column into an object already; older drivers and a
  // TEXT fallback hand back a string. Both shapes appear in the wild, so this
  // accepts either rather than assuming the one the local server does.
  payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : (row.payload as ReplanPayload),
  decidedBy: (row.decided_by as number | null) ?? null,
  decisionReason: (row.decision_reason as string | null) ?? null,
  createdAt: String(row.created_at),
});

export class ReplanProposalService {
  private notifications: NotificationService;
  private audit: AuditLogService;

  constructor(private pool: Pool) {
    this.notifications = new NotificationService(pool);
    this.audit = new AuditLogService(pool);
  }

  /**
   * Records a solved plan for a published schedule, awaiting a decision.
   *
   * Any pending proposal for the same schedule is superseded first. Keeping
   * both would let a planner approve a diff computed against inputs that have
   * since changed, and would make "the pending proposal" ambiguous — the newer
   * one is the only one that reflects the current problem.
   */
  async propose(input: {
    scheduleId: number;
    proposedBy: number | null;
    engine: string;
    payload: ReplanPayload;
  }): Promise<ReplanProposal> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [superseded] = await conn.execute<ResultSetHeader>(
        `UPDATE schedule_replan_proposals
            SET status = 'superseded', updated_at = CURRENT_TIMESTAMP
          WHERE schedule_id = ? AND status = 'pending'`,
        [input.scheduleId]
      );
      const [res] = await conn.execute<ResultSetHeader>(
        `INSERT INTO schedule_replan_proposals (schedule_id, proposed_by, engine, payload)
         VALUES (?, ?, ?, ?)`,
        [input.scheduleId, input.proposedBy, input.engine, JSON.stringify(input.payload)]
      );
      await conn.commit();
      if (superseded.affectedRows > 0) {
        logger.info(
          `Replan proposal for schedule=${input.scheduleId} superseded ` +
            `${superseded.affectedRows} pending proposal(s)`
        );
      }
      logger.info(
        `Replan proposal ${res.insertId} recorded for schedule=${input.scheduleId}: ` +
          `${input.payload.assignments.length} assignment(s), ` +
          `${input.payload.brokenCommitments.length} commitment(s) at risk`
      );
      return this.getById(res.insertId);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async getById(id: number): Promise<ReplanProposal> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT * FROM schedule_replan_proposals WHERE id = ?',
      [id]
    );
    if (rows.length === 0) throw new NotFoundError('Replan proposal not found');
    return mapProposal(rows[0]);
  }

  /** Proposals for a schedule, newest first. */
  async listForSchedule(scheduleId: number): Promise<ReplanProposal[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT * FROM schedule_replan_proposals WHERE schedule_id = ? ORDER BY id DESC',
      [scheduleId]
    );
    return rows.map(mapProposal);
  }

  async reject(id: number, decidedBy: number, reason?: string | null): Promise<ReplanProposal> {
    const [res] = await this.pool.execute<ResultSetHeader>(
      `UPDATE schedule_replan_proposals
          SET status = 'rejected', decided_by = ?, decided_at = CURRENT_TIMESTAMP,
              decision_reason = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'pending'`,
      [decidedBy, reason ?? null, id]
    );
    if (res.affectedRows === 0) await this.explainUndecidable(id);
    logger.info(`Replan proposal ${id} rejected by user=${decidedBy}`);
    return this.getById(id);
  }

  /**
   * Applies an approved plan: the schedule becomes exactly what was proposed.
   *
   * Everything happens in one transaction, including the deletions. A partial
   * application is the one outcome worse than no application at all — it would
   * leave shifts unstaffed that the approved plan staffs, with no record of
   * which half took effect.
   */
  async apply(
    id: number,
    decidedBy: number,
    reason?: string | null
  ): Promise<{ proposal: ReplanProposal; inserted: number; removed: number }> {
    const proposal = await this.getById(id);
    if (proposal.status !== 'pending') {
      throw new ConflictError(
        `Cannot apply a proposal in '${proposal.status}' status — only a pending one can be applied`
      );
    }

    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

      // Claim the proposal first. The status guard is the concurrency
      // backstop: two approvers clicking at once would otherwise both pass the
      // read above and apply the same plan twice — the second one deleting
      // assignments the first had just written.
      const [claimed] = await conn.execute<ResultSetHeader>(
        `UPDATE schedule_replan_proposals
            SET status = 'applied', decided_by = ?, decided_at = CURRENT_TIMESTAMP,
                decision_reason = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status = 'pending'`,
        [decidedBy, reason ?? null, id]
      );
      if (claimed.affectedRows === 0) {
        await conn.rollback();
        await this.explainUndecidable(id);
      }

      await this.assertStillApplicable(conn, proposal);

      const keep = new Set(proposal.payload.assignments.map((a) => `${a.shiftId}:${a.userId}`));

      // Remove what the approved plan leaves out. Scoped to this schedule's
      // shifts and to live assignments: a declined or cancelled row is not
      // something the plan is replacing.
      const [existing] = await conn.execute<RowDataPacket[]>(
        `SELECT sa.id, sa.shift_id, sa.user_id, sa.is_pinned,
                s.date, s.start_time, s.end_time
           FROM shift_assignments sa
           JOIN shifts s ON s.id = sa.shift_id
          WHERE s.schedule_id = ?
            AND sa.status IN ('pending', 'confirmed')`,
        [proposal.scheduleId]
      );
      const losses = existing.filter((r) => !keep.has(`${r.shift_id}:${r.user_id}`));
      const doomed = losses.map((r) => r.id as number);

      let removed = 0;
      if (doomed.length > 0) {
        // Ids are interpolated because an IN list cannot be one bound
        // parameter; they come from a SELECT this method just issued, so they
        // are integers by construction rather than by validation.
        const [del] = await conn.execute<ResultSetHeader>(
          `DELETE FROM shift_assignments WHERE id IN (${inClause(doomed)})`
        );
        removed = del.affectedRows;
      }

      // Insert what is new. Pinned on arrival: the schedule is published, so
      // an assignment in the approved plan is a commitment the moment it
      // exists — the same rule publishing itself applies.
      const CHUNK = 500;
      let inserted = 0;
      for (let i = 0; i < proposal.payload.assignments.length; i += CHUNK) {
        const chunk = proposal.payload.assignments.slice(i, i + CHUNK);
        const [ins] = await conn.execute<ResultSetHeader>(
          `INSERT IGNORE INTO shift_assignments (shift_id, user_id, status, assigned_by, is_pinned)
           VALUES ${chunk.map(() => '(?, ?, ?, ?, TRUE)').join(', ')}`,
          chunk.flatMap((a) => [a.shiftId, a.userId, 'pending', decidedBy])
        );
        inserted += ins.affectedRows;
      }

      await this.announceLosses(conn, proposal, losses, decidedBy);

      await conn.commit();
      logger.info(
        `Replan proposal ${id} applied by user=${decidedBy}: ` +
          `+${inserted} assignment(s), -${removed}`
      );
      return { proposal: await this.getById(id), inserted, removed };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  /**
   * Tells each person what they have lost, before the transaction commits.
   *
   * WHY IN THE TRANSACTION. Removing a shift someone was told they were
   * working is the one change that must not be able to happen silently. A
   * separate `notify()` call would open its own transaction, so the removal
   * could commit and the notification fail — leaving someone unassigned and
   * uninformed, which is exactly the failure the outbox exists to rule out.
   *
   * WHY ONE MESSAGE PER PERSON. A re-solve that moves forty people can take
   * several shifts from the same one. Forty separate emails to that person is
   * not diligence, it is noise that buries the fact that their week changed;
   * the shifts are listed in a single message instead.
   *
   * ONLY PINNED LOSSES ARE ANNOUNCED. An unpinned assignment on a published
   * schedule is one nobody has been told about — a planner's draft addition,
   * or an assignment deliberately unpinned so the optimizer could move it.
   * Announcing those would tell people a shift was taken away that they never
   * knew they had.
   */
  private async announceLosses(
    conn: PoolConnection,
    proposal: ReplanProposal,
    losses: RowDataPacket[],
    decidedBy: number
  ): Promise<void> {
    const broken = losses.filter((r) => Boolean(r.is_pinned));
    if (broken.length === 0) return;

    const byUser = new Map<number, RowDataPacket[]>();
    for (const row of broken) {
      const uid = row.user_id as number;
      byUser.set(uid, [...(byUser.get(uid) ?? []), row]);
    }

    for (const [userId, rows] of byUser) {
      const when = rows
        .map((r) => `${DateUtils.toDateString(r.date)} ${String(r.start_time).slice(0, 5)}–${String(r.end_time).slice(0, 5)}`)
        .sort();
      await this.notifications.notifyWithin(conn, {
        userId,
        type: 'schedule.commitment_broken',
        title:
          when.length === 1
            ? 'A shift you were assigned has been reassigned'
            : `${when.length} shifts you were assigned have been reassigned`,
        // Plain and specific. The person needs to know which dates are no
        // longer theirs; why the schedule was re-planned is a conversation
        // with their manager, not something a generated message should
        // attempt to explain.
        body: `The schedule was re-planned and these shifts are no longer assigned to you: ${when.join('; ')}.`,
        link: `/schedules/${proposal.scheduleId}`,
      });
    }

    // One audit row per broken commitment, not per notification: the record is
    // of what happened to each assignment.
    //
    // THE ACTOR IS THE APPROVER, deliberately. The optimizer produced the plan,
    // but a person decided to apply it — which is the whole point of the
    // proposal step. Attributing it to a machine would now be the synthetic
    // attribution, hiding a real decision behind one.
    for (const row of broken) {
      await this.audit.write({
        actorId: decidedBy,
        action: 'schedule.commitment_broken',
        entityType: 'shift_assignment',
        entityId: row.id as number,
        description:
          `Commitment broken by replan proposal #${proposal.id}: user ${row.user_id} ` +
          `removed from shift ${row.shift_id} on ${DateUtils.toDateString(row.date)}`,
        before: { userId: row.user_id, shiftId: row.shift_id, isPinned: true },
      });
    }

    logger.warn(
      `Replan proposal ${proposal.id} broke ${broken.length} commitment(s) ` +
        `across ${byUser.size} employee(s); all were notified`
    );
  }

  /**
   * Refuses the whole plan if anything it names has changed underneath it.
   *
   * All-or-nothing on purpose. A plan that is 95% still valid is not 95%
   * approved: the planner judged a diff, and applying a subset of it produces
   * a schedule nobody agreed to.
   */
  private async assertStillApplicable(
    conn: PoolConnection,
    proposal: ReplanProposal
  ): Promise<void> {
    const { assignments } = proposal.payload;
    if (assignments.length === 0) return;

    const shiftIds = [...new Set(assignments.map((a) => a.shiftId))];
    const [shifts] = await conn.execute<RowDataPacket[]>(
      `SELECT id FROM shifts WHERE schedule_id = ? AND id IN (${inClause(shiftIds)})`,
      [proposal.scheduleId]
    );
    if (shifts.length !== shiftIds.length) {
      throw new ConflictError(
        'This plan refers to shifts that have since been deleted or moved to another schedule. ' +
          'Re-run the optimizer to plan against the current schedule.'
      );
    }

    const userIds = [...new Set(assignments.map((a) => a.userId))];
    const [users] = await conn.execute<RowDataPacket[]>(
      `SELECT id FROM users WHERE is_active = 1 AND id IN (${inClause(userIds)})`
    );
    if (users.length !== userIds.length) {
      throw new ConflictError(
        'This plan assigns work to people who are no longer active. ' +
          'Re-run the optimizer to plan against the current staff.'
      );
    }
  }

  /** Turns a no-op status update into the reason it was a no-op. */
  private async explainUndecidable(id: number): Promise<never> {
    const current = await this.getById(id);
    throw new ConflictError(
      `Cannot decide a proposal in '${current.status}' status — only a pending one can be decided`
    );
  }
}
