/**
 * Attendance page tests: clock-in/out, the manager approval queue, and the
 * cost panel — the three daily-use pieces #562 found with zero coverage.
 *
 * @author Luca Ostinelli
 */

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../test-utils/renderWithClient';
import Attendance from './Attendance';

const okResponse = <T,>(data: T) => Promise.resolve({ success: true as const, data });

const mockUseAuth = jest.fn();
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

const getAttendanceRecords = jest.fn();
const getPendingApprovals = jest.fn();
const getCostEstimate = jest.fn();
const clockIn = jest.fn();
const clockOut = jest.fn();
const approveAttendance = jest.fn();
const rejectAttendance = jest.fn();

jest.mock('../../services/attendanceService', () => ({
  __esModule: true,
  getAttendanceRecords: (...a: unknown[]) => getAttendanceRecords(...a),
  getPendingApprovals: (...a: unknown[]) => getPendingApprovals(...a),
  getCostEstimate: (...a: unknown[]) => getCostEstimate(...a),
  clockIn: (...a: unknown[]) => clockIn(...a),
  clockOut: (...a: unknown[]) => clockOut(...a),
  approveAttendance: (...a: unknown[]) => approveAttendance(...a),
  rejectAttendance: (...a: unknown[]) => rejectAttendance(...a),
}));

const record = (over: Record<string, unknown> = {}) => ({
  id: 1,
  userId: 5,
  clockIn: '2033-04-01T09:00:00.000Z',
  clockOut: null,
  status: 'pending',
  createdAt: '2033-04-01T09:00:00.000Z',
  updatedAt: '2033-04-01T09:00:00.000Z',
  ...over,
});

const ordinaryUser = { user: { id: 5, permissions: [] } };
const approverUser = { user: { id: 9, permissions: ['attendance.approve', 'attendance.read'] } };

beforeEach(() => {
  mockUseAuth.mockReturnValue(ordinaryUser);
  getAttendanceRecords.mockReset().mockImplementation(() => okResponse([]));
  getPendingApprovals.mockReset().mockImplementation(() => okResponse([]));
  getCostEstimate.mockReset().mockImplementation(() =>
    okResponse({
      startDate: '2033-03-01', endDate: '2033-04-01', departmentId: null,
      plannedHours: 40, plannedCost: 800, actualHours: 38, actualCost: 760,
    })
  );
  clockIn.mockReset().mockImplementation(() => okResponse(record({ status: 'pending' })));
  clockOut.mockReset().mockImplementation(() => okResponse(record({ clockOut: '2033-04-01T17:00:00.000Z' })));
  approveAttendance.mockReset().mockImplementation(() => okResponse(record({ status: 'approved' })));
  rejectAttendance.mockReset().mockImplementation(() => okResponse(record({ status: 'rejected' })));
});

