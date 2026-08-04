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
const previewVcardImport = jest.fn();
const importVcard = jest.fn();

jest.mock('../../services/directoryService', () => ({
  __esModule: true,
  getMyProfile: (...a: unknown[]) => getMyProfile(...a),
  getProfile: (...a: unknown[]) => getProfile(...a),
  saveProfileFields: (...a: unknown[]) => saveProfileFields(...a),
  removeProfileField: (...a: unknown[]) => removeProfileField(...a),
  previewVcardImport: (...a: unknown[]) => previewVcardImport(...a),
  importVcard: (...a: unknown[]) => importVcard(...a),
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
  previewVcardImport.mockReset();
  importVcard.mockReset();
});

/** jsdom has no FileReader-driven file content by default; this stands in for
 * a user picking a .vcf file and the browser reading its text. */
const chooseVcfFile = async (contents: string, name = 'contacts.vcf') => {
  const input = screen.getByLabelText('.vcf file') as HTMLInputElement;
  const file = new File([contents], name, { type: 'text/vcard' });
  await userEvent.upload(input, file);
};

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

describe('bulk vCard import (#534)', () => {
  it('is absent without user.manage', async () => {
    render(<Directory />);
    await screen.findByText('Ada Lovelace');
    expect(screen.queryByText('Bulk import from vCard')).not.toBeInTheDocument();
  });

  it('previews what a file will do before anything is written', async () => {
    permissions = ['user.manage'];
    previewVcardImport.mockImplementation(() =>
      okResponse({
        rows: [
          { email: 'new@x.com', name: 'New Person', outcome: 'create' },
          { email: 'dup@x.com', name: 'Dup Person', outcome: 'skip', reason: 'email already exists' },
        ],
      })
    );
    render(<Directory />);
    await screen.findByText('Ada Lovelace');

    await chooseVcfFile('BEGIN:VCARD\r\nFN:New Person\r\nEMAIL:new@x.com\r\nEND:VCARD\r\n');
    await userEvent.click(await screen.findByRole('button', { name: /preview contacts\.vcf/i }));

    expect(await screen.findByText('Will create an account')).toBeInTheDocument();
    expect(screen.getByText('Will skip — email already exists')).toBeInTheDocument();
    expect(importVcard).not.toHaveBeenCalled();
  });

  it('requires a password of at least 8 characters before confirming', async () => {
    permissions = ['user.manage'];
    previewVcardImport.mockImplementation(() =>
      okResponse({ rows: [{ email: 'new@x.com', name: 'New Person', outcome: 'create' }] })
    );
    render(<Directory />);
    await screen.findByText('Ada Lovelace');
    await chooseVcfFile('BEGIN:VCARD\r\nFN:New Person\r\nEMAIL:new@x.com\r\nEND:VCARD\r\n');
    await userEvent.click(await screen.findByRole('button', { name: /preview contacts\.vcf/i }));
    await screen.findByText('Will create an account');

    const confirm = screen.getByRole('button', { name: /confirm import/i });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/initial password/i), 'longenough1');
    expect(confirm).toBeEnabled();
  });

  it('reports the outcome and offers to import another file, without exposing the write behind only a total', async () => {
    permissions = ['user.manage'];
    previewVcardImport.mockImplementation(() =>
      okResponse({ rows: [{ email: 'new@x.com', name: 'New Person', outcome: 'create' }] })
    );
    importVcard.mockImplementation(() =>
      okResponse({ inserted: 1, skipped: [{ email: 'dup@x.com', reason: 'email already exists' }] })
    );
    render(<Directory />);
    await screen.findByText('Ada Lovelace');
    await chooseVcfFile('BEGIN:VCARD\r\nFN:New Person\r\nEMAIL:new@x.com\r\nEND:VCARD\r\n');
    await userEvent.click(await screen.findByRole('button', { name: /preview contacts\.vcf/i }));
    await screen.findByText('Will create an account');
    await userEvent.type(screen.getByLabelText(/initial password/i), 'longenough1');
    await userEvent.click(screen.getByRole('button', { name: /confirm import/i }));

    await waitFor(() =>
      expect(importVcard).toHaveBeenCalledWith(
        'BEGIN:VCARD\r\nFN:New Person\r\nEMAIL:new@x.com\r\nEND:VCARD\r\n',
        'longenough1'
      )
    );
    expect(await screen.findByText(/created 1 account/i)).toBeInTheDocument();
    expect(screen.getByText(/skipped 1: dup@x\.com \(email already exists\)/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Import another file' }));
    expect(screen.queryByText(/created 1 account/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText('.vcf file')).toBeInTheDocument();
  });
});
