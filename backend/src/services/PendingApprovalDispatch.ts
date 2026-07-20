/**
 * Entity-agnostic dispatch for deciding a pending_approvals row.
 *
 * A pending_approvals row may belong to a change request, a time-off
 * request, a loan, or a shift swap, and each of those owns its own side
 * effects (advancing a workflow step, inserting an unavailability block,
 * swapping assignments, ...). Shared by the `/pending-approvals/:id/approve`
 * and `/reject` routes and by the simulation harness (`scripts/simulation`),
 * so both exercise the exact same code path.
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { ConflictError, NotFoundError } from '../errors';
import { ApprovalEngineService } from './ApprovalEngineService';
import { ChangeRequestService } from './ChangeRequestService';
import { TimeOffService } from './TimeOffService';
import { EmployeeLoanService } from './EmployeeLoanService';
import { ShiftSwapService } from './ShiftSwapService';

export async function dispatchPendingApprovalDecision(
  pool: Pool,
  id: number,
  userId: number,
  decision: 'approved' | 'rejected',
  note: string | null
): Promise<unknown> {
  const engine = new ApprovalEngineService(pool);
  const pa = await engine.getPendingApprovalById(id);
  if (!pa) throw new NotFoundError('Pending approval not found');

  if (pa.changeRequestId !== null) {
    const svc = new ChangeRequestService(pool);
    return svc.advancePendingApproval(id, userId, decision, note);
  }
  if (pa.timeOffRequestId !== null) {
    const svc = new TimeOffService(pool);
    return decision === 'approved'
      ? svc.approve(pa.timeOffRequestId, userId, note)
      : svc.reject(pa.timeOffRequestId, userId, note);
  }
  if (pa.employeeLoanId !== null) {
    const svc = new EmployeeLoanService(pool);
    return decision === 'approved'
      ? svc.approve(pa.employeeLoanId, userId, note)
      : svc.reject(pa.employeeLoanId, userId, note);
  }
  if (pa.shiftSwapRequestId !== null) {
    const svc = new ShiftSwapService(pool);
    return decision === 'approved'
      ? svc.approve(pa.shiftSwapRequestId, userId, note)
      : svc.decline(pa.shiftSwapRequestId, userId, note);
  }
  throw new ConflictError('Pending approval has no linked entity');
}
