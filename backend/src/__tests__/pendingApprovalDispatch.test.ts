/**
 * dispatchPendingApprovalDecision — entity-agnostic dispatch unit tests.
 *
 * pendingApprovals.route.test.ts already exercises this indirectly through
 * the HTTP layer, but only for changeRequest/timeOff/shiftSwap. These tests
 * cover it directly, including the previously-untested employeeLoan and
 * policyException branches and the "no linked entity" guard.
 */

import { dispatchPendingApprovalDecision } from '../services/PendingApprovalDispatch';
import { ApprovalDecisionService } from '../services/ApprovalDecisionService';
import { ChangeRequestService } from '../services/ChangeRequestService';
import { TimeOffService } from '../services/TimeOffService';
import { EmployeeLoanService } from '../services/EmployeeLoanService';
import { ShiftSwapService } from '../services/ShiftSwapService';
import { PolicyExceptionService } from '../services/PolicyExceptionService';

jest.mock('../services/ApprovalDecisionService');
jest.mock('../services/ChangeRequestService');
jest.mock('../services/TimeOffService');
jest.mock('../services/EmployeeLoanService');
jest.mock('../services/ShiftSwapService');
jest.mock('../services/PolicyExceptionService');

const pool = {} as never;

const basePa = {
  id: 1,
  changeRequestId: null,
  timeOffRequestId: null,
  employeeLoanId: null,
  shiftSwapRequestId: null,
  policyExceptionId: null,
};

afterEach(() => jest.clearAllMocks());

describe('dispatchPendingApprovalDecision', () => {
  it('throws when the pending approval does not exist', async () => {
    (ApprovalDecisionService.prototype.getPendingApprovalById as jest.Mock).mockResolvedValueOnce(null);
    await expect(dispatchPendingApprovalDecision(pool, 1, 9, 'approved', null)).rejects.toThrow(
      'Pending approval not found'
    );
  });

  it('throws when the row has no linked entity (all four FKs null)', async () => {
    (ApprovalDecisionService.prototype.getPendingApprovalById as jest.Mock).mockResolvedValueOnce(basePa);
    await expect(dispatchPendingApprovalDecision(pool, 1, 9, 'approved', null)).rejects.toThrow(
      'Pending approval has no linked entity'
    );
  });

  it('dispatches to ChangeRequestService.advancePendingApproval', async () => {
    (ApprovalDecisionService.prototype.getPendingApprovalById as jest.Mock).mockResolvedValueOnce({
      ...basePa,
      changeRequestId: 5,
    });
    (ChangeRequestService.prototype.advancePendingApproval as jest.Mock).mockResolvedValueOnce({ id: 5 });

    const result = await dispatchPendingApprovalDecision(pool, 1, 9, 'approved', 'note');
    expect(ChangeRequestService.prototype.advancePendingApproval).toHaveBeenCalledWith(1, 9, 'approved', 'note', null);
    expect(result).toEqual({ id: 5 });
  });

  it('dispatches approved to TimeOffService.approve', async () => {
    (ApprovalDecisionService.prototype.getPendingApprovalById as jest.Mock).mockResolvedValueOnce({
      ...basePa,
      timeOffRequestId: 7,
    });
    (TimeOffService.prototype.approve as jest.Mock).mockResolvedValueOnce({ id: 7 });

    await dispatchPendingApprovalDecision(pool, 1, 9, 'approved', null);
    expect(TimeOffService.prototype.approve).toHaveBeenCalledWith(7, 9, null, null);
    expect(TimeOffService.prototype.reject).not.toHaveBeenCalled();
  });

  it('dispatches rejected to TimeOffService.reject', async () => {
    (ApprovalDecisionService.prototype.getPendingApprovalById as jest.Mock).mockResolvedValueOnce({
      ...basePa,
      timeOffRequestId: 7,
    });
    (TimeOffService.prototype.reject as jest.Mock).mockResolvedValueOnce({ id: 7 });

    await dispatchPendingApprovalDecision(pool, 1, 9, 'rejected', 'no');
    expect(TimeOffService.prototype.reject).toHaveBeenCalledWith(7, 9, 'no', null);
  });

  it('dispatches approved to EmployeeLoanService.approve (previously untested branch)', async () => {
    (ApprovalDecisionService.prototype.getPendingApprovalById as jest.Mock).mockResolvedValueOnce({
      ...basePa,
      employeeLoanId: 3,
    });
    (EmployeeLoanService.prototype.approve as jest.Mock).mockResolvedValueOnce({ id: 3 });

    const result = await dispatchPendingApprovalDecision(pool, 1, 9, 'approved', null);
    expect(EmployeeLoanService.prototype.approve).toHaveBeenCalledWith(3, 9, null, null);
    expect(result).toEqual({ id: 3 });
  });

  it('dispatches rejected to EmployeeLoanService.reject', async () => {
    (ApprovalDecisionService.prototype.getPendingApprovalById as jest.Mock).mockResolvedValueOnce({
      ...basePa,
      employeeLoanId: 3,
    });
    (EmployeeLoanService.prototype.reject as jest.Mock).mockResolvedValueOnce({ id: 3 });

    await dispatchPendingApprovalDecision(pool, 1, 9, 'rejected', null);
    expect(EmployeeLoanService.prototype.reject).toHaveBeenCalledWith(3, 9, null, null);
  });

  it('dispatches approved to ShiftSwapService.approve', async () => {
    (ApprovalDecisionService.prototype.getPendingApprovalById as jest.Mock).mockResolvedValueOnce({
      ...basePa,
      shiftSwapRequestId: 2,
    });
    (ShiftSwapService.prototype.approve as jest.Mock).mockResolvedValueOnce({ id: 2 });

    await dispatchPendingApprovalDecision(pool, 1, 9, 'approved', null);
    expect(ShiftSwapService.prototype.approve).toHaveBeenCalledWith(2, 9, null, null);
  });

  it('dispatches rejected to ShiftSwapService.decline, not .reject', async () => {
    (ApprovalDecisionService.prototype.getPendingApprovalById as jest.Mock).mockResolvedValueOnce({
      ...basePa,
      shiftSwapRequestId: 2,
    });
    (ShiftSwapService.prototype.decline as jest.Mock).mockResolvedValueOnce({ id: 2 });

    await dispatchPendingApprovalDecision(pool, 1, 9, 'rejected', null);
    expect(ShiftSwapService.prototype.decline).toHaveBeenCalledWith(2, 9, null, null);
  });

  it('dispatches approved to PolicyExceptionService.approve', async () => {
    (ApprovalDecisionService.prototype.getPendingApprovalById as jest.Mock).mockResolvedValueOnce({
      ...basePa,
      policyExceptionId: 6,
    });
    (PolicyExceptionService.prototype.approve as jest.Mock).mockResolvedValueOnce({ id: 6 });

    await dispatchPendingApprovalDecision(pool, 1, 9, 'approved', null);
    expect(PolicyExceptionService.prototype.approve).toHaveBeenCalledWith(6, 9, null, null);
  });

  it('dispatches rejected to PolicyExceptionService.reject', async () => {
    (ApprovalDecisionService.prototype.getPendingApprovalById as jest.Mock).mockResolvedValueOnce({
      ...basePa,
      policyExceptionId: 6,
    });
    (PolicyExceptionService.prototype.reject as jest.Mock).mockResolvedValueOnce({ id: 6 });

    await dispatchPendingApprovalDecision(pool, 1, 9, 'rejected', null);
    expect(PolicyExceptionService.prototype.reject).toHaveBeenCalledWith(6, 9, null, null);
  });
});
