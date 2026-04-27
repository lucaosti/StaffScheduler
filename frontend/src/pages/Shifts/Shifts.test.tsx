import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetShifts = jest.fn();
const mockCreateShift = jest.fn();
const mockUpdateShift = jest.fn();
const mockDeleteShift = jest.fn();

const mockGetSchedules = jest.fn();
const mockGetDepartments = jest.fn();

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
    jest.spyOn(window, 'confirm').mockReturnValue(true);

    mockGetSchedules.mockResolvedValue(ok([{ id: 1, name: 'S1', startDate: '2026-04-01', endDate: '2026-04-07', status: 'draft', createdAt: 'x', updatedAt: 'x' }]));
    mockGetDepartments.mockResolvedValue(ok([{ id: 10, name: 'Emergency Medicine' }]));
    mockGetShifts.mockResolvedValue(
      ok([
        {
          id: 5,
          name: 'Night',
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
    jest.restoreAllMocks();
  });

  it('supports search/filter, add modal validation, create, edit, and delete', async () => {
    render(<Shifts />);
    expect(await screen.findByRole('heading', { name: /shift management/i })).toBeInTheDocument();

    // Search term filters the table
    await userEvent.type(screen.getByPlaceholderText(/search shifts/i), 'night');
    expect(screen.getByText(/Night/i)).toBeInTheDocument();

    // Open add modal and trigger validation error
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /add new shift/i })).not.toBeDisabled()
    );
    await userEvent.click(screen.getByRole('button', { name: /add new shift/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /create shift/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/please fill in schedule/i);

    // Fill minimal required fields and create
    const dialog = screen.getByRole('dialog');
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
    await userEvent.type(screen.getByPlaceholderText(/search shifts/i), 'night');
    await userEvent.click(screen.getAllByRole('button', { name: /^edit$/i })[0]);
    await userEvent.clear(screen.getByLabelText(/notes/i));
    await userEvent.type(screen.getByLabelText(/notes/i), 'updated');
    await userEvent.click(screen.getByRole('button', { name: /update shift/i }));
    expect(mockUpdateShift).toHaveBeenCalled();

    // Delete existing shift
    await userEvent.click(screen.getAllByRole('button', { name: /^delete$/i })[0]);
    expect(window.confirm).toHaveBeenCalled();
    expect(mockDeleteShift).toHaveBeenCalled();
  });

  it('does not delete when user cancels confirm', async () => {
    (window.confirm as jest.Mock).mockReturnValueOnce(false);
    render(<Shifts />);
    await screen.findByText(/Night/i);
    // Click any delete action; confirm=false must prevent calling the service.
    await userEvent.click(screen.getAllByRole('button', { name: /^delete$/i })[0]);
    expect(mockDeleteShift).not.toHaveBeenCalled();
  });
});

