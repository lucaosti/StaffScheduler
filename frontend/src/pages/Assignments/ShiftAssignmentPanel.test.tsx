/**
 * The planner's half of assignments.
 *
 * Two things matter here. The available-employees list is only fetched while
 * the picker is open — asking the server who can work a shift nobody is
 * looking at is work for an answer nobody reads. And the server's refusal is
 * shown verbatim, because those messages are the only place the scheduling
 * rules are explained to a person.
 *
 * @author Luca Ostinelli
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../test-utils/renderWithClient';
import ShiftAssignmentPanel from './ShiftAssignmentPanel';

const okResponse = <T,>(data: T) => Promise.resolve({ success: true as const, data });

const getAssignments = jest.fn();
const getAvailableEmployees = jest.fn();
const createAssignment = jest.fn();
const deleteAssignment = jest.fn();

jest.mock('../../services/assignmentService', () => ({
  __esModule: true,
  getAssignments: (...a: unknown[]) => getAssignments(...a),
  getAvailableEmployees: (...a: unknown[]) => getAvailableEmployees(...a),
  createAssignment: (...a: unknown[]) => createAssignment(...a),
  deleteAssignment: (...a: unknown[]) => deleteAssignment(...a),
  confirmAssignment: jest.fn(),
  declineAssignment: jest.fn(),
  completeAssignment: jest.fn(),
}));

beforeEach(() => {
  getAssignments.mockReset().mockImplementation(() =>
    okResponse([{ id: 1, shiftId: 10, userId: 5, userName: 'Ada Lovelace', status: 'confirmed' }])
  );
  getAvailableEmployees
    .mockReset()
    .mockImplementation(() => okResponse([{ id: 9, firstName: 'Grace', lastName: 'Hopper' }]));
  createAssignment.mockReset().mockImplementation(() => okResponse({ id: 2 }));
  deleteAssignment.mockReset().mockImplementation(() => okResponse(undefined));
});

describe('ShiftAssignmentPanel', () => {
  it('lists who is already on the shift', async () => {
    render(<ShiftAssignmentPanel shiftId={10} canManage />);
    expect(await screen.findByText(/Ada Lovelace/)).toBeInTheDocument();
    expect(getAssignments).toHaveBeenCalledWith({ shiftId: 10 });
  });

  it('does not ask who is available until the picker is opened', async () => {
    render(<ShiftAssignmentPanel shiftId={10} canManage />);
    await screen.findByText(/Ada Lovelace/);
    // Gated with `enabled` rather than fetched eagerly: the answer is
    // worthless to someone who is not choosing.
    expect(getAvailableEmployees).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Assign someone' }));
    await waitFor(() => expect(getAvailableEmployees).toHaveBeenCalledWith(10));
  });

  it('assigns someone the server says is eligible', async () => {
    render(<ShiftAssignmentPanel shiftId={10} canManage />);
    await screen.findByText(/Ada Lovelace/);
    await userEvent.click(screen.getByRole('button', { name: 'Assign someone' }));
    await screen.findByText('Grace Hopper');

    await userEvent.click(screen.getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(createAssignment).toHaveBeenCalledWith({ shiftId: 10, userId: 9 }));
  });

  it('explains an empty candidate list instead of showing nothing', async () => {
    getAvailableEmployees.mockImplementation(() => okResponse([]));
    render(<ShiftAssignmentPanel shiftId={10} canManage />);
    await screen.findByText(/Ada Lovelace/);
    await userEvent.click(screen.getByRole('button', { name: 'Assign someone' }));

    // A blank list reads as a broken screen; the reason is the useful part.
    expect(await screen.findByText(/unqualified, already committed, or unavailable/i)).toBeInTheDocument();
  });

  it('relays the rule the server refused on', async () => {
    createAssignment.mockImplementation(() =>
      Promise.reject(new Error('User has a conflicting assignment at this time'))
    );
    render(<ShiftAssignmentPanel shiftId={10} canManage />);
    await screen.findByText(/Ada Lovelace/);
    await userEvent.click(screen.getByRole('button', { name: 'Assign someone' }));
    await screen.findByText('Grace Hopper');
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }));

    // The picker narrows the candidates, but a rule can still fire between
    // opening it and clicking — and this message is the only place that rule
    // is ever explained to a person.
    expect(await screen.findByRole('alert')).toHaveTextContent(/conflicting assignment/);
  });

  it('removes someone from the shift', async () => {
    render(<ShiftAssignmentPanel shiftId={10} canManage />);
    await screen.findByText(/Ada Lovelace/);
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(deleteAssignment).toHaveBeenCalledWith(1));
  });

  it('shows no controls to a caller who may only look', async () => {
    render(<ShiftAssignmentPanel shiftId={10} canManage={false} />);
    await screen.findByText(/Ada Lovelace/);
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Assign someone' })).not.toBeInTheDocument();
  });
});
