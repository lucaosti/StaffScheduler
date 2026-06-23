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

const mockGetPreferences = jest.fn();
const mockUpdatePreferences = jest.fn();

jest.mock('../../services/preferencesService', () => ({
  getMyPreferences: (...args: unknown[]) => mockGetPreferences(...args),
  updateMyPreferences: (...args: unknown[]) => mockUpdatePreferences(...args),
}));

jest.mock('../../services/calendarService', () => ({
  __esModule: true,
  getOrCreateCalendarToken: jest.fn().mockResolvedValue({ token: 'tok' }),
  rotateCalendarToken: jest.fn().mockResolvedValue({ token: 'rotated' }),
  buildFeedUrl: jest.fn((t: string) => `http://localhost/feed.ics?token=${t}`),
}));

jest.mock('../../services/moduleService', () => ({
  listModules: jest.fn().mockResolvedValue({ success: true, data: [] }),
  listModulesForOrg: jest.fn().mockResolvedValue({ success: true, data: [] }),
  setModuleEnabled: jest.fn().mockResolvedValue({ success: true, data: {} }),
  setModuleOrgOverride: jest.fn().mockResolvedValue({ success: true, data: {} }),
  removeModuleOrgOverride: jest.fn().mockResolvedValue({ success: true }),
}));

import Settings from './Settings';

describe('<Settings />', () => {
  beforeEach(() => {
    mockGetPreferences.mockResolvedValue({ success: true, data: null });
    mockUpdatePreferences.mockResolvedValue({ success: true, data: {} });
  });

  afterEach(() => jest.clearAllMocks());

  it('renders all tabs (admin variant)', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, email: 'admin@x', role: 'admin', permissions: ['settings.manage'] },
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

  it('hydrates work settings when preferences load with data', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, email: 'admin@x', permissions: [] },
    });
    mockGetPreferences.mockResolvedValue({
      success: true,
      data: { maxHoursPerWeek: 35, maxConsecutiveDays: 4 },
    });

    render(<Settings />);
    await userEvent.click(screen.getByRole('button', { name: /^Work Preferences$/ }));
    const hoursInput = (await screen.findByLabelText(/max hours per week/i)) as HTMLInputElement;
    expect(hoursInput.value).toBe('35');
  });

  it('calls updateMyPreferences when Save Personal Settings is submitted', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, email: 'admin@x', permissions: [] },
    });

    render(<Settings />);
    await userEvent.click(screen.getByRole('button', { name: /save personal settings/i }));
    expect(mockUpdatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ notes: expect.any(String) })
    );
  });

  it('calls updateMyPreferences when Save Work Settings is submitted', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, email: 'admin@x', permissions: [] },
    });

    render(<Settings />);
    await userEvent.click(screen.getByRole('button', { name: /^Work Preferences$/ }));
    await userEvent.click(screen.getByRole('button', { name: /save work settings/i }));
    expect(mockUpdatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        maxHoursPerWeek: expect.any(Number),
        maxConsecutiveDays: expect.any(Number),
      })
    );
  });

  it('renders the Calendar tab and shows CalendarSection when clicked', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, email: 'admin@x', permissions: [] },
    });

    render(<Settings />);
    await userEvent.click(screen.getByRole('button', { name: /^Calendar$/ }));
    expect(screen.getByText(/Calendar Feed/)).toBeInTheDocument();
  });

  it('renders the System tab when admin clicks it', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, email: 'admin@x', permissions: ['settings.manage'] },
    });

    render(<Settings />);
    await userEvent.click(screen.getByRole('button', { name: /^System$/ }));
    expect(screen.getByText(/System Configuration/)).toBeInTheDocument();
  });

  it('shows the Modules tab for admin users', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, email: 'admin@x', permissions: ['settings.manage'] },
    });

    render(<Settings />);
    expect(screen.getByRole('button', { name: /^Modules$/ })).toBeInTheDocument();
  });

  it('hides the Modules tab for non-admin users', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 2, email: 'mgr@x', role: 'manager' },
    });
    render(<Settings />);
    expect(screen.queryByRole('button', { name: /^Modules$/ })).not.toBeInTheDocument();
  });

  it('renders ModulesSection when admin clicks the Modules tab', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, email: 'admin@x', permissions: ['settings.manage'] },
    });

    render(<Settings />);
    await userEvent.click(screen.getByRole('button', { name: /^Modules$/ }));
    expect(screen.getByText(/Global Modules/i)).toBeInTheDocument();
  });
});
