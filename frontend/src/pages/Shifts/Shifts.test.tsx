import { screen, waitFor, within, fireEvent } from '@testing-library/react';
import { render } from '../../test-utils/renderWithClient';
import userEvent from '@testing-library/user-event';

const mockGetShifts = jest.fn();
const mockCreateShift = jest.fn();
const mockUpdateShift = jest.fn();
const mockDeleteShift = jest.fn();

const mockGetSchedules = jest.fn();
const mockGetDepartments = jest.fn();

// The page reads the caller's permissions to decide whether to offer the
// staffing action, so it needs the auth context. Declared here rather than
// wrapping in a real provider: these tests are about the shift list, and a
// provider would drag login state into every one of them.
let permissions: string[] = ['assignment.manage'];
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, permissions } }),
}));

jest.mock('../../services/assignmentService', () => ({
  __esModule: true,
  getAssignments: jest.fn(() => Promise.resolve({ success: true, data: [] })),
  getAvailableEmployees: jest.fn(() => Promise.resolve({ success: true, data: [] })),
  createAssignment: jest.fn(),
  deleteAssignment: jest.fn(),
  confirmAssignment: jest.fn(),
  declineAssignment: jest.fn(),
  completeAssignment: jest.fn(),
}));

jest.mock('../../services/shiftService', () => ({
  __esModule: true,
  getShifts: (...args: unknown[]) => mockGetShifts(...args),
  createShift: (...args: unknown[]) => mockCreateShift(...args),
  updateShift: (...args: unknown[]) => mockUpdateShift(...args),
  deleteShift: (...args: unknown[]) => mockDeleteShift(...args),
}));

jest.mock('../../services/scheduleService', () => ({
  __esModule: true,
  getSchedules: (...args: unknown[]) => mockGetSchedules(...args),
}));

jest.mock('../../services/departmentService', () => ({
  __esModule: true,
  getDepartments: (...args: unknown[]) => mockGetDepartments(...args),
}));

const Shifts = require('./Shifts').default;

const ok = <T,>(data: T) => Promise.resolve({ success: true as const, data });

