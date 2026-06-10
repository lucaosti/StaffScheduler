/**
 * Settings page smoke test.
 *
 * Renders the Settings page in both admin and non-admin variants, clicks
 * through each tab, and exercises a representative form change.
 *
 * Service calls are mocked so the test does not require a running backend.
 *
 * @author Luca Ostinelli
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockUseAuth = jest.fn();

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('../../services/settingsService', () => ({
  getSystemSettings: jest.fn().mockResolvedValue({ success: true, data: [] }),
  updateCurrency: jest.fn().mockResolvedValue({ success: true, data: { currency: 'EUR' } }),
  updateTimePeriod: jest.fn().mockResolvedValue({ success: true, data: { timePeriod: 'monthly' } }),
}));

jest.mock('../../services/preferencesService', () => ({
  getMyPreferences: jest.fn().mockResolvedValue({ success: true, data: null }),
  updateMyPreferences: jest.fn().mockResolvedValue({ success: true, data: {} }),
}));

// eslint-disable-next-line import/first
import Settings from './Settings';

describe('<Settings />', () => {
  it('renders all tabs (admin variant)', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, email: 'admin@x', role: 'admin', permissions: ['system.settings'] },
    });

    render(<Settings />);
    expect(screen.getByRole('heading', { name: /^settings$/i })).toBeInTheDocument();
    const personalTab = screen.getByRole('button', { name: /^Personal$/ });
    const workTab = screen.getByRole('button', { name: /^Work Preferences$/ });
    const systemTab = screen.getByRole('button', { name: /^System$/ });
    expect(personalTab).toBeInTheDocument();
    expect(workTab).toBeInTheDocument();
    expect(systemTab).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Hierarchy Settings$/ })).not.toBeInTheDocument();

    await userEvent.click(workTab);
    expect(screen.getByLabelText(/max hours per week/i)).toBeInTheDocument();

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
