/**
 * On call.
 *
 * The rota is a statement about where named colleagues have to be reachable,
 * so the permission gates are what the tests are mostly about: the period list
 * is not fetched without `schedule.read`, and the employee picker is not
 * fetched at all unless someone can actually add a person to an open period.
 *
 * @author Luca Ostinelli
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../test-utils/renderWithClient';
import OnCall from './OnCall';

const okResponse = <T,>(data: T) => Promise.resolve({ success: true as const, data });

let permissions: string[] = [];
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 5, permissions } }),
}));

const getMyOnCall = jest.fn();
const getOnCallPeriods = jest.fn();
const getPeriodAssignments = jest.fn();
const assignToPeriod = jest.fn();
const removeFromPeriod = jest.fn();
const deleteOnCallPeriod = jest.fn();

jest.mock('../../services/onCallService', () => ({
  __esModule: true,
  getMyOnCall: (...a: unknown[]) => getMyOnCall(...a),
  getOnCallPeriods: (...a: unknown[]) => getOnCallPeriods(...a),
  getPeriodAssignments: (...a: unknown[]) => getPeriodAssignments(...a),
  assignToPeriod: (...a: unknown[]) => assignToPeriod(...a),
  removeFromPeriod: (...a: unknown[]) => removeFromPeriod(...a),
  deleteOnCallPeriod: (...a: unknown[]) => deleteOnCallPeriod(...a),
  createOnCallPeriod: jest.fn(),
  updateOnCallPeriod: jest.fn(),
}));

const getEmployees = jest.fn();
jest.mock('../../services/employeeService', () => ({
  __esModule: true,
  getEmployees: (...a: unknown[]) => getEmployees(...a),
}));

const period = (over: Record<string, unknown> = {}) => ({
  id: 1,
  scheduleId: null,
  departmentId: 3,
  departmentName: 'Ward A',
  date: '2033-04-01',
  startTime: '18:00:00',
  endTime: '08:00:00',
  minStaff: 2,
  maxStaff: 3,
  notes: null,
  status: 'open',
  assignedCount: 2,
  ...over,
});

beforeEach(() => {
  permissions = [];
  getMyOnCall.mockReset().mockImplementation(() => okResponse([period()]));
  getOnCallPeriods.mockReset().mockImplementation(() => okResponse([period()]));
  getPeriodAssignments
    .mockReset()
    .mockImplementation(() =>
      okResponse([{ id: 7, periodId: 1, userId: 9, userName: 'Grace Hopper', status: 'confirmed', notes: null }])
    );
  getEmployees
    .mockReset()
    .mockImplementation(() => okResponse([{ id: 9, firstName: 'Grace', lastName: 'Hopper' }]));
  assignToPeriod.mockReset().mockImplementation(() => okResponse({ id: 8 }));
  removeFromPeriod.mockReset().mockImplementation(() => okResponse(undefined));
  deleteOnCallPeriod.mockReset().mockImplementation(() => okResponse(undefined));
});

describe('when I am on call', () => {
  it('is shown to everyone, with no permission required', async () => {
    render(<OnCall />);
    // `/on-call/me` is gated on authentication alone: knowing when you are on
    // call is not a manager's information.
    expect(await screen.findByText(/2033-04-01 18:00–08:00/)).toBeInTheDocument();
  });

  it('shows an empty state rather than a bare list', async () => {
    getMyOnCall.mockImplementation(() => okResponse([]));
    render(<OnCall />);
    expect(await screen.findByText(/not on call in this range/i)).toBeInTheDocument();
  });
});

describe('the rota', () => {
  it('is not fetched at all without schedule.read', async () => {
    render(<OnCall />);
    await screen.findByText(/2033-04-01 18:00–08:00/);
    // Gated with `enabled`, not hidden after fetching: the rota says where
    // named colleagues have to be reachable.
    expect(getOnCallPeriods).not.toHaveBeenCalled();
  });

  it('is fetched with schedule.read', async () => {
    permissions = ['schedule.read'];
    render(<OnCall />);
    await waitFor(() => expect(getOnCallPeriods).toHaveBeenCalled());
  });

  it('marks a period that is short of its minimum', async () => {
    permissions = ['schedule.read'];
    getOnCallPeriods.mockImplementation(() =>
      okResponse([period({ assignedCount: 1, minStaff: 2 })])
    );
    render(<OnCall />);
    // The only question anyone asks of a rota is whether it is covered.
    expect(await screen.findByText(/1\/2 — short/)).toBeInTheDocument();
  });

  it('does not mark a covered period as short', async () => {
    permissions = ['schedule.read'];
    render(<OnCall />);
    expect(await screen.findByText('2/2')).toBeInTheDocument();
    expect(screen.queryByText(/short/)).not.toBeInTheDocument();
  });
});

describe('managing', () => {
  it('offers no delete without oncall.manage', async () => {
    permissions = ['schedule.read'];
    render(<OnCall />);
    await screen.findByRole('button', { name: 'Who' });
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('deletes a period with oncall.manage', async () => {
    permissions = ['schedule.read', 'oncall.manage'];
    render(<OnCall />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteOnCallPeriod).toHaveBeenCalledWith(1));
  });

  it('shows who is on call for an opened period', async () => {
    permissions = ['schedule.read'];
    render(<OnCall />);
    await userEvent.click(await screen.findByRole('button', { name: 'Who' }));
    expect(await screen.findByText(/Grace Hopper/)).toBeInTheDocument();
  });

  it('does not fetch the employee list until a manager opens a period', async () => {
    permissions = ['schedule.read', 'oncall.manage'];
    render(<OnCall />);
    await screen.findByRole('button', { name: 'Who' });
    // A picker that is not on screen is a request for an answer nobody reads.
    expect(getEmployees).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Who' }));
    await waitFor(() => expect(getEmployees).toHaveBeenCalled());
  });

  it('never fetches the employee list for someone who cannot assign', async () => {
    permissions = ['schedule.read'];
    render(<OnCall />);
    await userEvent.click(await screen.findByRole('button', { name: 'Who' }));
    await screen.findByText(/Grace Hopper/);
    expect(getEmployees).not.toHaveBeenCalled();
  });

  it('adds someone to the rota by name, not by id', async () => {
    permissions = ['schedule.read', 'oncall.manage'];
    render(<OnCall />);
    await userEvent.click(await screen.findByRole('button', { name: 'Who' }));

    // A numeric id field would be unusable by the person actually building a
    // rota.
    await userEvent.selectOptions(await screen.findByLabelText('Person'), '9');
    await userEvent.click(screen.getByRole('button', { name: 'Add to rota' }));
    await waitFor(() => expect(assignToPeriod).toHaveBeenCalledWith(1, 9));
  });

  it('removes someone from the rota', async () => {
    permissions = ['schedule.read', 'oncall.manage'];
    render(<OnCall />);
    await userEvent.click(await screen.findByRole('button', { name: 'Who' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(removeFromPeriod).toHaveBeenCalledWith(1, 9));
  });

  it('relays the server\'s refusal', async () => {
    permissions = ['schedule.read', 'oncall.manage'];
    assignToPeriod.mockImplementation(() =>
      Promise.reject(new Error('Period is already at maximum staffing'))
    );
    render(<OnCall />);
    await userEvent.click(await screen.findByRole('button', { name: 'Who' }));
    await userEvent.selectOptions(await screen.findByLabelText('Person'), '9');
    await userEvent.click(screen.getByRole('button', { name: 'Add to rota' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/maximum staffing/);
  });
});
