import { screen, waitFor } from '@testing-library/react';
import { render } from '../../test-utils/renderWithClient';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../mocks/server';
import { defaultDashboardStats } from '../../mocks/handlers';

const API_URL = process.env.REACT_APP_API_URL ?? 'http://localhost:3001/api/v1';

let permissions: string[] = [];
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'admin@demo.staffscheduler.local', permissions } }),
}));

import Dashboard from './Dashboard';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  permissions = [];
});
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

  it('shows the cost plan target and how far actual cost is from it', async () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await waitFor(() =>
      expect(screen.queryByText(/loading dashboard/i)).not.toBeInTheDocument()
    );
    // defaultDashboardStats: monthlyCost 24600 < monthlyCostPlan 25000 -> under target
    expect(screen.getByText(/^target:/i)).toBeInTheDocument();
    expect(screen.getByText(/under target/i)).toBeInTheDocument();
  });

  it('shows over-target when actual cost exceeds the plan', async () => {
    server.use(
      http.get(`${API_URL}/dashboard/stats`, () =>
        HttpResponse.json({
          success: true,
          data: { ...defaultDashboardStats, monthlyCost: 30000, monthlyCostPlan: 25000 },
        })
      )
    );
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(await screen.findByText(/over target/i)).toBeInTheDocument();
  });

  it('renders no target line when no cost plan has been set', async () => {
    server.use(
      http.get(`${API_URL}/dashboard/stats`, () =>
        HttpResponse.json({
          success: true,
          data: { ...defaultDashboardStats, monthlyCostPlan: null },
        })
      )
    );
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await waitFor(() =>
      expect(screen.queryByText(/loading dashboard/i)).not.toBeInTheDocument()
    );
    expect(screen.queryByText(/target/i)).not.toBeInTheDocument();
  });

  /**
   * #894: the dashboard misled anyone who was not an administrator. Quick
   * actions that create or generate were gated on the READ permissions, so a
   * reader was offered actions the server refuses; the Pending Approvals card
   * showed the organisation-wide count while the caller's own queue was
   * empty; and the activity panel turned a 403 into "No recent activity".
   */
  describe('per role', () => {
    const renderLoaded = async () => {
      render(<MemoryRouter><Dashboard /></MemoryRouter>);
      await waitFor(() => expect(screen.queryByText(/loading dashboard/i)).not.toBeInTheDocument());
    };

    it('offers no create or generate action to a reader', async () => {
      permissions = ['employee.read', 'schedule.read'];
      await renderLoaded();
      expect(screen.queryByRole('link', { name: /add employee/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /generate schedule/i })).not.toBeInTheDocument();
    });

    it('offers them to whoever holds the permissions the server checks', async () => {
      permissions = ['employee.manage', 'schedule.optimize'];
      await renderLoaded();
      expect(screen.getByRole('link', { name: /add employee/i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /generate schedule/i })).toBeInTheDocument();
    });

    it("counts the caller's own pending approvals, not the organisation's", async () => {
      // Stats report 2 org-wide; the caller's queue (attention items) is empty.
      await renderLoaded();
      const card = screen.getByText('Pending Approvals').closest('.card') as HTMLElement;
      expect(card).toHaveTextContent('0');
      expect(card).not.toHaveTextContent(String(defaultDashboardStats.pendingApprovals));
    });

    it('hides the activity panel, and never asks for it, without audit.read', async () => {
      let auditRequested = false;
      server.use(
        http.get(`${API_URL}/audit-logs`, () => {
          auditRequested = true;
          return HttpResponse.json({ success: false, error: { code: 'FORBIDDEN', message: 'no' } }, { status: 403 });
        })
      );
      await renderLoaded();
      expect(screen.queryByText('Recent Activity')).not.toBeInTheDocument();
      expect(screen.queryByText(/no recent activity/i)).not.toBeInTheDocument();
      expect(auditRequested).toBe(false);
    });

    it('shows the activity panel with audit.read', async () => {
      permissions = ['audit.read'];
      await renderLoaded();
      expect(await screen.findByText('Recent Activity')).toBeInTheDocument();
    });
  });

  // The close button used Bootstrap's `data-bs-dismiss`, whose JavaScript is
  // never loaded, so the notice could not be dismissed (#840).
  it('dismisses the access-denied notice with its close button', async () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: '/dashboard', state: { permissionDenied: true } }]}>
        <Dashboard />
      </MemoryRouter>
    );
    expect(screen.getByText('Access denied.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('Access denied.')).not.toBeInTheDocument();
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
