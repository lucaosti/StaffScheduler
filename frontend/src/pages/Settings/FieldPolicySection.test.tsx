/**
 * The employee field-rules admin panel.
 *
 * The case with the most weight is the scope switch. A policy row with no
 * organization is the global fallback for everyone; one naming an organization
 * overrides it — and editing the wrong one silently changes the rules for
 * organizations that never asked for it. So the tests pin: the panel starts on
 * the administrator's own organization, the global scope is visibly labelled as
 * a warning, and switching scope re-queries rather than reusing cached data from
 * the other one.
 *
 * The second case is the always-required fields. The server forces `email`,
 * `firstName`, `lastName` required no matter what a policy says; the panel must
 * show that as a disabled, explained control rather than a toggle that looks
 * live and is silently ignored.
 *
 * @author Luca Ostinelli
 */

import { render, screen, waitFor, within, fireEvent } from '../../test-utils/renderWithClient';
import userEvent from '@testing-library/user-event';
import FieldPolicySection from './FieldPolicySection';

const mockList = jest.fn();
const mockSave = jest.fn();
const mockDelete = jest.fn();

jest.mock('../../services/fieldPolicyService', () => ({
  listFieldPolicies: (...args: unknown[]) => mockList(...args),
  saveFieldPolicy: (...args: unknown[]) => mockSave(...args),
  deleteFieldPolicy: (...args: unknown[]) => mockDelete(...args),
}));

const policy = (over: Record<string, unknown> = {}) => ({
  fieldKey: 'phone',
  isRequired: false,
  visiblePermission: null,
  editPermission: null,
  minLength: null,
  maxLength: null,
  minValue: null,
  maxValue: null,
  pattern: null,
  allowedValues: null,
  helpText: null,
  ...over,
});

const fieldSet = (over: Record<string, unknown> = {}) => ({
  data: {
    policies: [],
    governableCoreFields: ['email', 'firstName', 'lastName', 'phone', 'position'],
    ...over,
  },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockList.mockResolvedValue(fieldSet());
  mockSave.mockResolvedValue({ success: true });
  mockDelete.mockResolvedValue({ success: true });
});

