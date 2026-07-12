/**
 * Tests for PendingApprovals page.
 *
 * @author Luca Ostinelli
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PendingApprovals from './PendingApprovals';
import { PendingApprovalItem } from '../../services/pendingApprovalService';

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 5, email: 'manager@demo.staffscheduler.local' } }),
}));

jest.mock('../../services/pendingApprovalService', () => ({
  listPendingApprovals: jest.fn(),
  approvePendingItem: jest.fn(),
  rejectPendingItem: jest.fn(),
  keepPendingItem: jest.fn(),
  delegatePendingItem: jest.fn(),
  openPendingItemToStructure: jest.fn(),
  getDecisionChain: jest.fn(),
}));

jest.mock('../../services/orgService', () => ({
  listMembersDetailed: jest.fn(),
}));

const {
  listPendingApprovals: mockList,
  approvePendingItem: mockApprove,
  rejectPendingItem: mockReject,
  getDecisionChain: mockGetChain,
} = jest.requireMock('../../services/pendingApprovalService') as {
  listPendingApprovals: jest.Mock;
  approvePendingItem: jest.Mock;
  rejectPendingItem: jest.Mock;
  getDecisionChain: jest.Mock;
};

const { listMembersDetailed: mockListMembers } = jest.requireMock('../../services/orgService') as {
  listMembersDetailed: jest.Mock;
};

const ITEM_1: PendingApprovalItem = {
  id: 1,
  changeRequestId: 10,
  timeOffRequestId: null,
  employeeLoanId: null,
  shiftSwapRequestId: null,
  workflowId: 1,
  stepId: 1,
  stepOrder: 1,
  assignedToUserId: 5,
  assignedToOrgUnitId: null,
  openToStructure: false,
  decidedByUserId: null,
  status: 'pending',
  decidedAt: null,
  decisionNote: null,
  escalatedAt: null,
  createdAt: '2024-01-15T10:00:00.000Z',
  updatedAt: '2024-01-15T10:00:00.000Z',
  changeType: 'TimeOff.Request',
  targetEntityType: 'change_request',
  targetEntityId: null,
  proposedPayload: { days: 3, type: 'vacation' },
  justification: 'Family event',
  proposerUserId: 3,
};

const ITEM_2: PendingApprovalItem = {
  ...ITEM_1,
  id: 2,
  changeRequestId: 11,
  status: 'approved',
  changeType: 'Schedule.Change',
  targetEntityType: 'change_request',
  targetEntityId: 42,
  proposedPayload: { shiftId: 42 },
  justification: null,
  proposerUserId: 7,
};

const makeResponse = (items: PendingApprovalItem[] = [ITEM_1, ITEM_2]) => ({
  success: true,
  data: { items, total: items.length },
});

beforeEach(() => {
  mockList.mockResolvedValue(makeResponse());
  mockApprove.mockResolvedValue({ success: true, data: { ...ITEM_1, status: 'approved' } });
  mockReject.mockResolvedValue({ success: true, data: { ...ITEM_1, status: 'rejected' } });
  mockGetChain.mockResolvedValue({
    success: true,
    data: {
      pendingApprovalId: 1,
      status: 'pending',
      assignedToOrgUnit: null,
      reassignments: [],
      currentAssigneeUserId: 5,
      openToStructure: false,
      decidedByUserId: null,
      decidedByName: null,
    },
  });
  mockListMembers.mockResolvedValue({ success: true, data: [] });
});

afterEach(() => jest.clearAllMocks());

describe('<PendingApprovals />', () => {
  it('renders the page heading', async () => {
    render(<PendingApprovals />);
    expect(screen.getByRole('heading', { name: /pending approvals/i })).toBeInTheDocument();
  });

  it('shows items after loading', async () => {
    render(<PendingApprovals />);
    expect(await screen.findByText('TimeOff.Request')).toBeInTheDocument();
    expect(screen.getByText('Schedule.Change')).toBeInTheDocument();
  });

  it('shows empty state when no items', async () => {
    mockList.mockResolvedValue(makeResponse([]));
    render(<PendingApprovals />);
    expect(await screen.findByText(/no pending approvals/i)).toBeInTheDocument();
  });

  it('shows error alert on load failure', async () => {
    mockList.mockRejectedValue(new Error('Unauthorized'));
    render(<PendingApprovals />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('shows Approve and Reject buttons only for pending items', async () => {
    render(<PendingApprovals />);
    await screen.findByText('TimeOff.Request');

    // ITEM_1 is pending → has approve and reject buttons
    expect(screen.getByRole('button', { name: /approve item 1/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reject item 1/i })).toBeInTheDocument();

    // ITEM_2 is approved → no approve/reject buttons for it
    expect(screen.queryByRole('button', { name: /approve item 2/i })).not.toBeInTheDocument();
  });

  it('opens approve modal when Approve is clicked', async () => {
    render(<PendingApprovals />);
    await screen.findByText('TimeOff.Request');

    await userEvent.click(screen.getByRole('button', { name: /approve item 1/i }));
    expect(screen.getByRole('dialog', { name: /approve item 1/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/note/i)).toBeInTheDocument();
  });

  it('calls approvePendingItem with note and reloads', async () => {
    render(<PendingApprovals />);
    await screen.findByText('TimeOff.Request');

    await userEvent.click(screen.getByRole('button', { name: /approve item 1/i }));
    await userEvent.type(screen.getByLabelText(/note/i), 'Approved by manager');
    await userEvent.click(screen.getByRole('button', { name: /confirm approve/i }));

    await waitFor(() =>
      expect(mockApprove).toHaveBeenCalledWith(1, 'Approved by manager')
    );
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
    // Modal closes
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens reject modal when Reject is clicked', async () => {
    render(<PendingApprovals />);
    await screen.findByText('TimeOff.Request');

    await userEvent.click(screen.getByRole('button', { name: /reject item 1/i }));
    expect(screen.getByRole('dialog', { name: /reject item 1/i })).toBeInTheDocument();
  });

  it('calls rejectPendingItem and reloads on confirm', async () => {
    render(<PendingApprovals />);
    await screen.findByText('TimeOff.Request');

    await userEvent.click(screen.getByRole('button', { name: /reject item 1/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirm reject/i }));

    await waitFor(() => expect(mockReject).toHaveBeenCalledWith(1, undefined));
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
  });

  it('expands row to show payload when change type is clicked', async () => {
    render(<PendingApprovals />);
    await screen.findByText('TimeOff.Request');

    await userEvent.click(screen.getByRole('button', { name: /expand details for item 1/i }));
    expect(screen.getByText(/family event/i)).toBeInTheDocument();
    expect(screen.getByText(/proposed payload/i)).toBeInTheDocument();
  });

  it('collapses row on second click', async () => {
    render(<PendingApprovals />);
    await screen.findByText('TimeOff.Request');

    await userEvent.click(screen.getByRole('button', { name: /expand details for item 1/i }));
    expect(screen.getByText(/family event/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /collapse details for item 1/i }));
    expect(screen.queryByText(/family event/i)).not.toBeInTheDocument();
  });

  it('shows All filter button and loads all statuses when clicked', async () => {
    render(<PendingApprovals />);
    await screen.findByText('TimeOff.Request');

    await userEvent.click(screen.getByRole('button', { name: /^all$/i }));
    await waitFor(() =>
      expect(mockList).toHaveBeenCalledWith(undefined)
    );
  });

  it('shows status badge for each item', async () => {
    render(<PendingApprovals />);
    await screen.findByText('TimeOff.Request');

    expect(screen.getByText('pending')).toBeInTheDocument();
    expect(screen.getByText('approved')).toBeInTheDocument();
  });

  describe('structure-assigned decisions', () => {
    const STRUCTURE_ITEM = {
      ...ITEM_1,
      id: 3,
      changeRequestId: null,
      shiftSwapRequestId: 1,
      assignedToOrgUnitId: 3,
      changeType: 'ShiftSwap.Request',
    };

    it('shows a Structure badge and the chain of command once expanded', async () => {
      mockList.mockResolvedValue(makeResponse([STRUCTURE_ITEM]));
      mockGetChain.mockResolvedValue({
        success: true,
        data: {
          pendingApprovalId: 3,
          status: 'pending',
          assignedToOrgUnit: { id: 3, name: 'Emergency Department', headUserId: 5, headName: 'Mara Demo' },
          reassignments: [],
          currentAssigneeUserId: 5,
          openToStructure: false,
          decidedByUserId: null,
          decidedByName: null,
        },
      });

      render(<PendingApprovals />);
      await screen.findByText('ShiftSwap.Request');
      expect(screen.getByText('Structure')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: /expand details for item 3/i }));
      expect(await screen.findByText('Emergency Department')).toBeInTheDocument();
      expect(screen.getByText(/awaiting decision/i)).toBeInTheDocument();
    });

    it('shows keep/delegate/open-to-team controls when the current user is the default assignee', async () => {
      mockList.mockResolvedValue(makeResponse([STRUCTURE_ITEM]));
      mockListMembers.mockResolvedValue({
        success: true,
        data: [{ userId: 12, firstName: 'Anna', lastName: 'Demo', email: 'emp01@demo.local', position: 'Nurse', isPrimary: true }],
      });

      render(<PendingApprovals />);
      await screen.findByText('ShiftSwap.Request');
      await userEvent.click(screen.getByRole('button', { name: /expand details for item 3/i }));

      expect(await screen.findByText(/you head this structure/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /keep for myself/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^delegate$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /open to my team/i })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /anna demo/i })).toBeInTheDocument();
    });

    it('does not show delegation controls once the decision has been reassigned away from the caller', async () => {
      const delegatedItem = { ...STRUCTURE_ITEM, assignedToUserId: 12 }; // no longer assigned to current user (5)
      mockList.mockResolvedValue(makeResponse([delegatedItem]));

      render(<PendingApprovals />);
      await screen.findByText('ShiftSwap.Request');
      await userEvent.click(screen.getByRole('button', { name: /expand details for item 3/i }));

      await screen.findByText(/proposed payload/i);
      expect(screen.queryByText(/you head this structure/i)).not.toBeInTheDocument();
    });

    it('calls keepPendingItem and refreshes the chain', async () => {
      const { keepPendingItem: mockKeep } = jest.requireMock('../../services/pendingApprovalService') as { keepPendingItem: jest.Mock };
      mockKeep.mockResolvedValue({ success: true, data: { ...STRUCTURE_ITEM } });
      mockList.mockResolvedValue(makeResponse([STRUCTURE_ITEM]));

      render(<PendingApprovals />);
      await screen.findByText('ShiftSwap.Request');
      await userEvent.click(screen.getByRole('button', { name: /expand details for item 3/i }));
      await screen.findByRole('button', { name: /keep for myself/i });

      await userEvent.click(screen.getByRole('button', { name: /keep for myself/i }));
      await waitFor(() => expect(mockKeep).toHaveBeenCalledWith(3));
    });

    it('calls delegatePendingItem with the selected member', async () => {
      const { delegatePendingItem: mockDelegate } = jest.requireMock('../../services/pendingApprovalService') as { delegatePendingItem: jest.Mock };
      mockDelegate.mockResolvedValue({ success: true, data: { ...STRUCTURE_ITEM, assignedToUserId: 12 } });
      mockList.mockResolvedValue(makeResponse([STRUCTURE_ITEM]));
      mockListMembers.mockResolvedValue({
        success: true,
        data: [{ userId: 12, firstName: 'Anna', lastName: 'Demo', email: 'emp01@demo.local', position: 'Nurse', isPrimary: true }],
      });

      render(<PendingApprovals />);
      await screen.findByText('ShiftSwap.Request');
      await userEvent.click(screen.getByRole('button', { name: /expand details for item 3/i }));
      await screen.findByRole('combobox', { name: /delegate to team member/i });

      await userEvent.selectOptions(screen.getByRole('combobox', { name: /delegate to team member/i }), '12');
      await userEvent.click(screen.getByRole('button', { name: /^delegate$/i }));
      await waitFor(() => expect(mockDelegate).toHaveBeenCalledWith(3, 12));
    });

    it('calls openPendingItemToStructure', async () => {
      const { openPendingItemToStructure: mockOpen } = jest.requireMock('../../services/pendingApprovalService') as { openPendingItemToStructure: jest.Mock };
      mockOpen.mockResolvedValue({ success: true, data: { ...STRUCTURE_ITEM, assignedToUserId: null, openToStructure: true } });
      mockList.mockResolvedValue(makeResponse([STRUCTURE_ITEM]));

      render(<PendingApprovals />);
      await screen.findByText('ShiftSwap.Request');
      await userEvent.click(screen.getByRole('button', { name: /expand details for item 3/i }));
      await screen.findByRole('button', { name: /open to my team/i });

      await userEvent.click(screen.getByRole('button', { name: /open to my team/i }));
      await waitFor(() => expect(mockOpen).toHaveBeenCalledWith(3));
    });
  });
});