describe('<Shifts />', () => {
  beforeEach(() => {
    permissions = ['assignment.manage'];
    mockGetSchedules.mockResolvedValue(
      ok([
        {
          id: 1,
          name: 'S1',
          startDate: '2026-04-01',
          endDate: '2026-04-07',
          status: 'draft',
          createdAt: 'x',
          updatedAt: 'x',
        },
      ])
    );
    mockGetDepartments.mockResolvedValue(ok([{ id: 10, name: 'Emergency Medicine' }]));
    mockGetShifts.mockResolvedValue(
      ok([
        {
          id: 5,
          // No `name`: the API's Shift contract has none, so the card is
          // labelled "<department> <date>".
          date: '2026-04-02',
          startTime: '22:00',
          endTime: '06:00', // crosses midnight -> duration branch
          scheduleId: 1,
          departmentId: 10,
          minStaff: 2,
          maxStaff: 3,
          status: 'open',
          notes: 'note',
        },
      ])
    );
    mockCreateShift.mockResolvedValue(ok({ id: 99 }));
    mockUpdateShift.mockResolvedValue(ok({ id: 5 }));
    mockDeleteShift.mockResolvedValue(ok(undefined));
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('supports search/filter, add modal validation, create, edit, and delete', async () => {
    render(<Shifts />);
    expect(await screen.findByRole('heading', { name: /shift management/i })).toBeInTheDocument();

    // Search term filters the table. The term must match a field the API
    // actually sends (here `notes`); the search box is debounced by 300ms, so
    // assert *after* the debounce rather than racing it.
    await userEvent.type(screen.getByPlaceholderText(/search shifts/i), 'note');
    expect(await screen.findByText(/Emergency Medicine 2026-04-02/i)).toBeInTheDocument();

    // Open add modal and trigger validation error
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /add new shift/i })).not.toBeDisabled()
    );
    await userEvent.click(screen.getByRole('button', { name: /add new shift/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    // jsdom 20+ enforces HTML5 constraint validation; submit the form directly
    // to bypass it and let the React handler run its own validation check.
    const dialog = screen.getByRole('dialog');
    const modalForm = dialog.querySelector('form')!;
    fireEvent.submit(modalForm);
    expect(await screen.findByRole('alert')).toHaveTextContent(/please fill in schedule/i);

    // Fill minimal required fields and create
    await userEvent.selectOptions(within(dialog).getByLabelText(/^schedule \*/i), '1');
    await userEvent.selectOptions(within(dialog).getByLabelText(/^department \*/i), '10');
    await userEvent.clear(within(dialog).getByLabelText(/^date \*/i));
    await userEvent.type(within(dialog).getByLabelText(/^date \*/i), '2026-04-03');
    await userEvent.clear(within(dialog).getByLabelText(/^start time \*/i));
    await userEvent.type(within(dialog).getByLabelText(/^start time \*/i), '08:00');
    await userEvent.clear(within(dialog).getByLabelText(/^end time \*/i));
    await userEvent.type(within(dialog).getByLabelText(/^end time \*/i), '16:00');
    await userEvent.clear(within(dialog).getByLabelText(/^min staff \*/i));
    await userEvent.type(within(dialog).getByLabelText(/^min staff \*/i), '1');
    await userEvent.click(within(dialog).getByRole('button', { name: /create shift/i }));
    await waitFor(() => expect(mockCreateShift).toHaveBeenCalled());

    // Edit existing shift
    await userEvent.clear(screen.getByPlaceholderText(/search shifts/i));
    await userEvent.type(screen.getByPlaceholderText(/search shifts/i), 'note');
    await screen.findByText(/Emergency Medicine 2026-04-02/i);
    await userEvent.click(screen.getAllByRole('button', { name: /^edit$/i })[0]);
    await userEvent.clear(screen.getByLabelText(/notes/i));
    await userEvent.type(screen.getByLabelText(/notes/i), 'updated');
    await userEvent.click(screen.getByRole('button', { name: /update shift/i }));
    expect(mockUpdateShift).toHaveBeenCalled();

    // Delete existing shift — now uses ConfirmModal; click Delete then Confirm
    await userEvent.click(screen.getAllByRole('button', { name: /^delete$/i })[0]);
    const confirmBtn = await screen.findByRole('button', { name: /^confirm$/i });
    await userEvent.click(confirmBtn);
    expect(mockDeleteShift).toHaveBeenCalled();
  });

  it('does not delete when user cancels the confirm modal', async () => {
    render(<Shifts />);
    await screen.findByText(/Emergency Medicine 2026-04-02/i);
    // Click delete to open the ConfirmModal
    await userEvent.click(screen.getAllByRole('button', { name: /^delete$/i })[0]);
    // Click the Cancel button inside the modal instead of Confirm
    const cancelBtn = await screen.findByRole('button', { name: /^cancel$/i });
    await userEvent.click(cancelBtn);
    expect(mockDeleteShift).not.toHaveBeenCalled();
  });

  /**
   * Staffing a shift is `assignment.manage`; editing the shift itself is not.
   * The menu entry is omitted without it rather than shown and refused — the
   * same rule the rest of the app follows, and the reason `onManageStaff` is
   * an optional prop on the table.
   */
  it('offers the staffing action only with assignment.manage', async () => {
    render(<Shifts />);
    await screen.findByRole('button', { name: /Edit/ });
    expect(screen.getByRole('button', { name: /Staff/ })).toBeInTheDocument();
  });

  it('omits the staffing action without assignment.manage', async () => {
    permissions = [];
    render(<Shifts />);
    await screen.findByRole('button', { name: /Edit/ });
    expect(screen.queryByRole('button', { name: /Staff/ })).not.toBeInTheDocument();
    // Editing and deleting are unaffected: they are a different authority and
    // this change must not have narrowed them.
    expect(screen.getByRole('button', { name: /Edit/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete/ })).toBeInTheDocument();
  });

  it('opens the staffing panel for the chosen shift', async () => {
    render(<Shifts />);
    await screen.findByRole('button', { name: /Edit/ });
    await userEvent.click(screen.getByRole('button', { name: /Staff/ }));

    const dialog = await screen.findByRole('dialog');
    // The heading names the shift, so a modal opened from a long list is not
    // ambiguous about which one it is editing.
    expect(within(dialog).getByText(/2026-04-02/)).toBeInTheDocument();
  });
});