describe('<FieldPolicySection />', () => {
  it('starts on the caller\'s own organization', async () => {
    render(<FieldPolicySection organizationName="Acme" />);
    await waitFor(() => expect(mockList).toHaveBeenCalledWith('Acme'));
    // The warning that appears only on the global scope must not show here.
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('labels the global scope as affecting every organization without its own rule', async () => {
    render(<FieldPolicySection organizationName="Acme" />);
    await screen.findByText('phone');

    await userEvent.selectOptions(screen.getByLabelText('Applies to'), '');

    await waitFor(() => expect(mockList).toHaveBeenLastCalledWith(undefined));
    expect(screen.getByRole('note')).toHaveTextContent(/global/i);
  });

  it('lists the governable fields the server sent, not a hard-coded set', async () => {
    mockList.mockResolvedValue(fieldSet({ governableCoreFields: ['email', 'badgeNumber'] }));
    render(<FieldPolicySection organizationName="Acme" />);

    expect(await screen.findByText('badgeNumber')).toBeInTheDocument();
    expect(screen.queryByText('phone')).not.toBeInTheDocument();
  });

  it('shows an always-required field as a disabled, explained switch', async () => {
    render(<FieldPolicySection organizationName="Acme" />);
    await screen.findByText('email');

    const rows = screen.getAllByRole('row');
    const emailRow = rows.find((row) => row.textContent?.includes('email'));
    expect(emailRow).toHaveTextContent('always');

    await userEvent.click(screen.getAllByRole('button', { name: /add rule|edit/i })[0]);
    const toggle = screen.getByLabelText('Required') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    expect(toggle.disabled).toBe(true);
  });

  it('shows no rule for a field that has none, and "Add rule"', async () => {
    render(<FieldPolicySection organizationName="Acme" />);
    await screen.findByText('phone');

    const rows = screen.getAllByRole('row');
    const phoneRow = rows.find((row) => row.textContent?.includes('phone'));
    expect(phoneRow).toHaveTextContent('no rule');
    expect(phoneRow?.querySelector('button')).toHaveTextContent('Add rule');
  });

  it('saves a new rule with the current scope', async () => {
    render(<FieldPolicySection organizationName="Acme" />);
    await screen.findByText('phone');

    const rows = screen.getAllByRole('row');
    const phoneRow = rows.find((row) => row.textContent?.includes('phone'))!;
    await userEvent.click(within(phoneRow).getByRole('button', { name: 'Add rule' }));

    await userEvent.click(screen.getByLabelText('Required'));
    await userEvent.type(screen.getByLabelText(/message shown/i), 'We need a number to reach you.');
    await userEvent.click(screen.getByRole('button', { name: 'Save rule' }));

    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          fieldKey: 'phone',
          isRequired: true,
          organizationName: 'Acme',
          helpText: 'We need a number to reach you.',
        })
      )
    );
  });

  it('sends null organizationName when saving under the global scope', async () => {
    render(<FieldPolicySection organizationName="Acme" />);
    await screen.findByText('phone');
    await userEvent.selectOptions(screen.getByLabelText('Applies to'), '');
    await screen.findByText('phone');

    const rows = screen.getAllByRole('row');
    const phoneRow = rows.find((row) => row.textContent?.includes('phone'))!;
    await userEvent.click(within(phoneRow).getByRole('button', { name: 'Add rule' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save rule' }));

    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ organizationName: null }))
    );
  });

  it('parses a comma-separated vocabulary into a list', async () => {
    render(<FieldPolicySection organizationName="Acme" />);
    await screen.findByText('position');

    const rows = screen.getAllByRole('row');
    const positionRow = rows.find((row) => row.textContent?.includes('position'))!;
    await userEvent.click(within(positionRow).getByRole('button', { name: 'Add rule' }));

    await userEvent.type(screen.getByLabelText(/permitted values/i), 'Nurse, Doctor , Porter');
    await userEvent.click(screen.getByRole('button', { name: 'Save rule' }));

    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({ allowedValues: ['Nurse', 'Doctor', 'Porter'] })
      )
    );
  });

  it('treats an empty numeric field as no rule rather than zero', async () => {
    mockList.mockResolvedValue(fieldSet({ policies: [policy({ minLength: 5 })] }));
    render(<FieldPolicySection organizationName="Acme" />);
    await screen.findByText('phone');

    const rows = screen.getAllByRole('row');
    const phoneRow = rows.find((row) => row.textContent?.includes('phone'))!;
    await userEvent.click(within(phoneRow).getByRole('button', { name: 'Edit' }));

    await userEvent.clear(screen.getByLabelText('Min length'));
    await userEvent.click(screen.getByRole('button', { name: 'Save rule' }));

    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ minLength: null }))
    );
  });

  it('relays a save failure instead of pretending it worked', async () => {
    mockSave.mockRejectedValue(new Error('Pattern is not a valid regular expression'));
    render(<FieldPolicySection organizationName="Acme" />);
    await screen.findByText('phone');

    const rows = screen.getAllByRole('row');
    const phoneRow = rows.find((row) => row.textContent?.includes('phone'))!;
    await userEvent.click(within(phoneRow).getByRole('button', { name: 'Add rule' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save rule' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/not a valid regular expression/);
  });

  it('asks before removing, and names the consequence for the global scope', async () => {
    mockList.mockResolvedValue(fieldSet({ policies: [policy({ isRequired: true })] }));
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
    render(<FieldPolicySection organizationName="Acme" />);
    await screen.findByText('phone');
    await userEvent.selectOptions(screen.getByLabelText('Applies to'), '');
    await screen.findByText('phone');

    const rows = screen.getAllByRole('row');
    const phoneRow = rows.find((row) => row.textContent?.includes('phone'))!;
    await userEvent.click(within(phoneRow).getByRole('button', { name: 'Remove' }));

    expect(confirmSpy.mock.calls[0][0]).toMatch(/every organization without its own rule/i);
    expect(mockDelete).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('removes the rule once confirmed', async () => {
    mockList.mockResolvedValue(fieldSet({ policies: [policy({ isRequired: true })] }));
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    render(<FieldPolicySection organizationName="Acme" />);
    await screen.findByText('phone');

    const rows = screen.getAllByRole('row');
    const phoneRow = rows.find((row) => row.textContent?.includes('phone'))!;
    await userEvent.click(within(phoneRow).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('phone', 'Acme'));
  });

  it('surfaces a load failure', async () => {
    mockList.mockRejectedValue(new Error('boom'));
    render(<FieldPolicySection organizationName="Acme" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
  });

  it('saves every optional constraint the form exposes', async () => {
    render(<FieldPolicySection organizationName="Acme" />);
    await screen.findByText('phone');

    const rows = screen.getAllByRole('row');
    const phoneRow = rows.find((row) => row.textContent?.includes('phone'))!;
    await userEvent.click(within(phoneRow).getByRole('button', { name: 'Add rule' }));

    await userEvent.type(screen.getByLabelText(/changing it needs/i), 'payroll.manage');
    await userEvent.type(screen.getByLabelText(/seeing it needs/i), 'payroll.read');
    await userEvent.type(screen.getByLabelText('Max length'), '20');
    await userEvent.type(screen.getByLabelText('Min value'), '1');
    await userEvent.type(screen.getByLabelText('Max value'), '99');
    fireEvent.change(screen.getByLabelText('Pattern'), { target: { value: '^[0-9]+$' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save rule' }));

    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          editPermission: 'payroll.manage',
          visiblePermission: 'payroll.read',
          maxLength: 20,
          minValue: 1,
          maxValue: 99,
          pattern: '^[0-9]+$',
        })
      )
    );
  });

  it('cancelling the editor discards the draft without saving', async () => {
    render(<FieldPolicySection organizationName="Acme" />);
    await screen.findByText('phone');

    const rows = screen.getAllByRole('row');
    const phoneRow = rows.find((row) => row.textContent?.includes('phone'))!;
    await userEvent.click(within(phoneRow).getByRole('button', { name: 'Add rule' }));
    expect(screen.getByRole('button', { name: 'Save rule' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('button', { name: 'Save rule' })).not.toBeInTheDocument();
    expect(mockSave).not.toHaveBeenCalled();
  });
});
