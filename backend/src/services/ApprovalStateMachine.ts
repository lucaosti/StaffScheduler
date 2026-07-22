/**
 * Approval lifecycle state machine.
 *
 * WHY: the approval lifecycle was spread across ApprovalEngineService,
 * ApprovalMatrixService, PendingApprovalService and PendingApprovalDispatch,
 * with each place hard-coding which status a row moves to and relying on a
 * `WHERE status = 'pending'` guard in raw SQL to reject out-of-order changes.
 * The set of legal transitions lived nowhere explicit, so it could drift.
 *
 * This module is the single authority on that set. A pending_approvals row moves
 * only along the transitions declared here, and every service that changes a
 * row's status derives the target through `nextState()` rather than writing a
 * literal — so an illegal transition (deciding an already-decided approval,
 * escalating a rejected one) is impossible by construction: `nextState` throws a
 * ConflictError instead of returning a state. The SQL `WHERE status = ?` guard
 * remains as the concurrency backstop; this adds the declarative rule on top.
 *
 * States: pending (open), approved / rejected / escalated (terminal for this
 * row — an escalation opens a NEW pending row for the next approver, it does not
 * re-open this one).
 *
 * @author Luca Ostinelli
 */

import { ConflictError } from '../errors';

export type ApprovalState = 'pending' | 'approved' | 'rejected' | 'escalated';
export type ApprovalAction = 'approve' | 'reject' | 'escalate';

/**
 * The only legal transitions. A missing (state, action) pair is illegal by
 * omission — there is no catch-all, so adding a state without declaring its
 * transitions makes every action on it fail closed.
 */
const TRANSITIONS: Record<ApprovalState, Partial<Record<ApprovalAction, ApprovalState>>> = {
  pending: { approve: 'approved', reject: 'rejected', escalate: 'escalated' },
  approved: {},
  rejected: {},
  escalated: {},
};

/** True when no action can leave this state (approved/rejected/escalated). */
export function isTerminal(state: ApprovalState): boolean {
  return Object.keys(TRANSITIONS[state]).length === 0;
}

/** True when `action` is legal from `from`. */
export function canTransition(from: ApprovalState, action: ApprovalAction): boolean {
  return TRANSITIONS[from]?.[action] !== undefined;
}

/**
 * The state reached by applying `action` to `from`. Throws ConflictError (409)
 * when the transition is illegal — the same status code the raw-SQL guard's
 * "already <status>" conflict used, so callers keep their existing semantics.
 */
export function nextState(from: ApprovalState, action: ApprovalAction): ApprovalState {
  const to = TRANSITIONS[from]?.[action];
  if (to === undefined) {
    throw new ConflictError(`Cannot ${action} an approval that is ${from}`);
  }
  return to;
}

/** Maps a decision verb to its state-machine action. */
export function actionForDecision(decision: 'approved' | 'rejected'): ApprovalAction {
  return decision === 'approved' ? 'approve' : 'reject';
}
