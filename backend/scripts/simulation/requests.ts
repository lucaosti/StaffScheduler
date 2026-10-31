/**
 * What actors filed, kept so verify.ts can check every outcome against the
 * database once the decisions have landed.
 *
 * @author Luca Ostinelli
 */

export type RequestKind = 'time_off' | 'loan' | 'shift_swap';

export interface SubmittedRequest {
  kind: RequestKind;
  id: number;
  userId: number;
  /** shift_swap: the other assignment's owner and the two assignment ids. */
  targetUserId?: number;
  requesterAssignmentId?: number;
  targetAssignmentId?: number;
  /** loan: the receiving org unit. */
  toOrgUnitId?: number;
  startDate: string;
  endDate: string;
}

/** Side effects of the other domains, each re-read from the database. */
export interface Ledger {
  requests: SubmittedRequest[];
  /** time-off requests the requester cancelled before a decision. */
  cancelledTimeOff: Set<number>;
  /** attendance record id → the decision the approver made. */
  attendanceDecisions: Map<number, 'approved' | 'rejected'>;
  /** attendance record id → owner, for records opened by clock-in/punch. */
  attendanceOwners: Map<number, number>;
  /** on-call period id → user ids currently assigned to it. */
  onCall: Map<number, Set<number>>;
  /** policy exception id → final status the actors drove it to. */
  policyExceptions: Map<number, 'approved' | 'rejected' | 'cancelled' | 'pending'>;
  /** change request id → final status the actors drove it to. */
  changeRequests: Map<number, 'applied' | 'rejected' | 'cancelled' | 'approved' | 'pending'>;
  /** delegation id → whether it should still be active. */
  delegations: Map<number, boolean>;
  /** pairing id → [userId, otherUserId, kind], or null when deleted. */
  pairings: Map<number, [number, number, string] | null>;
  /** cost plan id → target amount, or null when deleted. */
  costPlans: Map<number, number | null>;
  /** user id → notifications the user marked read through the API. */
  notificationsRead: Map<number, Set<number>>;
  /** user id → users who marked everything read (no unread may remain). */
  readAll: Set<number>;
  /** calendar token id → whether it should still be active. */
  calendarTokens: Map<number, boolean>;
  /** email → imported through CSV and expected to exist. */
  imported: Set<string>;
  /** user id → preferences notes the user last saved. */
  preferenceNotes: Map<number, string>;
}

export const newLedger = (): Ledger => ({
  requests: [],
  cancelledTimeOff: new Set(),
  attendanceDecisions: new Map(),
  attendanceOwners: new Map(),
  onCall: new Map(),
  policyExceptions: new Map(),
  changeRequests: new Map(),
  delegations: new Map(),
  pairings: new Map(),
  costPlans: new Map(),
  notificationsRead: new Map(),
  readAll: new Set(),
  calendarTokens: new Map(),
  imported: new Set(),
  preferenceNotes: new Map(),
});
