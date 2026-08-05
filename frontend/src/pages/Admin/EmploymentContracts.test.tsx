/**
 * Employment contracts.
 *
 * The assertions that matter are about the difference between "no limit" and
 * "a limit of zero". A blank field must be omitted from the request, not sent
 * as 0 — one means the contract does not bound that limit and the person falls
 * back to their default, the other caps them at nothing. The same distinction
 * runs through the table and through the open-ended assignment.
 *
 * @author Luca Ostinelli
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../test-utils/renderWithClient';
import EmploymentContracts from './EmploymentContracts';

const okResponse = <T,>(data: T) => Promise.resolve({ success: true as const, data });

let permissions: string[] = ['employee.read', 'preferences.manage'];
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 5, permissions } }),
}));

const getContracts = jest.fn();
const createContract = jest.fn();
const getUserContracts = jest.fn();
const assignContract = jest.fn();

jest.mock('../../services/employmentContractService', () => ({
  __esModule: true,
  getContracts: (...a: unknown[]) => getContracts(...a),
  createContract: (...a: unknown[]) => createContract(...a),
  getUserContracts: (...a: unknown[]) => getUserContracts(...a),
  assignContract: (...a: unknown[]) => assignContract(...a),
  updateContract: jest.fn(),
}));

const getEmployees = jest.fn();
jest.mock('../../services/employeeService', () => ({
  __esModule: true,
  getEmployees: (...a: unknown[]) => getEmployees(...a),
}));

const contract = (over: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'Full time',
  description: null,
  isActive: true,
  maxHoursPerWeek: 40,
  minHoursPerWeek: 0,
  maxHoursPerDay: 8,
  maxConsecutiveDays: 5,
  minHoursBetweenShifts: 11,
  minConsecutiveDaysOff: 2,
  minDaysOffPerPeriod: 3,
  ...over,
});

beforeEach(() => {
  permissions = ['employee.read', 'preferences.manage'];
  getContracts.mockReset().mockImplementation(() => okResponse([contract()]));
  createContract.mockReset().mockImplementation(() => okResponse(contract({ id: 2 })));
  getUserContracts.mockReset().mockImplementation(() =>
    okResponse([
      {
        id: 4,
        userId: 9,
        contractId: 1,
        contractName: 'Full time',
        effectiveFrom: '2033-01-01',
        effectiveTo: null,
      },
    ])
  );
  assignContract.mockReset().mockImplementation(() => okResponse({ id: 5 }));
  getEmployees
    .mockReset()
    .mockImplementation(() => okResponse([{ id: 9, firstName: 'Grace', lastName: 'Hopper' }]));
});

describe('the catalogue', () => {
  it('lists a contract with its limits', async () => {
    render(<EmploymentContracts />);
    // By role: the name also appears in the contract picker, so a bare text
    // match is ambiguous.
    expect(await screen.findByRole('cell', { name: 'Full time' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '40' })).toBeInTheDocument();
  });

  it('shows an unset limit as not constrained, not as zero', async () => {
    getContracts.mockImplementation(() => okResponse([contract({ maxHoursPerDay: null })]));
    render(<EmploymentContracts />);
    // "0" would read as a cap of no hours at all; a dash would read as unknown.
    expect(await screen.findByText('not constrained')).toBeInTheDocument();
  });

  it('omits a blank limit from the request rather than sending zero', async () => {
    render(<EmploymentContracts />);
    await screen.findByRole('cell', { name: 'Full time' });

    await userEvent.type(screen.getByLabelText('Name'), 'Casual');
    await userEvent.type(screen.getByLabelText('Max hours / week'), '20');
    await userEvent.click(screen.getByRole('button', { name: 'Add contract' }));

    // Sending 0 for the untouched fields would cap someone at nothing.
    await waitFor(() =>
      expect(createContract).toHaveBeenCalledWith({ name: 'Casual', maxHoursPerWeek: 20 })
    );
  });
});

describe('assigning', () => {
  it('sends an empty end date as null, meaning still in force', async () => {
    render(<EmploymentContracts />);
    await screen.findByRole('cell', { name: 'Full time' });

    await userEvent.selectOptions(screen.getByLabelText('Person'), '9');
    await userEvent.selectOptions(screen.getByLabelText('Contract'), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }));

    await waitFor(() =>
      expect(assignContract).toHaveBeenCalledWith(
        9,
        expect.objectContaining({ contractId: 1, effectiveTo: null })
      )
    );
  });

  it('shows an open-ended assignment as still in force', async () => {
    render(<EmploymentContracts />);
    await screen.findByRole('cell', { name: 'Full time' });
    await userEvent.selectOptions(screen.getByLabelText('Person'), '9');
    // Not a blank cell, which would read as a missing end date rather than as
    // the deliberate absence of one.
    expect(await screen.findByText('still in force')).toBeInTheDocument();
  });

  it('does not fetch a history until someone is chosen', async () => {
    render(<EmploymentContracts />);
    await screen.findByRole('cell', { name: 'Full time' });
    expect(getUserContracts).not.toHaveBeenCalled();

    await userEvent.selectOptions(screen.getByLabelText('Person'), '9');
    await waitFor(() => expect(getUserContracts).toHaveBeenCalledWith(9));
  });

  it('relays the overlap refusal, which is the one that matters', async () => {
    assignContract.mockImplementation(() =>
      Promise.reject(new Error('This user already has a contract covering that period'))
    );
    render(<EmploymentContracts />);
    await screen.findByRole('cell', { name: 'Full time' });
    await userEvent.selectOptions(screen.getByLabelText('Person'), '9');
    await userEvent.selectOptions(screen.getByLabelText('Contract'), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }));

    // Two contracts in force at once has no defined meaning, and the server
    // says which period clashed.
    expect(await screen.findByRole('alert')).toHaveTextContent(/covering that period/);
  });
});

describe('permissions', () => {
  it('shows the catalogue but no controls to a reader', async () => {
    permissions = ['employee.read'];
    render(<EmploymentContracts />);
    await screen.findByRole('cell', { name: 'Full time' });

    // A scheduling manager needs to see why someone can or cannot take a
    // shift; changing the limits is a different authority.
    expect(screen.queryByRole('button', { name: 'Add contract' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Person')).not.toBeInTheDocument();
  });

  it('never fetches the employee list for a reader', async () => {
    permissions = ['employee.read'];
    render(<EmploymentContracts />);
    await screen.findByRole('cell', { name: 'Full time' });
    expect(getEmployees).not.toHaveBeenCalled();
  });

  it('says on the page that this is not self-service', async () => {
    render(<EmploymentContracts />);
    // These limits are legally bounded and were once editable by the person
    // they applied to — the defect the entity exists to make impossible.
    expect(
      await screen.findByText(/never by the person they apply to/i)
    ).toBeInTheDocument();
  });
});
