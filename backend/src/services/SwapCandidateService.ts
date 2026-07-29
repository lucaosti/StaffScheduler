/**
 * Which shifts a person could swap one of their own for.
 *
 * WHY THIS EXISTS. `POST /shift-swap` takes two assignment ids and is open to
 * any authenticated caller — correctly, since a swap is between two people.
 * But nothing let an ordinary employee find the second id: every endpoint that
 * lists someone else's assignments is gated on `assignment.manage`, which the
 * default Employee role does not hold. The feature was reachable only by
 * someone who already knew a numeric id belonging to a colleague, which in
 * practice meant it was not reachable at all.
 *
 * WHY NOT SIMPLY WIDEN `GET /assignments`. "Who works this shift" and "whose
 * shift could I take" are different questions with different answers, and only
 * the second is one an employee may ask. Relaxing the first would expose the
 * whole roster to everyone in order to serve a narrow, legitimate case.
 *
 * WHAT MAKES A CANDIDATE. Three filters, in increasing cost, so the expensive
 * one runs on the fewest rows:
 *
 *   1. structurally impossible — someone else's, still live, in the future,
 *      not on the same shift. SQL.
 *   2. out of sight — outside the org units the caller may see, using the same
 *      membership rule the timeline uses rather than a second answer to
 *      "what may this person see".
 *   3. would not survive the swap — after exchanging, either person would hold
 *      two overlapping shifts. Checked through `AssignmentValidator`, which
 *      already owns the overnight-aware overlap rule; re-deriving it here
 *      would be a fifth copy of something that has produced defects twice.
 *
 * WHY THE CONFLICT CHECK IS CAPPED. It costs two queries per candidate, and a
 * large department over a long window would run hundreds. The cap is on the
 * candidates examined, not silently on the results: when it bites, the caller
 * is told the list is partial rather than left to believe they have seen
 * everything.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket } from 'mysql2/promise';
import { ForbiddenError, NotFoundError } from '../errors';
import { AssignmentValidator } from './AssignmentValidator';
import { DateUtils } from '../utils';
import { inClause } from '../utils/sql';

export interface SwapCandidate {
  assignmentId: number;
  userId: number;
  userName: string;
  shiftId: number;
  date: string;
  startTime: string;
  endTime: string;
  departmentName: string;
}

export interface SwapCandidates {
  candidates: SwapCandidate[];
  /**
   * True when more assignments matched than were examined for conflicts, so
   * the list is a prefix rather than the whole answer.
   */
  truncated: boolean;
}

/** How far ahead a swap is worth offering. */
const HORIZON_DAYS = 60;

/** How many structurally-eligible candidates get the conflict check. */
const MAX_CHECKED = 50;

export class SwapCandidateService {
  private validator: AssignmentValidator;

  constructor(private pool: Pool) {
    this.validator = new AssignmentValidator(pool);
  }

  /**
   * @param orgUnitIds the units the caller may see, or `null` for unrestricted.
   */
  async forAssignment(
    assignmentId: number,
    callerId: number,
    orgUnitIds: number[] | null
  ): Promise<SwapCandidates> {
    const [ownRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT sa.id, sa.user_id, sa.shift_id, s.date, s.start_time, s.end_time
         FROM shift_assignments sa
         JOIN shifts s ON s.id = sa.shift_id
        WHERE sa.id = ? LIMIT 1`,
      [assignmentId]
    );
    if (ownRows.length === 0) throw new NotFoundError('Assignment not found');
    const own = ownRows[0];
    // Only the person holding a shift may go looking for someone to take it.
    // Without this the endpoint would answer "who works near this shift" for
    // any id a caller cared to try, which is the disclosure the narrow scoping
    // exists to prevent.
    if ((own.user_id as number) !== callerId) {
      throw new ForbiddenError('You can only look for swaps for your own shifts');
    }

    // An empty scope means nothing visible — the same reading the timeline
    // uses, and the safe one: someone attached to no org unit sees nobody
    // rather than everybody.
    if (orgUnitIds !== null && orgUnitIds.length === 0) {
      return { candidates: [], truncated: false };
    }

    const scope = orgUnitIds === null ? '' : ` AND d.org_unit_id IN (${inClause(orgUnitIds)})`;

    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT sa.id, sa.user_id, sa.shift_id,
              CONCAT(u.first_name, ' ', u.last_name) AS user_name,
              s.date, s.start_time, s.end_time,
              d.name AS department_name
         FROM shift_assignments sa
         JOIN shifts s ON s.id = sa.shift_id
         JOIN departments d ON d.id = s.department_id
         JOIN users u ON u.id = sa.user_id
        WHERE sa.user_id != ?
          AND sa.shift_id != ?
          AND sa.status IN ('pending', 'confirmed')
          AND u.is_active = 1
          -- A shift that has already run cannot be swapped, and CURDATE()
          -- rather than the source shift's date: swapping a future shift for
          -- a past one is not a swap, it is a hole.
          AND s.date >= CURDATE()
          AND s.date <= DATE_ADD(CURDATE(), INTERVAL ${HORIZON_DAYS} DAY)${scope}
        ORDER BY s.date, s.start_time
        LIMIT ${MAX_CHECKED + 1}`,
      [callerId, own.shift_id]
    );

    const truncated = rows.length > MAX_CHECKED;
    const examined = rows.slice(0, MAX_CHECKED);

    const candidates: SwapCandidate[] = [];
    for (const row of examined) {
      if (await this.survivesSwap(own, row, callerId)) {
        candidates.push({
          assignmentId: row.id as number,
          userId: row.user_id as number,
          userName: row.user_name as string,
          shiftId: row.shift_id as number,
          date: DateUtils.toDateString(row.date as string | Date),
          startTime: row.start_time as string,
          endTime: row.end_time as string,
          departmentName: row.department_name as string,
        });
      }
    }

    return { candidates, truncated };
  }

  /**
   * Whether exchanging these two assignments would leave either person holding
   * two overlapping shifts.
   *
   * The conflict each person already has with their OWN shift is expected and
   * is discounted: the swap removes it. Anything else is a real clash.
   */
  private async survivesSwap(
    own: RowDataPacket,
    other: RowDataPacket,
    callerId: number
  ): Promise<boolean> {
    const callerClashes = await this.validator.checkConflicts(
      callerId,
      other.date as string | Date,
      other.start_time as string,
      other.end_time as string
    );
    if (callerClashes.some((c) => c.assignmentId !== own.id)) return false;

    const otherClashes = await this.validator.checkConflicts(
      other.user_id as number,
      own.date as string | Date,
      own.start_time as string,
      own.end_time as string
    );
    return !otherClashes.some((c) => c.assignmentId !== other.id);
  }
}
