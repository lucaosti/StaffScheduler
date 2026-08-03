import { screen, within, fireEvent, waitFor } from '@testing-library/react';
import { render } from '../../test-utils/renderWithClient';
import userEvent from '@testing-library/user-event';

const mockGetSchedules = jest.fn();
const mockGetScheduleWithShifts = jest.fn();
const mockCreateSchedule = jest.fn();
const mockGenerateSchedule = jest.fn();
const mockPublish = jest.fn();
const mockArchive = jest.fn();

const mockGetEmployees = jest.fn();
const mockGetShifts = jest.fn();
const mockGetDepartments = jest.fn();

jest.mock('../../services/scheduleService', () => ({
  __esModule: true,
  getSchedules: (...args: unknown[]) => mockGetSchedules(...args),
  getScheduleWithShifts: (...args: unknown[]) => mockGetScheduleWithShifts(...args),
  createSchedule: (...args: unknown[]) => mockCreateSchedule(...args),
  generateSchedule: (...args: unknown[]) => mockGenerateSchedule(...args),
  publishSchedule: (...args: unknown[]) => mockPublish(...args),
  archiveSchedule: (...args: unknown[]) => mockArchive(...args),
}));

jest.mock('../../services/employeeService', () => ({
  __esModule: true,
  getEmployees: (...args: unknown[]) => mockGetEmployees(...args),
}));

jest.mock('../../services/shiftService', () => ({
  __esModule: true,
  getShifts: (...args: unknown[]) => mockGetShifts(...args),
}));

jest.mock('../../services/departmentService', () => ({
  __esModule: true,
  getDepartments: (...args: unknown[]) => mockGetDepartments(...args),
}));

const Schedule = require('./Schedule').default;

const ok = <T,>(data: T) => Promise.resolve({ success: true as const, data });

/** The single shift every month-grid assertion is written against. */
let monthShiftFixture: Record<string, unknown>;