describe('<Attendance />', () => {
  it('shows "Not clocked in" and clocks in on click, for a caller with no open record', async () => {
    getAttendanceRecords.mockImplementation(() => okResponse([]));
    render(<Attendance />);

    expect(await screen.findByText(/not clocked in/i)).toBeInTheDocument();
    const clockButton = screen.getByRole('button', { name: /clock in/i });

    await userEvent.click(clockButton);

    await waitFor(() => expect(clockIn).toHaveBeenCalled());
  });

  it('shows "Clocked in at ..." and clocks out on click, when a record has no clockOut yet', async () => {
    getAttendanceRecords.mockImplementation(() => okResponse([record({ id: 42 })]));
    render(<Attendance />);

    expect(await screen.findByText(/clocked in at/i)).toBeInTheDocument();
    const clockButton = screen.getByRole('button', { name: /clock out/i });

    await userEvent.click(clockButton);

    await waitFor(() => expect(clockOut).toHaveBeenCalledWith(42));
  });

  it('shows a failed clock-in as an inline error, not a silent no-op', async () => {
    getAttendanceRecords.mockImplementation(() => okResponse([]));
    clockIn.mockRejectedValue(new Error('Already clocked in elsewhere'));
    render(<Attendance />);

    await userEvent.click(await screen.findByRole('button', { name: /clock in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/already clocked in elsewhere/i);
  });

  it('lists the caller\'s own recent punches with their status', async () => {
    getAttendanceRecords.mockImplementation(() =>
      okResponse([record({ id: 1, status: 'approved', clockOut: '2033-04-01T17:00:00.000Z' })])
    );
    render(<Attendance />);

    const table = await screen.findByRole('table');
    expect(within(table).getByText(/approved/i)).toBeInTheDocument();
  });

  it('does not fetch or show the approval queue for a caller without attendance.approve', async () => {
    getAttendanceRecords.mockImplementation(() => okResponse([]));
    render(<Attendance />);

    await screen.findByText(/not clocked in/i);
    expect(screen.queryByText(/pending approval/i)).not.toBeInTheDocument();
    expect(getPendingApprovals).not.toHaveBeenCalled();
  });

  it('does not fetch or show the cost panel for a caller without attendance.read', async () => {
    getAttendanceRecords.mockImplementation(() => okResponse([]));
    render(<Attendance />);

    await screen.findByText(/not clocked in/i);
    expect(screen.queryByText(/labor cost/i)).not.toBeInTheDocument();
    expect(getCostEstimate).not.toHaveBeenCalled();
  });

  describe('as an approver (attendance.approve + attendance.read)', () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue(approverUser);
    });

    it('shows the pending queue and approves a record on click', async () => {
      getPendingApprovals.mockImplementation(() => okResponse([record({ id: 7, userId: 3 })]));
      render(<Attendance />);

      expect(await screen.findByText(/pending approval/i)).toBeInTheDocument();
      await userEvent.click(await screen.findByRole('button', { name: /approve record 7/i }));

      await waitFor(() => expect(approveAttendance).toHaveBeenCalledWith(7));
    });

    it('rejects a record on click', async () => {
      getPendingApprovals.mockImplementation(() => okResponse([record({ id: 8, userId: 3 })]));
      render(<Attendance />);

      await userEvent.click(await screen.findByRole('button', { name: /reject record 8/i }));

      await waitFor(() => expect(rejectAttendance).toHaveBeenCalledWith(8));
    });

    it('shows "nothing waiting for review" when the queue is empty', async () => {
      getPendingApprovals.mockImplementation(() => okResponse([]));
      render(<Attendance />);

      expect(await screen.findByText(/nothing waiting for review/i)).toBeInTheDocument();
    });

    it('renders the planned vs. actual labor cost panel', async () => {
      render(<Attendance />);

      expect(await screen.findByText(/labor cost/i)).toBeInTheDocument();
      expect(screen.getByText('€800.00')).toBeInTheDocument();
      expect(screen.getByText('€760.00')).toBeInTheDocument();
    });

    it('hides the cost panel rather than showing an error when the endpoint 404s (module off)', async () => {
      getCostEstimate.mockImplementation(() => Promise.reject(new Error('Not found')));
      render(<Attendance />);

      await screen.findByText(/not clocked in/i);
      expect(screen.queryByText(/labor cost/i)).not.toBeInTheDocument();
      // The 404 is a "panel not available" case, not a page-level error banner.
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  it('disables the CSV export when there are no records to export', async () => {
    // A disabled ExportCsvLink renders as a <button disabled> — a disabled
    // anchor is still clickable, so the disabled state cannot be an <a>.
    getAttendanceRecords.mockImplementation(() => okResponse([]));
    render(<Attendance />);

    await screen.findByText(/not clocked in/i);
    expect(screen.getByRole('button', { name: /export csv/i })).toBeDisabled();
  });

  it('enables the CSV export as a real link once there are records', async () => {
    getAttendanceRecords.mockImplementation(() => okResponse([record({ clockOut: '2033-04-01T17:00:00.000Z' })]));
    render(<Attendance />);

    const link = await screen.findByRole('link', { name: /export csv/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('/attendance/export'));
  });
});
