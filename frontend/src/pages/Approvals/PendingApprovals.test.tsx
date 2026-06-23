/**
 * Tests for PendingApprovals page.
 *
 * @author Luca Ostinelli
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PendingApprovals from './PendingApprovals';

jest.mock('../../services/pendingApprovalService', () => ({
  listPendingApprovals: jest.fn(),
  approvePendingItem: jest.fn(),
  rejectPendingItem: jest.fn(),
}));

const {
  listPendingApprovals: mockList,
  approvePendingItem: mockApprove,
  rejectPendingItem: mockReject,
} = jest.requireMock('../../services/pendingApprovalService') as {
  listPendingApprovals: jest.Mock;
  approvePendingItem: jest.Mock;
  rejectPendingItem: jest.Mock;
};

const ITEM_1 = {
  id: 1,
  changeRequestId: 10,
  workflowId: 1,
  stepId: 1,
  stepOrder: 1,
  assignedToUserId: 5,
  status: 'pending',
  decidedAt: null,
  decisionNote: null,
  escalatedAt: null,
  createdAt: '2024-01-15T10:00:00.000Z',
  updatedAt: '2024-01-15T10:00:00.000Z',
  changeType: 'TimeOff.Request',
  targetEntityType: 'leave',
  targetEntityId: null,
  proposedPayload: { days: 3, type: 'vacation' },
  justification: 'Family event',
  proposerUserId: 3,
};

const ITEM_2 = {
  ...ITEM_1,
  id: 2,
  changeRequestId: 11,
  status: 'approved',
  changeType: 'Schedule.Change',
  targetEntityType: 'shift',
  targetEntityId: 42,
  proposedPayload: { shiftId: 42 },
  justification: null,
  proposerUserId: 7,
};

const makeResponse = (items = [ITEM_1, ITEM_2]) => ({
  success: true,
  data: { items, total: items.length },
});

beforeEach(() => {
  mockList.mockResolvedValue(makeResponse());
  mockApprove.mockResolvedValue({ success: true, data: { ...ITEM_1, status: 'approved' } });
  mockReject.mockResolvedValue({ success: true, data: { ...ITEM_1, status: 'rejected' } });
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
});
