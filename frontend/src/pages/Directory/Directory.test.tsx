/**
 * Directory.
 *
 * The assertion carrying the most weight is the visibility badge on every
 * custom field. A field someone fills in without knowing who will read it is
 * how a private note becomes a published one, so `isPublic` is stated on the
 * row rather than hidden in a dialog nobody opens.
 *
 * @author Luca Ostinelli
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../test-utils/renderWithClient';
import Directory from './Directory';

const okResponse = <T,>(data: T) => Promise.resolve({ success: true as const, data });

let permissions: string[] = [];
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 5, permissions } }),
}));

const getMyProfile = jest.fn();
const getProfile = jest.fn();
const saveProfileFields = jest.fn();
const removeProfileField = jest.fn();

jest.mock('../../services/directoryService', () => ({
  __esModule: true,
  getMyProfile: (...a: unknown[]) => getMyProfile(...a),
  getProfile: (...a: unknown[]) => getProfile(...a),
  saveProfileFields: (...a: unknown[]) => saveProfileFields(...a),
  removeProfileField: (...a: unknown[]) => removeProfileField(...a),
  vcardUrl: (id: number) => `/api/directory/users/${id}/vcard`,
}));

const getEmployees = jest.fn();
jest.mock('../../services/employeeService', () => ({
  __esModule: true,
  getEmployees: (...a: unknown[]) => getEmployees(...a),
}));

const profile = (over: Record<string, unknown> = {}) => ({
  id: 5,
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  roles: ['Employee'],
  employeeId: 'E-1',
  phone: '555',
  position: 'Analyst',
  fields: [{ key: 'Locker', value: '12', isPublic: true }],
  ...over,
});

beforeEach(() => {
  permissions = [];
  getMyProfile.mockReset().mockImplementation(() => okResponse(profile()));
  getProfile.mockReset().mockImplementation(() => okResponse(profile({ id: 9, firstName: 'Grace' })));
  saveProfileFields.mockReset().mockImplementation(() => okResponse(profile()));
  removeProfileField.mockReset().mockImplementation(() => okResponse(undefined));
  getEmployees.mockReset().mockImplementation(() => okResponse([{ id: 9, firstName: 'Grace', lastName: 'Hopper' }]));
});

describe('own profile', () => {
  it('is shown to anyone signed in', async () => {
    render(<Directory />);
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
  });

  it('offers a vCard as a plain link, not a fetch', async () => {
    render(<Directory />);
    const link = await screen.findByRole('link', { name: /download vcard/i });
    // A blob round-trip through the typed client would achieve nothing an
    // anchor does not, and would lose the filename the server sets.
    expect(link).toHaveAttribute('href', '/api/directory/users/5/vcard');
  });

  it('does not offer other people without user.read', async () => {
    render(<Directory />);
    await screen.findByText('Ada Lovelace');
    expect(screen.queryByLabelText('Person')).not.toBeInTheDocument();
    expect(getEmployees).not.toHaveBeenCalled();
  });
});

describe('custom fields', () => {
  it('states the visibility of every field', async () => {
    render(<Directory />);
    // A field filled in without knowing who reads it is how a private note
    // becomes a published one.
    expect(await screen.findByText('Visible to colleagues')).toBeInTheDocument();
  });

  it('distinguishes a private field', async () => {
    getMyProfile.mockImplementation(() =>
      okResponse(profile({ fields: [{ key: 'Note', value: 'x', isPublic: false }] }))
    );
    render(<Directory />);
    expect(await screen.findByText('Private')).toBeInTheDocument();
  });

  it('says so plainly when there are none', async () => {
    getMyProfile.mockImplementation(() => okResponse(profile({ fields: [] })));
    render(<Directory />);
    expect(await screen.findByText('No additional fields.')).toBeInTheDocument();
  });

  it('offers no editing without user.manage', async () => {
    render(<Directory />);
    await screen.findByText('Ada Lovelace');
    expect(screen.queryByRole('button', { name: 'Save field' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('adds a field with user.manage', async () => {
    permissions = ['user.read', 'user.manage'];
    render(<Directory />);
    await screen.findByText('Ada Lovelace');

    await userEvent.type(screen.getByLabelText('Field'), 'Desk');
    await userEvent.type(screen.getByLabelText('Value'), '4B');
    await userEvent.click(screen.getByRole('button', { name: 'Save field' }));

    await waitFor(() =>
      expect(saveProfileFields).toHaveBeenCalledWith(5, [{ key: 'Desk', value: '4B' }])
    );
  });

  it('removes a field', async () => {
    permissions = ['user.read', 'user.manage'];
    render(<Directory />);
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(removeProfileField).toHaveBeenCalledWith(5, 'Locker'));
  });
});

describe('other people', () => {
  it('does not fetch a profile until one is chosen', async () => {
    permissions = ['user.read'];
    render(<Directory />);
    await screen.findByText('Ada Lovelace');
    expect(getProfile).not.toHaveBeenCalled();
  });

  it('shows the chosen person instead of oneself', async () => {
    permissions = ['user.read'];
    render(<Directory />);
    await screen.findByText('Ada Lovelace');

    await userEvent.selectOptions(screen.getByLabelText('Person'), '9');
    await waitFor(() => expect(getProfile).toHaveBeenCalledWith(9));
    expect(await screen.findByText('Grace Lovelace')).toBeInTheDocument();
  });

  it('edits the chosen person\'s fields, not one\'s own', async () => {
    permissions = ['user.read', 'user.manage'];
    render(<Directory />);
    await screen.findByText('Ada Lovelace');
    await userEvent.selectOptions(screen.getByLabelText('Person'), '9');
    await screen.findByText('Grace Lovelace');

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    // The id comes from the profile being shown; using the signed-in user's
    // would silently edit the wrong person.
    await waitFor(() => expect(removeProfileField).toHaveBeenCalledWith(9, 'Locker'));
  });
});