describe('<Schedule />', () => {
  afterEach(() => {
    // A no-op when a test never installed fake timers, so this is safe to run
    // unconditionally rather than duplicated per test that needs it.
    jest.useRealTimers();
  });

  beforeEach(() => {
    const today = new Date();
    const todayIso = today.toISOString().slice(0, 10);
    mockGetDepartments.mockResolvedValue(ok([{ id: 10, name: 'Emergency Medicine' }]));
    mockGetEmployees.mockResolvedValue(
      ok([
        {
          id: 1,
          employeeId: 'E-001',
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'ada@example.com',
          isActive: true,
          createdAt: 'x',
          updatedAt: 'x',
        },
      ])
    );
    monthShiftFixture = {
      id: 100,
      name: 'Day',
      date: todayIso,
      startTime: '08:00',
      endTime: '16:00',
      departmentId: 10,
      minStaff: 2,
      status: 'open',
    };
    mockGetShifts.mockResolvedValue(ok([monthShiftFixture]));

    mockGetSchedules.mockResolvedValue(
      ok([
        {
          id: 1,
          name: 'Week 1',
          startDate: '2026-04-01',
          endDate: '2026-04-07',
          status: 'draft',
          createdAt: 'x',
          updatedAt: 'x',
        },
      ])
    );

    mockGetScheduleWithShifts.mockResolvedValue(
      ok({
        id: 1,
        shifts: [
          {
            id: 100,
            assignments: [
              {
                id: 500,
                shiftId: 100,
                userId: 999, // unknown -> "Unknown" branch
                shiftDate: todayIso,
                status: 'pending',
              },
            ],
          },
        ],
      })
    );

    mockCreateSchedule.mockResolvedValue(ok({ id: 2 }));
    mockGenerateSchedule.mockResolvedValue(ok({ message: 'done' }));
    mockPublish.mockResolvedValue(ok({ id: 1 }));
    mockArchive.mockResolvedValue(ok({ id: 1 }));
  });

  it('covers create modal validation + success path', async () => {
    render(<Schedule />);
    expect(await screen.findByRole('heading', { name: /schedule management/i })).toBeInTheDocument();

    // Open create modal
    await userEvent.click(screen.getByTestId('open-create-schedule'));
    expect(screen.getByRole('heading', { name: /create schedule/i })).toBeInTheDocument();

    // Submit empty -> the shared Zod schema (via zodResolver) blocks the submit
    // and surfaces inline field errors; no request is made.
    const modalForm = screen.getByRole('button', { name: /create schedule/i }).closest('form')!;
    fireEvent.submit(modalForm);
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
    expect(mockCreateSchedule).not.toHaveBeenCalled();

    // Fill dates invalid -> end before start (schema's dateOrder refine, attached
    // to the endDate field).
    await userEvent.type(screen.getByLabelText(/name \*/i), 'My Schedule');
    await userEvent.type(screen.getByLabelText(/start date \*/i), '2026-04-10');
    await userEvent.type(screen.getByLabelText(/end date \*/i), '2026-04-01');
    await userEvent.selectOptions(screen.getByLabelText(/department \*/i), '10');
    await userEvent.click(screen.getByRole('button', { name: /create schedule/i }));
    expect(await screen.findByText(/endDate must not be before startDate/i)).toBeInTheDocument();
    expect(mockCreateSchedule).not.toHaveBeenCalled();

    // Fix end date -> success
    await userEvent.clear(screen.getByLabelText(/end date \*/i));
    await userEvent.type(screen.getByLabelText(/end date \*/i), '2026-04-11');
    await userEvent.click(screen.getByRole('button', { name: /create schedule/i }));
    await waitFor(() => expect(mockCreateSchedule).toHaveBeenCalled());
  });

  it('renders assignments and covers view toggles + generate modal guard', async () => {
    render(<Schedule />);
    await screen.findByRole('heading', { name: /schedule management/i });

    // Assignment cell should show Unknown and "Need more" for minStaff 2 with only 1 assignment
    expect(await screen.findByText(/Unknown/i)).toBeInTheDocument();
    expect(screen.getByText(/Need 1 more/i)).toBeInTheDocument();

    // Toggle month view (branch)
    await userEvent.click(screen.getByRole('button', { name: /month/i }));
    expect(await screen.findByRole('table', { name: /monthly shift calendar/i })).toBeInTheDocument();

    // Generate modal is enabled when schedules exist; submit with selected schedule -> ok
    await userEvent.click(screen.getAllByRole('button', { name: /^generate$/i })[0]);
    expect(screen.getByText(/Generate Schedule/i)).toBeInTheDocument();
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /^generate$/i }));
    expect(mockGenerateSchedule).toHaveBeenCalled();
  });

  /**
   * #559: the week view's assignment lookup used to key on
   * `date.toISOString()` (the UTC calendar day of a Date object that still
   * carries a real time-of-day) while the column header showed the same
   * Date's LOCAL calendar day — a real Date at 00:30 in Rome landing an
   * assignment on the wrong column near local midnight. The fix routes both
   * through the same local-day helper, `toLocalDateString`, already covered
   * for the UTC/local disagreement case directly in format.test.ts. This
   * test instead pins the general per-day wiring the bug was symptomatic
   * of — an assignment for a day other than "today" must land under its OWN
   * column, not merely render somewhere in the week — at a fixed midday UTC
   * instant so it is deterministic in every timezone CI might run in.
   */
  it('shows an assignment under its own day-of-week column, not merely somewhere in the week', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-05T12:00:00.000Z')); // Wednesday, midday UTC

    mockGetScheduleWithShifts.mockResolvedValue(
      ok({
        id: 1,
        shifts: [
          {
            id: 100,
            assignments: [
              { id: 501, shiftId: 100, userId: 1, shiftDate: '2026-08-06', status: 'pending' }, // Thursday
            ],
          },
        ],
      })
    );

    render(<Schedule />);
    await screen.findByRole('heading', { name: /schedule management/i });

    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');
    const headerCells = within(rows[0]).getAllByRole('columnheader');
    const thursdayIndex = headerCells.findIndex((th) => /thu/i.test(th.textContent ?? ''));
    const sundayIndex = headerCells.findIndex((th) => /sun/i.test(th.textContent ?? ''));
    expect(thursdayIndex).toBeGreaterThan(0);
    expect(sundayIndex).toBeGreaterThan(0);

    const shiftRow = rows[1];
    const cells = within(shiftRow).getAllByRole('cell');
    expect(within(cells[thursdayIndex]).getByText('Ada Lovelace')).toBeInTheDocument();
    expect(within(cells[sundayIndex]).queryByText('Ada Lovelace')).not.toBeInTheDocument();
  });

  const findChevron = (className: string): HTMLElement => {
    const icon = document.querySelector(className);
    if (!icon) throw new Error(`icon ${className} not found`);
    const button = icon.closest('button');
    if (!button) throw new Error(`no button ancestor for ${className}`);
    return button;
  };

  it("renders today's shift in the monthly calendar grid", async () => {
    render(<Schedule />);
    await screen.findByRole('heading', { name: /schedule management/i });

    await userEvent.click(screen.getByRole('button', { name: /month/i }));
    const table = await screen.findByRole('table', { name: /monthly shift calendar/i });

    // The fixture shift starts at 08:00 in department "Emergency Medicine" (id 10),
    // dated today — it should render as a badge somewhere in the grid.
    expect(within(table).getAllByText((_, el) => el?.tagName === 'SPAN' && (el.textContent ?? '').includes('08:00')).length).toBeGreaterThan(0);
  });

  it('fetches a fresh date range when navigating to the next month', async () => {
    render(<Schedule />);
    await screen.findByRole('heading', { name: /schedule management/i });

    await userEvent.click(screen.getByRole('button', { name: /month/i }));
    await screen.findByRole('table', { name: /monthly shift calendar/i });
    const callsBefore = mockGetShifts.mock.calls.length;

    await userEvent.click(findChevron('.bi-chevron-right'));

    expect(mockGetShifts.mock.calls.length).toBeGreaterThan(callsBefore);
    const lastCallArgs = mockGetShifts.mock.calls[mockGetShifts.mock.calls.length - 1][0];
    expect(lastCallArgs).toHaveProperty('startDate');
    expect(lastCallArgs).toHaveProperty('endDate');
  });

  it('filters the monthly grid by department through the request, not the response', async () => {
    mockGetDepartments.mockResolvedValueOnce(
      ok([
        { id: 10, name: 'Emergency Medicine' },
        { id: 20, name: 'Operations' },
      ])
    );
    // The endpoint accepts departmentId, so the grid asks the server for the
    // narrowed set instead of fetching everything and discarding rows. The
    // fixture shift belongs to department 10, so a request for 20 comes back
    // empty and the grid clears.
    mockGetShifts.mockImplementation((filters: { departmentId?: number } = {}) =>
      Promise.resolve(
        ok(filters.departmentId && filters.departmentId !== 10 ? [] : [monthShiftFixture])
      )
    );

    render(<Schedule />);
    await screen.findByRole('heading', { name: /schedule management/i });

    await userEvent.click(screen.getByRole('button', { name: /month/i }));
    const table = await screen.findByRole('table', { name: /monthly shift calendar/i });
    expect(within(table).getAllByText((_, el) => el?.tagName === 'SPAN' && (el.textContent ?? '').includes('08:00')).length).toBeGreaterThan(0);

    await userEvent.selectOptions(screen.getByRole('combobox'), '20');

    await waitFor(() => {
      const lastArgs = mockGetShifts.mock.calls[mockGetShifts.mock.calls.length - 1][0];
      expect(lastArgs).toMatchObject({ departmentId: 20 });
    });
    await waitFor(() => {
      expect(
        within(table).queryAllByText((_, el) => el?.tagName === 'SPAN' && (el.textContent ?? '').includes('08:00')).length
      ).toBe(0);
    });
  });
});

