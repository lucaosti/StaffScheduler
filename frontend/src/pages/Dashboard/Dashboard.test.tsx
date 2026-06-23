import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../mocks/server';
import { defaultDashboardStats } from '../../mocks/handlers';

const API_URL = process.env.REACT_APP_API_URL ?? 'http://localhost:3001/api';

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
});
