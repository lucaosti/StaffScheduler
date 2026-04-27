/**
 * Dashboard page RTL test driven by MSW (v1 API).
 *
 * Verifies the three top-level states of the dashboard:
 *   1. Initial loading spinner is shown.
 *   2. On a successful API response the totals are rendered.
 *   3. On an API failure the error banner is shown and the
 *      "Try Again" button refetches.
 *
 * @author Luca Ostinelli
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { rest } from 'msw';
import { server } from '../../mocks/server';
import { defaultDashboardStats } from '../../mocks/handlers';

const API_URL = process.env.REACT_APP_API_URL ?? 'http://localhost:3001/api';

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'admin@demo.staffscheduler.local' } }),
}));

// eslint-disable-next-line import/first
import Dashboard from './Dashboard';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('<Dashboard />', () => {
  it('shows the spinner while the stats request is in flight', () => {
    server.use(
      rest.get(`${API_URL}/dashboard/stats`, (_req, res, _ctx) =>
        // Never resolve so the loading frame is preserved.
        res(() => new Promise(() => undefined) as never)
      )
    );
    render(<Dashboard />);
    expect(screen.getByText(/loading dashboard/i)).toBeInTheDocument();
  });

  it('renders the totals returned by the API', async () => {
    render(<Dashboard />);
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
      rest.get(`${API_URL}/dashboard/stats`, (_req, res, ctx) =>
        res(ctx.status(500), ctx.json({ success: false, error: { code: 'BOOM', message: 'fail' } }))
      )
    );
    render(<Dashboard />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to load/i);

    server.use(
      rest.get(`${API_URL}/dashboard/stats`, (_req, res, ctx) =>
        res(ctx.status(200), ctx.json({ success: true, data: defaultDashboardStats }))
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
});
