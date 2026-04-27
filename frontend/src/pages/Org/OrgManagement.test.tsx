import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockListUnits = jest.fn();
const mockGetTree = jest.fn();
const mockCreateUnit = jest.fn();
const mockDeleteUnit = jest.fn();

const mockListMembers = jest.fn();
const mockAddMember = jest.fn();
const mockSetPrimary = jest.fn();
const mockRemoveMember = jest.fn();

const mockListLoans = jest.fn();
const mockCreateLoan = jest.fn();
const mockApproveLoan = jest.fn();
const mockRejectLoan = jest.fn();
const mockCancelLoan = jest.fn();

jest.mock('../../services/orgService', () => ({
  __esModule: true,
  listUnits: (...args: unknown[]) => mockListUnits(...args),
  getTree: (...args: unknown[]) => mockGetTree(...args),
  createUnit: (...args: unknown[]) => mockCreateUnit(...args),
  deleteUnit: (...args: unknown[]) => mockDeleteUnit(...args),
  listMembers: (...args: unknown[]) => mockListMembers(...args),
  addMember: (...args: unknown[]) => mockAddMember(...args),
  setPrimaryMember: (...args: unknown[]) => mockSetPrimary(...args),
  removeMember: (...args: unknown[]) => mockRemoveMember(...args),
  listLoans: (...args: unknown[]) => mockListLoans(...args),
  createLoan: (...args: unknown[]) => mockCreateLoan(...args),
  approveLoan: (...args: unknown[]) => mockApproveLoan(...args),
  rejectLoan: (...args: unknown[]) => mockRejectLoan(...args),
  cancelLoan: (...args: unknown[]) => mockCancelLoan(...args),
}));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, email: 'admin@x', role: 'admin' } }),
}));

const OrgManagement = require('./OrgManagement').default;

const ok = <T,>(data: T) => Promise.resolve({ success: true as const, data });

describe('<OrgManagement />', () => {
  beforeEach(() => {
    jest.spyOn(window, 'confirm').mockReturnValue(true);

    mockListUnits.mockResolvedValue(ok([{ id: 10, name: 'ER', parentId: null, managerUserId: 1 }]));
    mockGetTree.mockResolvedValue(ok([{ id: 10, name: 'ER', children: [] }]));
    mockListLoans.mockResolvedValue(
      ok([
        {
          id: 50,
          userId: 2,
          requestedBy: 1,
          fromOrgUnitId: 10,
          toOrgUnitId: 10,
          startDate: '2026-04-01',
          endDate: '2026-04-02',
          status: 'pending',
        },
      ])
    );
    mockListMembers.mockResolvedValue(
      ok([
        { id: 1, userId: 2, orgUnitId: 10, isPrimary: false, roleInUnit: 'member', assignedAt: 'x' },
      ])
    );

    mockCreateUnit.mockResolvedValue(ok({ id: 11 }));
    mockDeleteUnit.mockResolvedValue(ok(undefined));
    mockAddMember.mockResolvedValue(ok(undefined));
    mockSetPrimary.mockResolvedValue(ok(undefined));
    mockRemoveMember.mockResolvedValue(ok(undefined));
    mockCreateLoan.mockResolvedValue(ok({ id: 99 }));
    mockApproveLoan.mockResolvedValue(ok({ id: 50 }));
    mockRejectLoan.mockResolvedValue(ok({ id: 50 }));
    mockCancelLoan.mockResolvedValue(ok({ id: 50 }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('covers tree, members, and loans actions', async () => {
    render(<OrgManagement />);
    expect(await screen.findByRole('heading', { name: /^organization$/i })).toBeInTheDocument();

    // Tree: create unit
    await userEvent.type(screen.getByPlaceholderText(/unit name/i), 'ICU');
    await userEvent.click(screen.getByRole('button', { name: /create/i }));
    expect(mockCreateUnit).toHaveBeenCalled();

    // Tree: delete unit (scope to the tree table to avoid matching the <option>)
    const treeTable = screen.getByRole('table');
    const treeRow = within(treeTable)
      .getAllByRole('row')
      .find((r) => within(r).queryByText(/^ER$/i));
    expect(treeRow).toBeTruthy();
    const deleteBtn = within(treeRow as HTMLElement).getByRole('button', { name: /delete/i });
    await userEvent.click(deleteBtn);
    expect(mockDeleteUnit).toHaveBeenCalled();

    // Members: switch tab, select unit, add member, set primary, remove
    await userEvent.click(screen.getAllByRole('button', { name: /^members$/i })[0]);
    await userEvent.selectOptions(screen.getByRole('combobox'), '10');
    await userEvent.type(screen.getByPlaceholderText(/user id/i), '2');
    await userEvent.click(screen.getByRole('button', { name: /add member/i }));
    expect(mockAddMember).toHaveBeenCalled();

    await userEvent.click(await screen.findByRole('button', { name: /make primary/i }));
    expect(mockSetPrimary).toHaveBeenCalled();

    await userEvent.click(await screen.findByRole('button', { name: /remove/i }));
    expect(mockRemoveMember).toHaveBeenCalled();

    // Loans: switch tab, create loan, approve/reject/cancel pending
    await userEvent.click(screen.getAllByRole('button', { name: /^loans$/i })[0]);
    const requestBtn = screen.getByRole('button', { name: /request loan/i });

    await userEvent.type(screen.getAllByPlaceholderText(/user id/i)[0], '2');
    const selects = screen.getAllByRole('combobox');
    // In Loans tab, the from/to selects are the last 2 comboboxes.
    await userEvent.selectOptions(selects[selects.length - 2], '10');
    await userEvent.selectOptions(selects[selects.length - 1], '10');

    const dateInputs = screen.getAllByDisplayValue('');
    const loanDateInputs = dateInputs.filter(
      (el): el is HTMLInputElement =>
        el instanceof HTMLInputElement && el.type === 'date'
    );
    expect(loanDateInputs.length).toBeGreaterThanOrEqual(2);
    await userEvent.type(loanDateInputs[0], '2026-04-01');
    await userEvent.type(loanDateInputs[1], '2026-04-02');

    await userEvent.click(requestBtn);
    expect(mockCreateLoan).toHaveBeenCalled();

    await userEvent.click(await screen.findByRole('button', { name: /approve/i }));
    expect(mockApproveLoan).toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: /reject/i }));
    expect(mockRejectLoan).toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: /cancel/i }));
    expect(mockCancelLoan).toHaveBeenCalled();
  });
});

