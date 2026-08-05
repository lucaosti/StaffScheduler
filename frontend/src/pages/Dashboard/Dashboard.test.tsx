import { screen, waitFor } from '@testing-library/react';
import { render } from '../../test-utils/renderWithClient';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../mocks/server';
import { defaultDashboardStats } from '../../mocks/handlers';

const API_URL = process.env.REACT_APP_API_URL ?? 'http://localhost:3001/api/v1';

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'admin@demo.staffscheduler.local' } }),
}));

import Dashboard from './Dashboard';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('<Dashboard />', () => {
  it('shows the spinner while the stats request is in flight', () => {
    server.use(
      // Never resolve so the loading frame is preserved.
      http.get(`${API_URL}/dashboard/stats`, () => new Promise<Response>(() => {}))
    );
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getByText(/loading dashboard/i)).toBeInTheDocument();
  });

  it('renders the totals returned by the API', async () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await waitFor(() =>
      expect(screen.queryByText(/loading dashboard/i)).not.toBeInTheDocument()
    );
    expect(
      screen.getByText(String(defaultDashboardStats.totalEmployees))
    ).toBeInTheDocument();
    expect(
      screen.getByText(String(defaultDashboardStats.activeSchedules))
    ).toBeInTheDocument();
  });

  it('shows the error banner and recovers via Try Again', async () => {
    server.use(
      http.get(`${API_URL}/dashboard/stats`, () =>
        HttpResponse.json({ success: false, error: { code: 'BOOM', message: 'fail' } }, { status: 500 })
      )
    );
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to load/i);

    server.use(
      http.get(`${API_URL}/dashboard/stats`, () =>
        HttpResponse.json({ success: true, data: defaultDashboardStats })
      )
    );

    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() =>
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    );
    expect(
      screen.getByText(String(defaultDashboardStats.totalEmployees))
    ).toBeInTheDocument();
  });

  it('says nothing about attention items when there are none', async () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await waitFor(() =>
      expect(screen.queryByText(/loading dashboard/i)).not.toBeInTheDocument()
    );
    expect(screen.queryByText('Understaffed shifts')).not.toBeInTheDocument();
    expect(screen.queryByText('Pending approvals — aging')).not.toBeInTheDocument();
  });

  it('shows understaffed shifts and pending-approval aging when there are some', async () => {
    server.use(
      http.get(`${API_URL}/dashboard/attention-items`, () =>
        HttpResponse.json({
          success: true,
          data: {
            understaffedShifts: {
              count: 1,
              truncated: false,
              items: [
                {
                  id: 1,
                  date: '2026-05-01',
                  startTime: '08:00:00',
                  endTime: '16:00:00',
                  departmentName: 'ER',
                  assignedStaff: 1,
                  minStaff: 3,
                },
              ],
            },
            pendingApprovalsAging: {
              count: 1,
              overDay: 1,
              overTwoDays: 0,
              overWeek: 0,
              items: [{ id: 9, changeType: 'Policy.Update', createdAt: '2026-04-30T00:00:00.000Z', ageHours: 30 }],
            },
          },
        })
      )
    );

    render(<MemoryRouter><Dashboard /></MemoryRouter>);

    expect(await screen.findByText('Understaffed shifts')).toBeInTheDocument();
    expect(screen.getByText(/ER/)).toBeInTheDocument();
    expect(screen.getByText('1/3 staffed')).toBeInTheDocument();

    expect(screen.getByText('Pending approvals — aging')).toBeInTheDocument();
    expect(screen.getByText('Policy.Update')).toBeInTheDocument();
    expect(screen.getByText('1d waiting')).toBeInTheDocument();
  });
});
