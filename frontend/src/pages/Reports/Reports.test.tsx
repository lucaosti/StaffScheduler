/**
 * Reports page RTL test driven by MSW.
 *
 * Exercises both report tables, the "no data" empty state, the date
 * filters, and the error path. Renders the real `Reports` page so all
 * of `pages/Reports/Reports.tsx` is exercised.
 *
 * @author Luca Ostinelli
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { rest } from 'msw';
import { server } from '../../mocks/server';
import Reports from './Reports';

const API_URL = process.env.REACT_APP_API_URL ?? 'http://localhost:3001/api';

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('<Reports />', () => {
  it('renders the populated tables on success', async () => {
    server.use(
      rest.get(`${API_URL}/reports/hours-worked`, (_req, res, ctx) =>
        res(
          ctx.status(200),
          ctx.json({
            success: true,
            data: [{ userId: 1, fullName: 'Ada Lovelace', hours: 38.5 }],
          })
        )
      ),
      rest.get(`${API_URL}/reports/cost-by-department`, (_req, res, ctx) =>
        res(
          ctx.status(200),
          ctx.json({
            success: true,
            data: [
              { departmentId: 7, departmentName: 'Emergency', hours: 200, cost: 5000 },
            ],
          })
        )
      )
    );

    render(<Reports />);
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Emergency')).toBeInTheDocument();
    expect(screen.getByText(/Total:/i)).toBeInTheDocument();
  });

  it('renders the "no data" rows when the API returns empty arrays', async () => {
    server.use(
      rest.get(`${API_URL}/reports/hours-worked`, (_req, res, ctx) =>
        res(ctx.status(200), ctx.json({ success: true, data: [] }))
      ),
      rest.get(`${API_URL}/reports/cost-by-department`, (_req, res, ctx) =>
        res(ctx.status(200), ctx.json({ success: true, data: [] }))
      )
    );
    render(<Reports />);
    await waitFor(() =>
      expect(screen.getAllByText(/no data for this range/i).length).toBeGreaterThanOrEqual(1)
    );
  });

  it('shows an error banner when the API request rejects', async () => {
    server.use(
      rest.get(`${API_URL}/reports/hours-worked`, (_req, res) =>
        res.networkError('boom')
      )
    );
    render(<Reports />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('refetches when the date range changes', async () => {
    let calls = 0;
    server.use(
      rest.get(`${API_URL}/reports/hours-worked`, (_req, res, ctx) => {
        calls += 1;
        return res(ctx.status(200), ctx.json({ success: true, data: [] }));
      }),
      rest.get(`${API_URL}/reports/cost-by-department`, (_req, res, ctx) =>
        res(ctx.status(200), ctx.json({ success: true, data: [] }))
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
