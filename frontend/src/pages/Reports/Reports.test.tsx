import { screen, waitFor } from '@testing-library/react';
import { render } from '../../test-utils/renderWithClient';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../mocks/server';
import Reports from './Reports';

const API_URL = process.env.REACT_APP_API_URL ?? 'http://localhost:3001/api';

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('<Reports />', () => {
  it('renders the populated tables on success', async () => {
    server.use(
      http.get(`${API_URL}/reports/hours-worked`, () =>
        HttpResponse.json({
          success: true,
          data: [{ userId: 1, fullName: 'Ada Lovelace', hours: 38.5 }],
        })
      ),
      http.get(`${API_URL}/reports/cost-by-department`, () =>
        HttpResponse.json({
          success: true,
          data: [
            { departmentId: 7, departmentName: 'Emergency', hours: 200, cost: 5000 },
          ],
        })
      )
    );

    render(<Reports />);
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Emergency')).toBeInTheDocument();
    expect(screen.getByText(/Total:/i)).toBeInTheDocument();
  });

  it('renders the "no data" rows when the API returns empty arrays', async () => {
    server.use(
      http.get(`${API_URL}/reports/hours-worked`, () =>
        HttpResponse.json({ success: true, data: [] })
      ),
      http.get(`${API_URL}/reports/cost-by-department`, () =>
        HttpResponse.json({ success: true, data: [] })
      )
    );
    render(<Reports />);
    await waitFor(() =>
      expect(screen.getAllByText(/no data for this range/i).length).toBeGreaterThanOrEqual(1)
    );
  });

  it('shows an error banner when the API request rejects', async () => {
    server.use(
      http.get(`${API_URL}/reports/hours-worked`, () => HttpResponse.error())
    );
    render(<Reports />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('refetches when the date range changes', async () => {
    let calls = 0;
    server.use(
      http.get(`${API_URL}/reports/hours-worked`, () => {
        calls += 1;
        return HttpResponse.json({ success: true, data: [] });
      }),
      http.get(`${API_URL}/reports/cost-by-department`, () =>
        HttpResponse.json({ success: true, data: [] })
      )
    );
    render(<Reports />);
    await waitFor(() => expect(calls).toBeGreaterThanOrEqual(1));
    const firstCalls = calls;
    const startInput = screen.getByLabelText(/from/i) as HTMLInputElement;
    await userEvent.clear(startInput);
    await userEvent.type(startInput, '2024-01-01');
    await waitFor(() => expect(calls).toBeGreaterThan(firstCalls));
  });
});
