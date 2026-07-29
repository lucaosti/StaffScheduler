/**
 * User accounts.
 *
 * Three things carry weight. The control says Deactivate because that is what
 * happens — the endpoint is DELETE and the row stays, with its history and its
 * audit trail. Deactivated accounts remain listed, because hiding them makes a
 * disabled account indistinguishable from one that never existed. And no
 * password is typed here by anyone other than its owner.
 *
 * @author Luca Ostinelli
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../test-utils/renderWithClient';
import UserAccounts from './UserAccounts';

const okResponse = <T,>(data: T) => Promise.resolve({ success: true as const, data });

let permissions: string[] = ['user.read', 'user.manage'];
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 5, permissions } }),
}));

const getUserAccounts = jest.fn();
const createUserAccount = jest.fn();
const updateUserAccount = jest.fn();
const deactivateUserAccount = jest.fn();

jest.mock('../../services/userAccountService', () => ({
  __esModule: true,
  getUserAccounts: (...a: unknown[]) => getUserAccounts(...a),
  createUserAccount: (...a: unknown[]) => createUserAccount(...a),
  updateUserAccount: (...a: unknown[]) => updateUserAccount(...a),
  deactivateUserAccount: (...a: unknown[]) => deactivateUserAccount(...a),
}));

jest.mock('../../hooks/useRbac', () => ({
  useRolesAndPermissionsQuery: () => ({
    data: { roles: [{ id: 2, name: 'Manager' }], permissions: [] },
  }),
}));

const account = (over: Record<string, unknown> = {}) => ({
  id: 1,
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  isActive: true,
  roles: [{ id: 2, name: 'Manager' }],
  ...over,
});

beforeEach(() => {
  permissions = ['user.read', 'user.manage'];
  getUserAccounts.mockReset().mockImplementation(() => okResponse([account()]));
  createUserAccount.mockReset().mockImplementation(() => okResponse(account({ id: 2 })));
  updateUserAccount.mockReset().mockImplementation(() => okResponse(account()));
  deactivateUserAccount.mockReset().mockImplementation(() => okResponse(undefined));
});

describe('listing', () => {
  it('shows an account with its roles', async () => {
    render(<UserAccounts />);
    expect(await screen.findByRole('cell', { name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Manager' })).toBeInTheDocument();
  });

  it('keeps a deactivated account visible', async () => {
    getUserAccounts.mockImplementation(() => okResponse([account({ isActive: false })]));
    render(<UserAccounts />);
    // Hiding it would make a disabled account indistinguishable from one that
    // never existed — which is the question someone is asking when they cannot
    // find a colleague.
    expect(await screen.findByText('Deactivated')).toBeInTheDocument();
  });

  it('says this is the account, not the employee record', async () => {
    render(<UserAccounts />);
    // "User" and "employee" are the same word to most readers, and conflating
    // them is how a deactivated account keeps appearing in a roster.
    expect(
      await screen.findByText(/separate from the employee record/i)
    ).toBeInTheDocument();
  });
});

describe('creating', () => {
  it('never sends a password', async () => {
    render(<UserAccounts />);
    await screen.findByRole('cell', { name: 'Ada Lovelace' });

    await userEvent.type(screen.getByLabelText('Email'), 'grace@example.com');
    await userEvent.type(screen.getByLabelText('First name'), 'Grace');
    await userEvent.type(screen.getByLabelText('Last name'), 'Hopper');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(createUserAccount).toHaveBeenCalled());
    // Typing someone else's password into a form is how a shared secret stops
    // being theirs; the holder sets it through the reset flow.
    expect(createUserAccount.mock.calls[0][0]).not.toHaveProperty('password');
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it('omits roleIds entirely when no role is chosen', async () => {
    render(<UserAccounts />);
    await screen.findByRole('cell', { name: 'Ada Lovelace' });

    await userEvent.type(screen.getByLabelText('Email'), 'grace@example.com');
    await userEvent.type(screen.getByLabelText('First name'), 'Grace');
    await userEvent.type(screen.getByLabelText('Last name'), 'Hopper');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(createUserAccount).toHaveBeenCalled());
    // An empty array would say "explicitly no roles"; omitting says nothing
    // about them, which is what an unfilled optional field means.
    expect(createUserAccount.mock.calls[0][0]).not.toHaveProperty('roleIds');
  });

  it('sends the chosen role', async () => {
    render(<UserAccounts />);
    await screen.findByRole('cell', { name: 'Ada Lovelace' });

    await userEvent.type(screen.getByLabelText('Email'), 'grace@example.com');
    await userEvent.type(screen.getByLabelText('First name'), 'Grace');
    await userEvent.type(screen.getByLabelText('Last name'), 'Hopper');
    await userEvent.selectOptions(screen.getByLabelText('Role'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() =>
      expect(createUserAccount).toHaveBeenCalledWith(expect.objectContaining({ roleIds: [2] }))
    );
  });

  it('relays a refused role assignment', async () => {
    createUserAccount.mockImplementation(() =>
      Promise.reject(new Error('Cannot assign a role you do not hold'))
    );
    render(<UserAccounts />);
    await screen.findByRole('cell', { name: 'Ada Lovelace' });
    await userEvent.type(screen.getByLabelText('Email'), 'x@example.com');
    await userEvent.type(screen.getByLabelText('First name'), 'X');
    await userEvent.type(screen.getByLabelText('Last name'), 'Y');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    // The server blocks privilege escalation through role assignment by name.
    expect(await screen.findByRole('alert')).toHaveTextContent(/role you do not hold/);
  });
});

describe('deactivating', () => {
  it('calls the action Deactivate, not Delete', async () => {
    render(<UserAccounts />);
    await screen.findByRole('cell', { name: 'Ada Lovelace' });
    // The endpoint is DELETE and the row stays, with its history and its audit
    // trail. A button promising removal would be lying.
    expect(screen.getByRole('button', { name: 'Deactivate' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('deactivates an account', async () => {
    render(<UserAccounts />);
    await userEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(deactivateUserAccount).toHaveBeenCalledWith(1));
  });

  it('offers reactivation on a deactivated account', async () => {
    getUserAccounts.mockImplementation(() => okResponse([account({ isActive: false })]));
    render(<UserAccounts />);
    await userEvent.click(await screen.findByRole('button', { name: 'Reactivate' }));
    await waitFor(() =>
      expect(updateUserAccount).toHaveBeenCalledWith(1, { isActive: true })
    );
  });
});

describe('permissions', () => {
  it('shows accounts but no controls without user.manage', async () => {
    permissions = ['user.read'];
    render(<UserAccounts />);
    await screen.findByRole('cell', { name: 'Ada Lovelace' });

    expect(screen.queryByRole('button', { name: 'Create account' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
  });

  it('does not fetch anything without a read permission', async () => {
    permissions = [];
    render(<UserAccounts />);
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
    // Gated with `enabled`: a list nobody may see should not be requested.
    expect(getUserAccounts).not.toHaveBeenCalled();
  });
});
