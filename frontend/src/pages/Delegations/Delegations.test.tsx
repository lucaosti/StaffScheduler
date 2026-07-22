/**
 * Tests for Delegations page.
 *
 * @author Luca Ostinelli
 */

import { screen, waitFor } from '@testing-library/react';
import { render } from '../../test-utils/renderWithClient';
import userEvent from '@testing-library/user-event';
import Delegations from './Delegations';

jest.mock('../../services/delegationService', () => ({
  listDelegations: jest.fn(),
  createDelegation: jest.fn(),
  revokeDelegation: jest.fn(),
}));

const {
  listDelegations: mockList,
  createDelegation: mockCreate,
  revokeDelegation: mockRevoke,
} = jest.requireMock('../../services/delegationService') as {
  listDelegations: jest.Mock;
  createDelegation: jest.Mock;
  revokeDelegation: jest.Mock;
};

const ACTIVE = {
  id: 1,
  delegatorId: 5,
  delegateeId: 7,
  permissionCodes: ['schedule.manage', 'employee.read'],
  scopeOrgUnitId: null,
  startsAt: '2024-01-10T00:00:00.000Z',
  expiresAt: '2024-02-10T00:00:00.000Z',
  isActive: true,
  createdAt: '2024-01-10T00:00:00.000Z',
  updatedAt: '2024-01-10T00:00:00.000Z',
};

const INACTIVE = {
  ...ACTIVE,
  id: 2,
  delegateeId: 9,
  permissionCodes: ['audit.read'],
  isActive: false,
};

const makeResponse = (items = [ACTIVE, INACTIVE]) => ({
  success: true,
  data: items,
});

beforeEach(() => {
  mockList.mockResolvedValue(makeResponse());
  mockCreate.mockResolvedValue({ success: true, data: { ...ACTIVE, id: 99 } });
  mockRevoke.mockResolvedValue({ success: true, data: null });
});

afterEach(() => jest.clearAllMocks());

describe('<Delegations />', () => {
  it('renders the page heading', async () => {
    render(<Delegations />);
    expect(screen.getByRole('heading', { name: /delegations/i })).toBeInTheDocument();
  });

  it('shows delegations after loading', async () => {
    render(<Delegations />);
    expect(await screen.findByText('schedule.manage')).toBeInTheDocument();
    expect(screen.getByText('employee.read')).toBeInTheDocument();
  });

  it('shows empty state when no delegations', async () => {
    mockList.mockResolvedValue(makeResponse([]));
    render(<Delegations />);
    expect(await screen.findByText(/no delegations found/i)).toBeInTheDocument();
  });

  it('shows error alert on load failure', async () => {
    mockList.mockRejectedValue(new Error('Unauthorized'));
    render(<Delegations />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('shows Revoke button only for active delegations', async () => {
    render(<Delegations />);
    await screen.findByText('schedule.manage');

    expect(screen.getByRole('button', { name: /revoke delegation 1/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /revoke delegation 2/i })).not.toBeInTheDocument();
  });

  it('shows Active/Inactive status badges', async () => {
    render(<Delegations />);
    await screen.findByText('schedule.manage');

    // getAllByText because the column header <th>Active</th> also matches; verify at least one badge
    expect(screen.getAllByText('Active').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('opens revoke modal when Revoke is clicked', async () => {
    render(<Delegations />);
    await screen.findByText('schedule.manage');

    await userEvent.click(screen.getByRole('button', { name: /revoke delegation 1/i }));
    expect(screen.getByRole('dialog', { name: /revoke delegation 1/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/justification/i)).toBeInTheDocument();
  });

  it('calls revokeDelegation and reloads on confirm', async () => {
    render(<Delegations />);
    await screen.findByText('schedule.manage');

    await userEvent.click(screen.getByRole('button', { name: /revoke delegation 1/i }));
    await userEvent.type(screen.getByLabelText(/justification/i), 'User left team');
    await userEvent.click(screen.getByRole('button', { name: /confirm revoke/i }));

    await waitFor(() => expect(mockRevoke).toHaveBeenCalledWith(1, 'User left team'));
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('calls revokeDelegation with null justification when note is empty', async () => {
    render(<Delegations />);
    await screen.findByText('schedule.manage');

    await userEvent.click(screen.getByRole('button', { name: /revoke delegation 1/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirm revoke/i }));

    await waitFor(() => expect(mockRevoke).toHaveBeenCalledWith(1, null));
  });

  it('opens New Delegation modal', async () => {
    render(<Delegations />);
    await screen.findByText('schedule.manage');

    await userEvent.click(screen.getByRole('button', { name: /new delegation/i }));
    expect(screen.getByRole('dialog', { name: /new delegation/i })).toBeInTheDocument();
  });

  it('validates required fields before creating', async () => {
    render(<Delegations />);
    await screen.findByText('schedule.manage');

    await userEvent.click(screen.getByRole('button', { name: /new delegation/i }));
    await userEvent.click(screen.getByRole('button', { name: /submit delegation/i }));

    expect(await screen.findByText(/delegatee user id is required/i)).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('creates a delegation and reloads', async () => {
    render(<Delegations />);
    await screen.findByText('schedule.manage');

    await userEvent.click(screen.getByRole('button', { name: /new delegation/i }));
    await userEvent.type(screen.getByLabelText(/delegatee user id/i), '7');
    // Add a permission code
    await userEvent.type(screen.getByLabelText(/permission code input/i), 'audit.read');
    await userEvent.click(screen.getByRole('button', { name: /add permission code/i }));
    // Set expiry
    await userEvent.type(screen.getByLabelText(/expires at/i), '2025-12-31T00:00');

    await userEvent.click(screen.getByRole('button', { name: /submit delegation/i }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
