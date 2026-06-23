/**
 * Tests for ChangeRequests page.
 *
 * @author Luca Ostinelli
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChangeRequests from './ChangeRequests';

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 1,
      permissions: ['change_request.create', 'change_request.review', 'change_request.approve'],
    },
  }),
}));

jest.mock('../../services/changeRequestService', () => ({
  listChangeRequests: jest.fn(),
  createChangeRequest: jest.fn(),
  approveChangeRequest: jest.fn(),
  rejectChangeRequest: jest.fn(),
  cancelChangeRequest: jest.fn(),
}));

const {
  listChangeRequests: mockList,
  createChangeRequest: mockCreate,
  approveChangeRequest: mockApprove,
  rejectChangeRequest: mockReject,
  cancelChangeRequest: mockCancel,
} = jest.requireMock('../../services/changeRequestService') as {
  listChangeRequests: jest.Mock;
  createChangeRequest: jest.Mock;
  approveChangeRequest: jest.Mock;
  rejectChangeRequest: jest.Mock;
  cancelChangeRequest: jest.Mock;
};

const ITEM_PENDING = {
  id: 1,
  changeType: 'TimeOff.Request',
  proposerUserId: 1,
  targetEntityType: 'leave',
  targetEntityId: null,
  proposedPayload: { days: 3 },
  justification: 'Family event',
  status: 'pending',
  approverUserId: null,
  approvedAt: null,
  rejectedAt: null,
  rejectionReason: null,
  appliedAt: null,
  onBehalfOfUserId: null,
  createdAt: '2024-01-15T10:00:00.000Z',
  updatedAt: '2024-01-15T10:00:00.000Z',
};

const ITEM_APPROVED = {
  ...ITEM_PENDING,
  id: 2,
  changeType: 'Schedule.Change',
  targetEntityType: 'shift',
  targetEntityId: 42,
  status: 'approved',
  proposedPayload: { shiftId: 42 },
  justification: null,
};

const makeResponse = (items = [ITEM_PENDING, ITEM_APPROVED]) => ({
  success: true,
  data: { items, total: items.length },
});

beforeEach(() => {
  mockList.mockResolvedValue(makeResponse());
  mockCreate.mockResolvedValue({ success: true, data: { ...ITEM_PENDING, id: 99 } });
  mockApprove.mockResolvedValue({ success: true, data: { ...ITEM_PENDING, status: 'approved' } });
  mockReject.mockResolvedValue({ success: true, data: { ...ITEM_PENDING, status: 'rejected' } });
  mockCancel.mockResolvedValue({ success: true, data: { ...ITEM_PENDING, status: 'cancelled' } });
});

afterEach(() => jest.clearAllMocks());

describe('<ChangeRequests />', () => {
  it('renders the page heading', async () => {
    render(<ChangeRequests />);
    expect(screen.getByRole('heading', { name: /change requests/i })).toBeInTheDocument();
  });

  it('shows items after loading', async () => {
    render(<ChangeRequests />);
    expect(await screen.findByText('TimeOff.Request')).toBeInTheDocument();
    expect(screen.getByText('Schedule.Change')).toBeInTheDocument();
  });

  it('shows empty state when no items', async () => {
    mockList.mockResolvedValue(makeResponse([]));
    render(<ChangeRequests />);
    expect(await screen.findByText(/no change requests found/i)).toBeInTheDocument();
  });

  it('shows error alert on load failure', async () => {
    mockList.mockRejectedValue(new Error('Network error'));
    render(<ChangeRequests />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('shows status badges', async () => {
    render(<ChangeRequests />);
    await screen.findByText('TimeOff.Request');
    expect(screen.getByText('pending')).toBeInTheDocument();
    expect(screen.getByText('approved')).toBeInTheDocument();
  });

  it('shows Approve/Reject/Cancel buttons only for pending items', async () => {
    render(<ChangeRequests />);
    await screen.findByText('TimeOff.Request');

    expect(screen.getByRole('button', { name: /approve request 1/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reject request 1/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel request 1/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve request 2/i })).not.toBeInTheDocument();
  });

  it('opens approve modal when Approve is clicked', async () => {
    render(<ChangeRequests />);
    await screen.findByText('TimeOff.Request');
    await userEvent.click(screen.getByRole('button', { name: /approve request 1/i }));
    expect(screen.getByRole('dialog', { name: /approve request 1/i })).toBeInTheDocument();
  });

  it('calls approveChangeRequest and reloads on confirm', async () => {
    render(<ChangeRequests />);
    await screen.findByText('TimeOff.Request');
    await userEvent.click(screen.getByRole('button', { name: /approve request 1/i }));
    await userEvent.type(screen.getByLabelText(/justification/i), 'Good reason');
    await userEvent.click(screen.getByRole('button', { name: /confirm approve/i }));

    await waitFor(() => expect(mockApprove).toHaveBeenCalledWith(1, 'Good reason'));
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens reject modal when Reject is clicked', async () => {
    render(<ChangeRequests />);
    await screen.findByText('TimeOff.Request');
    await userEvent.click(screen.getByRole('button', { name: /reject request 1/i }));
    expect(screen.getByRole('dialog', { name: /reject request 1/i })).toBeInTheDocument();
  });

  it('shows validation error when rejecting without a reason', async () => {
    render(<ChangeRequests />);
    await screen.findByText('TimeOff.Request');
    await userEvent.click(screen.getByRole('button', { name: /reject request 1/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirm reject/i }));

    expect(await screen.findByText(/rejection reason is required/i)).toBeInTheDocument();
    expect(mockReject).not.toHaveBeenCalled();
  });

  it('calls rejectChangeRequest with reason and reloads', async () => {
    render(<ChangeRequests />);
    await screen.findByText('TimeOff.Request');
    await userEvent.click(screen.getByRole('button', { name: /reject request 1/i }));
    await userEvent.type(screen.getByLabelText(/rejection reason/i), 'Not eligible');
    await userEvent.click(screen.getByRole('button', { name: /confirm reject/i }));

    await waitFor(() => expect(mockReject).toHaveBeenCalledWith(1, 'Not eligible'));
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
  });

  it('calls cancelChangeRequest on Cancel button click', async () => {
    render(<ChangeRequests />);
    await screen.findByText('TimeOff.Request');
    await userEvent.click(screen.getByRole('button', { name: /cancel request 1/i }));

    await waitFor(() => expect(mockCancel).toHaveBeenCalledWith(1));
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
  });

  it('expands row to show payload when change type is clicked', async () => {
    render(<ChangeRequests />);
    await screen.findByText('TimeOff.Request');
    await userEvent.click(screen.getByRole('button', { name: /expand request 1/i }));

    expect(screen.getByText(/family event/i)).toBeInTheDocument();
    expect(screen.getByText(/proposed payload/i)).toBeInTheDocument();
  });

  it('collapses expanded row on second click', async () => {
    render(<ChangeRequests />);
    await screen.findByText('TimeOff.Request');
    await userEvent.click(screen.getByRole('button', { name: /expand request 1/i }));
    expect(screen.getByText(/family event/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /collapse request 1/i }));
    expect(screen.queryByText(/family event/i)).not.toBeInTheDocument();
  });

  it('opens New Request modal and submits', async () => {
    render(<ChangeRequests />);
    await screen.findByText('TimeOff.Request');

    await userEvent.click(screen.getByRole('button', { name: /new request/i }));
    expect(screen.getByRole('dialog', { name: /new change request/i })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/change type/i), 'Shift.Swap');
    await userEvent.type(screen.getByLabelText(/entity type/i), 'shift');

    await userEvent.click(screen.getByRole('button', { name: /submit change request/i }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows All Requests tab for reviewers and loads all when clicked', async () => {
    render(<ChangeRequests />);
    await screen.findByText('TimeOff.Request');

    const allTab = screen.getByRole('tab', { name: /all requests/i });
    expect(allTab).toBeInTheDocument();

    await userEvent.click(allTab);
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
  });
});
