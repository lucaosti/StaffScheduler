import { render, screen } from '@testing-library/react';
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

import Schedule from './Schedule';

const ok = <T,>(data: T) => Promise.resolve({ success: true as const, data });

describe('<Schedule />', () => {
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
    mockGetShifts.mockResolvedValue(
      ok([
        {
          id: 100,
          name: 'Day',
          date: todayIso,
          startTime: '08:00',
          endTime: '16:00',
          departmentId: 10,
          minStaff: 2,
          status: 'open',
        },
      ])
    );

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

    // Submit empty -> validation error
    await userEvent.click(screen.getByRole('button', { name: /create schedule/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/please fill in name/i);

    // Fill dates invalid -> end before start
    await userEvent.type(screen.getByLabelText(/name \*/i), 'My Schedule');
    await userEvent.type(screen.getByLabelText(/start date \*/i), '2026-04-10');
    await userEvent.type(screen.getByLabelText(/end date \*/i), '2026-04-01');
    await userEvent.selectOptions(screen.getByLabelText(/department \*/i), '10');
    await userEvent.click(screen.getByRole('button', { name: /create schedule/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/end date must be after start date/i);

    // Fix end date -> success
    await userEvent.clear(screen.getByLabelText(/end date \*/i));
    await userEvent.type(screen.getByLabelText(/end date \*/i), '2026-04-11');
    await userEvent.click(screen.getByRole('button', { name: /create schedule/i }));
    expect(mockCreateSchedule).toHaveBeenCalled();
  });

  it('renders assignments and covers view toggles + generate modal guard', async () => {
    render(<Schedule />);
    await screen.findByRole('heading', { name: /schedule management/i });

    // Assignment cell should show Unknown and "Need more" for minStaff 2 with only 1 assignment
    expect(await screen.findByText(/Unknown/i)).toBeInTheDocument();
    expect(screen.getByText(/Need 1 more/i)).toBeInTheDocument();

    // Toggle month view (branch)
    await userEvent.click(screen.getByRole('button', { name: /month/i }));
    expect(screen.getByText(/Monthly View/i)).toBeInTheDocument();

    // Generate modal is enabled when schedules exist; submit with selected schedule -> ok
    await userEvent.click(screen.getAllByRole('button', { name: /^generate$/i })[0]);
    expect(screen.getByText(/Generate Schedule/i)).toBeInTheDocument();
    const dialog = screen.getByRole('dialog');
    await userEvent.click(
      // modal submit
      (dialog.querySelector('button[type="submit"]') as HTMLButtonElement)
    );
    expect(mockGenerateSchedule).toHaveBeenCalled();
  });
});

