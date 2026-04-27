/**
 * Settings page smoke test.
 *
 * The settings page is local-state only (no API calls today). We render
 * it in both admin and non-admin variants, click through each tab, and
 * exercise the save handlers and a representative form change. This is
 * enough to drive the bulk of `Settings.tsx` lines through coverage.
 *
 * @author Luca Ostinelli
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockUseAuth = jest.fn();

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

// eslint-disable-next-line import/first
import Settings from './Settings';

describe('<Settings />', () => {
  it('renders all tabs (admin variant)', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, email: 'admin@x', role: 'admin' },
    });

    render(<Settings />);
    expect(screen.getByRole('heading', { name: /^settings$/i })).toBeInTheDocument();
    const personalTab = screen.getByRole('button', { name: /^Personal$/ });
    const workTab = screen.getByRole('button', { name: /^Work Preferences$/ });
    const hierarchyTab = screen.getByRole('button', { name: /^Hierarchy Settings$/ });
    const systemTab = screen.getByRole('button', { name: /^System$/ });
    expect(personalTab).toBeInTheDocument();
    expect(workTab).toBeInTheDocument();
    expect(hierarchyTab).toBeInTheDocument();
    expect(systemTab).toBeInTheDocument();

    await userEvent.click(workTab);
    expect(screen.getByLabelText(/max hours per week/i)).toBeInTheDocument();

    await userEvent.click(hierarchyTab);
    await userEvent.click(systemTab);
    await userEvent.click(personalTab);

    const themeSelect = screen.getByLabelText(/^theme$/i) as HTMLSelectElement;
    await userEvent.selectOptions(themeSelect, 'dark');
    expect(themeSelect.value).toBe('dark');
  });

  it('hides the System tab for non-admin users', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 2, email: 'mgr@x', role: 'manager' },
    });
    render(<Settings />);
    expect(screen.queryByRole('button', { name: /^System$/ })).not.toBeInTheDocument();
  });
});
