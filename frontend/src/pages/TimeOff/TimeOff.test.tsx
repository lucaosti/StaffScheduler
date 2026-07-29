/**
 * Time off.
 *
 * Two things carry weight beyond the plumbing. The approver's queue must not
 * be fetched by someone who cannot act on it — a queue nobody may decide is a
 * list of other people's private business. And an approved request is not yet
 * time off: approval writes an unavailability row, and until that exists the
 * optimizer has never been told, which is the difference between "approved"
 * and "you are actually off".
 *
 * @author Luca Ostinelli
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../test-utils/renderWithClient';
import TimeOff from './TimeOff';

const okResponse = <T,>(data: T) => Promise.resolve({ success: true as const, data });

let permissions: string[] = [];
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 5, permissions } }),
}));

const getTimeOffRequests = jest.fn();
const createTimeOffRequest = jest.fn();
const approveTimeOff = jest.fn();
const rejectTimeOff = jest.fn();
const cancelTimeOff = jest.fn();

jest.mock('../../services/timeOffService', () => ({
  __esModule: true,
  getTimeOffRequests: (...a: unknown[]) => getTimeOffRequests(...a),
  createTimeOffRequest: (...a: unknown[]) => createTimeOffRequest(...a),
  approveTimeOff: (...a: unknown[]) => approveTimeOff(...a),
  rejectTimeOff: (...a: unknown[]) => rejectTimeOff(...a),
  cancelTimeOff: (...a: unknown[]) => cancelTimeOff(...a),
}));

const req = (over: Record<string, unknown> = {}) => ({
  id: 1,
  userId: 5,
  startDate: '2033-04-01',
  endDate: '2033-04-03',
  type: 'vacation',
  reason: 'Holiday',
  status: 'pending',
  reviewerId: null,
  reviewedAt: null,
  reviewNotes: null,
  unavailabilityId: null,
  createdAt: 'x',
  updatedAt: 'x',
  ...over,
});

beforeEach(() => {
  permissions = [];
  getTimeOffRequests.mockReset().mockImplementation(() => okResponse([req()]));
  createTimeOffRequest.mockReset().mockImplementation(() => okResponse(req()));
  approveTimeOff.mockReset().mockImplementation(() => okResponse(req({ status: 'approved' })));
  rejectTimeOff.mockReset().mockImplementation(() => okResponse(req({ status: 'rejected' })));
  cancelTimeOff.mockReset().mockImplementation(() => okResponse(req({ status: 'cancelled' })));
});

describe('TimeOff', () => {
  it('asks only for the signed-in user\'s requests', async () => {
    render(<TimeOff />);
    await screen.findByText('2033-04-01 → 2033-04-03');
    expect(getTimeOffRequests).toHaveBeenCalledWith({ userId: 5 });
  });

  it('submits a request', async () => {
    render(<TimeOff />);
    await screen.findByText('2033-04-01 → 2033-04-03');

    await userEvent.clear(screen.getByLabelText('From'));
    await userEvent.type(screen.getByLabelText('From'), '2033-05-01');
    await userEvent.clear(screen.getByLabelText('To'));
    await userEvent.type(screen.getByLabelText('To'), '2033-05-05');
    await userEvent.click(screen.getByRole('button', { name: 'Request' }));

    await waitFor(() =>
      expect(createTimeOffRequest).toHaveBeenCalledWith(
        expect.objectContaining({ startDate: '2033-05-01', endDate: '2033-05-05', type: 'vacation' })
      )
    );
  });

  it('omits an empty reason rather than sending an empty string', async () => {
    render(<TimeOff />);
    await screen.findByText('2033-04-01 → 2033-04-03');
    await userEvent.click(screen.getByRole('button', { name: 'Request' }));
    await waitFor(() =>
      expect(createTimeOffRequest).toHaveBeenCalledWith(
        expect.objectContaining({ reason: undefined })
      )
    );
  });

  it('cancels a pending request of one\'s own', async () => {
    render(<TimeOff />);
    await screen.findByText('2033-04-01 → 2033-04-03');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(cancelTimeOff).toHaveBeenCalledWith(1));
  });

  it('offers no cancellation on a decided request', async () => {
    getTimeOffRequests.mockImplementation(() => okResponse([req({ status: 'approved' })]));
    render(<TimeOff />);
    await screen.findByText('2033-04-01 → 2033-04-03');
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  describe('approved is not yet off', () => {
    it('says the absence is not recorded until an unavailability row exists', async () => {
      getTimeOffRequests.mockImplementation(() =>
        okResponse([req({ status: 'approved', unavailabilityId: null })])
      );
      render(<TimeOff />);
      // The distinction someone reading this page most needs before making
      // plans: approval alone has not told the optimizer anything.
      expect(await screen.findByText('Not yet recorded')).toBeInTheDocument();
    });

    it('says it is recorded once the row exists', async () => {
      getTimeOffRequests.mockImplementation(() =>
        okResponse([req({ status: 'approved', unavailabilityId: 77 })])
      );
      render(<TimeOff />);
      expect(await screen.findByText('Recorded')).toBeInTheDocument();
    });

    it('says nothing about it for a request nobody has decided', async () => {
      render(<TimeOff />);
      await screen.findByText('2033-04-01 → 2033-04-03');
      // "Not yet recorded" on a pending request would read as a problem
      // rather than as the ordinary state of not having been decided.
      expect(screen.queryByText('Not yet recorded')).not.toBeInTheDocument();
    });
  });

  describe('the approver queue', () => {
    it('is not fetched at all without timeoff.approve', async () => {
      render(<TimeOff />);
      await screen.findByText('2033-04-01 → 2033-04-03');
      // Gated with `enabled`, not hidden after fetching: a queue nobody may
      // decide is a list of other people's private business.
      expect(getTimeOffRequests).toHaveBeenCalledTimes(1);
      expect(getTimeOffRequests).not.toHaveBeenCalledWith({ status: 'pending' });
      expect(screen.queryByText(/awaiting a decision/i)).not.toBeInTheDocument();
    });

    it('is fetched and shown with timeoff.approve', async () => {
      permissions = ['timeoff.approve'];
      render(<TimeOff />);
      expect(await screen.findByText(/awaiting a decision/i)).toBeInTheDocument();
      await waitFor(() =>
        expect(getTimeOffRequests).toHaveBeenCalledWith({ status: 'pending' })
      );
    });

    it('approves and rejects', async () => {
      permissions = ['timeoff.approve'];
      render(<TimeOff />);
      // Wait for the queue itself, not just its heading: the heading renders
      // while the query is still in flight.
      await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
      await waitFor(() => expect(approveTimeOff).toHaveBeenCalledWith(1, undefined));

      await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
      await waitFor(() => expect(rejectTimeOff).toHaveBeenCalledWith(1, undefined));
    });
  });

  it('relays the server\'s reason when a request is refused', async () => {
    createTimeOffRequest.mockImplementation(() =>
      Promise.reject(new Error('Overlapping time-off request already exists'))
    );
    render(<TimeOff />);
    await screen.findByText('2033-04-01 → 2033-04-03');
    await userEvent.click(screen.getByRole('button', { name: 'Request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Overlapping/);
  });
});
