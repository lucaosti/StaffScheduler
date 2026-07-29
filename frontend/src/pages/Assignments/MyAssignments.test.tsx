/**
 * My shifts.
 *
 * The assertions worth having are about what is NOT offered: confirm and
 * decline appear only on a pending shift, and no self-service create or
 * complete exists at all. A button the server always refuses teaches the
 * reader that the app is broken rather than that they lack the authority.
 *
 * @author Luca Ostinelli
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../test-utils/renderWithClient';
import MyAssignments from './MyAssignments';

const okResponse = <T,>(data: T) => Promise.resolve({ success: true as const, data });

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 5, permissions: [] } }),
}));

const getAssignments = jest.fn();
const confirmAssignment = jest.fn();
const declineAssignment = jest.fn();

jest.mock('../../services/assignmentService', () => ({
  __esModule: true,
  getAssignments: (...a: unknown[]) => getAssignments(...a),
  confirmAssignment: (...a: unknown[]) => confirmAssignment(...a),
  declineAssignment: (...a: unknown[]) => declineAssignment(...a),
  completeAssignment: jest.fn(),
  createAssignment: jest.fn(),
  deleteAssignment: jest.fn(),
  getAvailableEmployees: jest.fn(),
}));

const assignment = (over: Record<string, unknown> = {}) => ({
  id: 1,
  shiftId: 10,
  userId: 5,
  shiftDate: '2033-04-01',
  startTime: '09:00:00',
  endTime: '17:00:00',
  departmentName: 'Ward A',
  status: 'pending',
  assignedAt: '2033-03-01',
  ...over,
});

beforeEach(() => {
  getAssignments.mockReset().mockImplementation(() => okResponse([assignment()]));
  confirmAssignment.mockReset().mockImplementation(() => okResponse(assignment({ status: 'confirmed' })));
  declineAssignment.mockReset().mockImplementation(() => okResponse(assignment({ status: 'cancelled' })));
});

describe('MyAssignments', () => {
  it('asks only for the signed-in user\'s assignments', async () => {
    render(<MyAssignments />);
    await screen.findByText('Ward A');
    // Without the filter this is every assignment in the organization, which
    // is both wrong and a disclosure.
    expect(getAssignments).toHaveBeenCalledWith({ userId: 5 });
  });

  it('shows the shift with its times', async () => {
    render(<MyAssignments />);
    expect(await screen.findByText('09:00–17:00')).toBeInTheDocument();
  });

  it('shows the empty state rather than a bare table', async () => {
    getAssignments.mockImplementation(() => okResponse([]));
    render(<MyAssignments />);
    expect(await screen.findByText(/no shifts assigned/i)).toBeInTheDocument();
  });

  it('confirms a pending shift', async () => {
    render(<MyAssignments />);
    await screen.findByText('Ward A');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(confirmAssignment).toHaveBeenCalledWith(1));
  });

  it('declines a pending shift', async () => {
    render(<MyAssignments />);
    await screen.findByText('Ward A');
    await userEvent.click(screen.getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(declineAssignment).toHaveBeenCalledWith(1));
  });

  it.each([['confirmed'], ['completed'], ['cancelled']])(
    'offers no decision on a %s shift',
    async (status) => {
      getAssignments.mockImplementation(() => okResponse([assignment({ status })]));
      render(<MyAssignments />);
      await screen.findByText('Ward A');
      // A settled shift is not a question. Offering the buttons would invite a
      // click the server refuses.
      expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Decline' })).not.toBeInTheDocument();
    }
  );

  it('keeps a declined shift visible with its status', async () => {
    getAssignments.mockImplementation(() => okResponse([assignment({ status: 'cancelled' })]));
    render(<MyAssignments />);
    // Removing it would leave someone unsure whether their decline registered.
    expect(await screen.findByText('cancelled')).toBeInTheDocument();
  });

  it('relays the server\'s reason when a decision is refused', async () => {
    confirmAssignment.mockImplementation(() =>
      Promise.reject(new Error('Assignment is not pending'))
    );
    render(<MyAssignments />);
    await screen.findByText('Ward A');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Assignment is not pending');
  });
});
