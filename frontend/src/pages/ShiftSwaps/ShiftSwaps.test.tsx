/**
 * Shift swaps.
 *
 * The assertions that matter are about honesty. Both sides of the exchange are
 * named before anything is sent — a screen showing only what you give up is
 * how someone agrees to a shift they did not realise they were taking. And the
 * target is told plainly that a manager decides, rather than being shown
 * buttons that would 403 or an empty cell that reads as a broken page.
 *
 * @author Luca Ostinelli
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../test-utils/renderWithClient';
import ShiftSwaps from './ShiftSwaps';

const okResponse = <T,>(data: T) => Promise.resolve({ success: true as const, data });

let permissions: string[] = [];
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 5, permissions } }),
}));

const getMyAssignments = jest.fn();
jest.mock('../../services/assignmentService', () => ({
  __esModule: true,
  getMyAssignments: (...a: unknown[]) => getMyAssignments(...a),
  getAssignments: jest.fn(),
  confirmAssignment: jest.fn(),
  declineAssignment: jest.fn(),
  completeAssignment: jest.fn(),
  createAssignment: jest.fn(),
  deleteAssignment: jest.fn(),
  getAvailableEmployees: jest.fn(),
}));

const getSwapRequests = jest.fn();
const getSwapCandidates = jest.fn();
const createSwapRequest = jest.fn();
const approveSwap = jest.fn();
const declineSwap = jest.fn();
const cancelSwap = jest.fn();

jest.mock('../../services/shiftSwapService', () => ({
  __esModule: true,
  getSwapRequests: (...a: unknown[]) => getSwapRequests(...a),
  getSwapCandidates: (...a: unknown[]) => getSwapCandidates(...a),
  createSwapRequest: (...a: unknown[]) => createSwapRequest(...a),
  approveSwap: (...a: unknown[]) => approveSwap(...a),
  declineSwap: (...a: unknown[]) => declineSwap(...a),
  cancelSwap: (...a: unknown[]) => cancelSwap(...a),
}));

const myShift = {
  id: 1,
  shiftId: 10,
  userId: 5,
  shiftDate: '2033-04-01',
  startTime: '09:00:00',
  endTime: '17:00:00',
  departmentName: 'Ward A',
  status: 'confirmed',
};

const candidate = {
  assignmentId: 2,
  userId: 9,
  userName: 'Grace Hopper',
  shiftId: 11,
  date: '2033-04-02',
  startTime: '13:00:00',
  endTime: '21:00:00',
  departmentName: 'Ward B',
};

const swapRequest = (over: Record<string, unknown> = {}) => ({
  id: 3,
  requesterUserId: 5,
  requesterAssignmentId: 1,
  targetUserId: 9,
  targetAssignmentId: 2,
  status: 'pending',
  notes: null,
  reviewerId: null,
  reviewedAt: null,
  reviewNotes: null,
  createdAt: 'x',
  updatedAt: 'x',
  ...over,
});

beforeEach(() => {
  permissions = [];
  getMyAssignments.mockReset().mockImplementation(() => okResponse([myShift]));
  getSwapRequests.mockReset().mockImplementation(() => okResponse([swapRequest()]));
  getSwapCandidates
    .mockReset()
    .mockImplementation(() => okResponse({ candidates: [candidate], truncated: false }));
  createSwapRequest.mockReset().mockImplementation(() => okResponse(swapRequest()));
  approveSwap.mockReset().mockImplementation(() => okResponse(swapRequest({ status: 'approved' })));
  declineSwap.mockReset().mockImplementation(() => okResponse(swapRequest({ status: 'rejected' })));
  cancelSwap.mockReset().mockImplementation(() => okResponse(swapRequest({ status: 'cancelled' })));
});

describe('proposing', () => {
  it('does not look for candidates until a shift is chosen', async () => {
    render(<ShiftSwaps />);
    await screen.findByLabelText('The shift you would give up');
    // Each lookup runs a conflict check per candidate on the server; asking
    // before anyone is choosing is work for an answer nobody reads.
    expect(getSwapCandidates).not.toHaveBeenCalled();
  });

  it('asks for candidates once a shift is chosen', async () => {
    render(<ShiftSwaps />);
    const select = await screen.findByLabelText('The shift you would give up');
    await userEvent.selectOptions(select, '1');
    await waitFor(() => expect(getSwapCandidates).toHaveBeenCalledWith(1));
  });

  it('names BOTH sides of the exchange before anything is sent', async () => {
    render(<ShiftSwaps />);
    await userEvent.selectOptions(
      await screen.findByLabelText('The shift you would give up'),
      '1'
    );

    // A screen showing only what you give up, or only what you take, is how
    // someone agrees to a shift they did not realise they were taking.
    const row = await screen.findByText(/Grace Hopper takes/);
    expect(row).toHaveTextContent('2033-04-02 13:00–21:00');
    expect(row).toHaveTextContent('2033-04-01 09:00–17:00');
  });

  it('proposes the chosen exchange', async () => {
    render(<ShiftSwaps />);
    await userEvent.selectOptions(
      await screen.findByLabelText('The shift you would give up'),
      '1'
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Propose' }));

    await waitFor(() =>
      expect(createSwapRequest).toHaveBeenCalledWith({
        requesterAssignmentId: 1,
        targetAssignmentId: 2,
      })
    );
  });

  it('explains an empty candidate list rather than showing nothing', async () => {
    getSwapCandidates.mockImplementation(() =>
      okResponse({ candidates: [], truncated: false })
    );
    render(<ShiftSwaps />);
    await userEvent.selectOptions(
      await screen.findByLabelText('The shift you would give up'),
      '1'
    );
    expect(await screen.findByText(/two shifts at once/i)).toBeInTheDocument();
  });

  it('says when the candidate list is only a prefix', async () => {
    getSwapCandidates.mockImplementation(() =>
      okResponse({ candidates: [candidate], truncated: true })
    );
    render(<ShiftSwaps />);
    await userEvent.selectOptions(
      await screen.findByLabelText('The shift you would give up'),
      '1'
    );
    // Told nothing, a caller would believe they had seen every possibility.
    expect(await screen.findByText(/there may be more/i)).toBeInTheDocument();
  });

  it('relays the server\'s refusal', async () => {
    createSwapRequest.mockImplementation(() =>
      Promise.reject(new Error('Target assignment must belong to a different user'))
    );
    render(<ShiftSwaps />);
    await userEvent.selectOptions(
      await screen.findByLabelText('The shift you would give up'),
      '1'
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Propose' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/different user/);
  });
});

describe('deciding', () => {
  it('lets the requester withdraw their own pending request', async () => {
    render(<ShiftSwaps />);
    await userEvent.click(await screen.findByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(cancelSwap).toHaveBeenCalledWith(3));
  });

  it('offers no decision to someone without shiftswap.approve', async () => {
    render(<ShiftSwaps />);
    await screen.findByRole('button', { name: 'Withdraw' });
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Decline' })).not.toBeInTheDocument();
  });

  it('approves and declines with the permission', async () => {
    permissions = ['shiftswap.approve'];
    render(<ShiftSwaps />);
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(approveSwap).toHaveBeenCalledWith(3, undefined));

    await userEvent.click(screen.getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(declineSwap).toHaveBeenCalledWith(3, undefined));
  });

  /**
   * The model gives the person whose shift is being taken no say: `approve`
   * and `decline` are gated on `shiftswap.approve`, so a manager decides and
   * both assignments move. Whether that is right is #522; what would be wrong
   * is a UI that hides it.
   */
  it('tells the target that a manager decides, rather than leaving a blank', async () => {
    getSwapRequests.mockImplementation(() =>
      okResponse([swapRequest({ requesterUserId: 9, targetUserId: 5 })])
    );
    render(<ShiftSwaps />);

    expect(await screen.findByText('A manager decides this')).toBeInTheDocument();
    // Not buttons that would 403, and not an empty cell that reads as a page
    // which failed to load them.
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
  });

  it('offers nothing on a request already decided', async () => {
    getSwapRequests.mockImplementation(() => okResponse([swapRequest({ status: 'approved' })]));
    render(<ShiftSwaps />);
    await screen.findByText('approved');
    expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
  });
});
