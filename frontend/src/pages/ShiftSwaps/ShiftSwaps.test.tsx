/**
 * Shift swaps.
 *
 * The assertions that matter are about honesty. Both sides of the exchange are
 * named before anything is sent — a screen showing only what you give up is
 * how someone agrees to a shift they did not realise they were taking. And
 * the two-gate model (#522) is exercised end to end: a new request sits in
 * `pending_target` until the target accepts or declines it (their own
 * decision, not a manager's), and only an accepted request reaches the
 * manager step, where the target is told plainly that a manager decides
 * rather than being shown buttons that would 403.
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
const respondToSwap = jest.fn();
const approveSwap = jest.fn();
const declineSwap = jest.fn();
const cancelSwap = jest.fn();
const getOpenOffers = jest.fn();
const createOpenOffer = jest.fn();
const claimOpenOffer = jest.fn();
const cancelOpenOffer = jest.fn();

jest.mock('../../services/shiftSwapService', () => ({
  __esModule: true,
  getSwapRequests: (...a: unknown[]) => getSwapRequests(...a),
  getSwapCandidates: (...a: unknown[]) => getSwapCandidates(...a),
  createSwapRequest: (...a: unknown[]) => createSwapRequest(...a),
  respondToSwap: (...a: unknown[]) => respondToSwap(...a),
  approveSwap: (...a: unknown[]) => approveSwap(...a),
  declineSwap: (...a: unknown[]) => declineSwap(...a),
  cancelSwap: (...a: unknown[]) => cancelSwap(...a),
  getOpenOffers: (...a: unknown[]) => getOpenOffers(...a),
  createOpenOffer: (...a: unknown[]) => createOpenOffer(...a),
  claimOpenOffer: (...a: unknown[]) => claimOpenOffer(...a),
  cancelOpenOffer: (...a: unknown[]) => cancelOpenOffer(...a),
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

const offer = (over: Record<string, unknown> = {}) => ({
  id: 4,
  assignmentId: 20,
  userId: 9,
  userName: 'Grace Hopper',
  notes: null,
  status: 'open',
  shiftId: 21,
  date: '2033-04-03',
  startTime: '07:00:00',
  endTime: '15:00:00',
  departmentName: 'Ward C',
  ...over,
});

const swapRequest = (over: Record<string, unknown> = {}) => ({
  id: 3,
  requesterUserId: 5,
  requesterAssignmentId: 1,
  targetUserId: 9,
  targetAssignmentId: 2,
  // A freshly created swap sits here — awaiting the target's response — not
  // in front of a manager (#522).
  status: 'pending_target',
  declinedBy: null,
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
  respondToSwap.mockReset().mockImplementation(() => okResponse(swapRequest({ status: 'pending' })));
  approveSwap.mockReset().mockImplementation(() => okResponse(swapRequest({ status: 'approved' })));
  declineSwap
    .mockReset()
    .mockImplementation(() => okResponse(swapRequest({ status: 'declined', declinedBy: 'manager' })));
  cancelSwap.mockReset().mockImplementation(() => okResponse(swapRequest({ status: 'cancelled' })));
  // Default to an empty board — most existing suites are about the targeted
  // flow and shouldn't have to account for an unrelated section.
  getOpenOffers.mockReset().mockImplementation(() => okResponse([]));
  createOpenOffer.mockReset().mockImplementation(() => okResponse(offer()));
  claimOpenOffer.mockReset().mockImplementation(() => okResponse(swapRequest({ status: 'pending' })));
  cancelOpenOffer.mockReset().mockImplementation(() => okResponse(offer({ status: 'cancelled' })));
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

describe('responding (the target\'s own decision, #522)', () => {
  it('offers accept/decline only to the target, while pending_target', async () => {
    getSwapRequests.mockImplementation(() =>
      okResponse([swapRequest({ requesterUserId: 9, targetUserId: 5 })])
    );
    render(<ShiftSwaps />);
    expect(await screen.findByRole('button', { name: 'Accept' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument();
  });

  it('tells the requester they are waiting on the other person, not shown accept/decline', async () => {
    render(<ShiftSwaps />); // default: requesterUserId 5 === myId, targetUserId 9
    expect(await screen.findByText(/waiting for the other person/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
  });

  it('accepts, routing the request to the manager step', async () => {
    getSwapRequests.mockImplementation(() =>
      okResponse([swapRequest({ requesterUserId: 9, targetUserId: 5 })])
    );
    render(<ShiftSwaps />);
    await userEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(respondToSwap).toHaveBeenCalledWith(3, true, undefined));
  });

  it('declines, ending the request with no manager involved', async () => {
    getSwapRequests.mockImplementation(() =>
      okResponse([swapRequest({ requesterUserId: 9, targetUserId: 5 })])
    );
    respondToSwap.mockImplementation(() =>
      okResponse(swapRequest({ status: 'declined', declinedBy: 'target' }))
    );
    render(<ShiftSwaps />);
    await userEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(respondToSwap).toHaveBeenCalledWith(3, false, undefined));
  });

  it('lets the requester withdraw while still awaiting the target', async () => {
    render(<ShiftSwaps />);
    await userEvent.click(await screen.findByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(cancelSwap).toHaveBeenCalledWith(3));
  });

  it('names who declined, since a target refusal and a manager refusal mean different things', async () => {
    getSwapRequests.mockImplementation(() =>
      okResponse([swapRequest({ status: 'declined', declinedBy: 'target' })])
    );
    render(<ShiftSwaps />);
    expect(await screen.findByText(/declined by the other person/i)).toBeInTheDocument();
  });
});

describe('deciding (the manager step, after the target has accepted)', () => {
  it('lets the requester withdraw an accepted, not-yet-decided request', async () => {
    getSwapRequests.mockImplementation(() => okResponse([swapRequest({ status: 'pending' })]));
    render(<ShiftSwaps />);
    await userEvent.click(await screen.findByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(cancelSwap).toHaveBeenCalledWith(3));
  });

  it('offers no decision to someone without shiftswap.approve', async () => {
    getSwapRequests.mockImplementation(() => okResponse([swapRequest({ status: 'pending' })]));
    render(<ShiftSwaps />);
    await screen.findByRole('button', { name: 'Withdraw' });
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Decline' })).not.toBeInTheDocument();
  });

  it('approves and declines with the permission', async () => {
    getSwapRequests.mockImplementation(() => okResponse([swapRequest({ status: 'pending' })]));
    permissions = ['shiftswap.approve'];
    render(<ShiftSwaps />);
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(approveSwap).toHaveBeenCalledWith(3, undefined));

    await userEvent.click(screen.getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(declineSwap).toHaveBeenCalledWith(3, undefined));
  });

  /**
   * Once the target has already accepted, the remaining decision belongs to
   * a manager: `approve`/`decline` are gated on `shiftswap.approve`. The
   * target — who already had their own say at the pending_target step — is
   * told plainly that a manager decides this, rather than being shown
   * buttons that would 403 or an empty cell that reads as a broken page.
   */
  it('tells the target that a manager decides, rather than leaving a blank', async () => {
    getSwapRequests.mockImplementation(() =>
      okResponse([swapRequest({ requesterUserId: 9, targetUserId: 5, status: 'pending' })])
    );
    render(<ShiftSwaps />);

    expect(await screen.findByText('A manager decides this')).toBeInTheDocument();
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

describe('open shift board', () => {
  it('posts one of the caller shifts to the board', async () => {
    render(<ShiftSwaps />);
    const select = await screen.findByLabelText('Post a shift to the board');
    await waitFor(() => expect(select.querySelector('option[value="1"]')).not.toBeNull());
    await userEvent.selectOptions(select, '1');
    await userEvent.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => expect(createOpenOffer).toHaveBeenCalledWith(1, undefined));
  });

  it('lists open offers from others and claims one by offering a shift back', async () => {
    getOpenOffers.mockImplementation((mine: boolean) => okResponse(mine ? [] : [offer()]));
    render(<ShiftSwaps />);

    await userEvent.click(await screen.findByRole('button', { name: 'Claim' }));
    await userEvent.selectOptions(
      await screen.findByLabelText('Offer one of your shifts back'),
      '1'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Confirm claim' }));

    await waitFor(() =>
      expect(claimOpenOffer).toHaveBeenCalledWith(4, 1, undefined)
    );
  });

  it('withdraws one of the caller own posted offers', async () => {
    getOpenOffers.mockImplementation((mine: boolean) => okResponse(mine ? [offer()] : []));
    render(<ShiftSwaps />);

    // "Withdraw" also labels the unrelated targeted-request cancel button
    // below; the offer's own appears first, in the "Your posted offers"
    // section above the requests table.
    const [withdrawOffer] = await screen.findAllByRole('button', { name: 'Withdraw' });
    await userEvent.click(withdrawOffer);
    await waitFor(() => expect(cancelOpenOffer).toHaveBeenCalledWith(4));
  });

  it('shows an empty state when the board has nothing open', async () => {
    render(<ShiftSwaps />);
    expect(await screen.findByText('No open offers right now.')).toBeInTheDocument();
  });
});
