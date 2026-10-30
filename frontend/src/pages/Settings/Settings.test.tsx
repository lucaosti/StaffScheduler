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

import { screen } from '@testing-library/react';
import { render } from '../../test-utils/renderWithClient';
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

jest.mock('../../services/fieldPolicyService', () => ({
  listFieldPolicies: jest.fn().mockResolvedValue({
    success: true,
    data: { policies: [], governableCoreFields: ['email', 'phone'] },
  }),
  saveFieldPolicy: jest.fn().mockResolvedValue({ success: true }),
  deleteFieldPolicy: jest.fn().mockResolvedValue({ success: true }),
}));

import Settings from './Settings';
import { ThemeProvider } from '../../contexts/ThemeContext';

// The Personal tab (the default) drives the real theme, so it needs the
// provider App.tsx mounts around every page.
const renderSettings = () =>
  render(
    <ThemeProvider>
      <Settings />
    </ThemeProvider>
  );

describe('<Settings />', () => {
  beforeEach(() => {
    mockGetPreferences.mockResolvedValue({
      success: true,
      data: { maxHoursPerWeek: 40, maxConsecutiveDays: 5 },
    });
    mockUpdatePreferences.mockResolvedValue({ success: true, data: {} });
  });

  afterEach(() => jest.clearAllMocks());

  it('renders all tabs (admin variant)', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, email: 'admin@x', role: 'admin', permissions: ['settings.manage'] },
    });

    renderSettings();
    expect(screen.getByRole('heading', { name: /^settings$/i })).toBeInTheDocument();
    const personalTab = screen.getByRole('button', { name: /^Personal$/ });
    const workTab = screen.getByRole('button', { name: /^Work Preferences$/ });
    const systemTab = screen.getByRole('button', { name: /^System$/ });
    expect(personalTab).toBeInTheDocument();
    expect(workTab).toBeInTheDocument();
    expect(systemTab).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Hierarchy Settings$/ })).not.toBeInTheDocument();

    await userEvent.click(workTab);
    expect(await screen.findByLabelText(/max hours per week/i)).toBeInTheDocument();

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
    renderSettings();
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

    renderSettings();
    await userEvent.click(screen.getByRole('button', { name: /^Work Preferences$/ }));
    const hoursInput = (await screen.findByLabelText(/max hours per week/i)) as HTMLInputElement;
    expect(hoursInput.value).toBe('35');
  });

  /**
   * Neither tab writes preferences any more (#843). The Personal tab used to
   * serialise theme/language/timezone/notifications as JSON into the
   * scheduling-notes field — overwriting the user's notes, and never read
   * back — and the Work tab's Save did nothing yet reported success. Earlier
   * still, the Work tab sent the working-time limits through the
   * self-service endpoint, letting any employee raise their own.
   */
  it('writes nothing to the preferences endpoint from either tab', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, email: 'admin@x', permissions: [] },
    });

    renderSettings();
    await userEvent.selectOptions(screen.getByLabelText(/^theme$/i), 'dark');
    await userEvent.click(screen.getByRole('button', { name: /^Work Preferences$/ }));
    await screen.findByLabelText(/max hours per week/i);

    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
    expect(mockUpdatePreferences).not.toHaveBeenCalled();
  });

  it('renders the Calendar tab and shows CalendarSection when clicked', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, email: 'admin@x', permissions: [] },
    });

    renderSettings();
    await userEvent.click(screen.getByRole('button', { name: /^Calendar$/ }));
    expect(screen.getByText(/Calendar Feed/)).toBeInTheDocument();
  });

  it('renders the System tab when admin clicks it', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, email: 'admin@x', permissions: ['settings.manage'] },
    });

    renderSettings();
    await userEvent.click(screen.getByRole('button', { name: /^System$/ }));
    expect(screen.getByText(/System Configuration/)).toBeInTheDocument();
  });

  it('shows the Modules tab for admin users', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, email: 'admin@x', permissions: ['settings.manage'] },
    });

    renderSettings();
    expect(screen.getByRole('button', { name: /^Modules$/ })).toBeInTheDocument();
  });

  it('hides the Modules tab for non-admin users', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 2, email: 'mgr@x', role: 'manager' },
    });
    renderSettings();
    expect(screen.queryByRole('button', { name: /^Modules$/ })).not.toBeInTheDocument();
  });

  it('renders ModulesSection when admin clicks the Modules tab', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, email: 'admin@x', permissions: ['settings.manage'] },
    });

    renderSettings();
    await userEvent.click(screen.getByRole('button', { name: /^Modules$/ }));
    expect(screen.getByText(/Global Modules/i)).toBeInTheDocument();
  });

  it('shows the Employee Fields tab for admin users', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, email: 'admin@x', permissions: ['settings.manage'] },
    });

    renderSettings();
    expect(screen.getByRole('button', { name: /^Employee Fields$/ })).toBeInTheDocument();
  });

  it('hides the Employee Fields tab for non-admin users', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 2, email: 'mgr@x', role: 'manager' },
    });
    renderSettings();
    expect(screen.queryByRole('button', { name: /^Employee Fields$/ })).not.toBeInTheDocument();
  });

  it('renders FieldPolicySection when admin clicks the Employee Fields tab', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, email: 'admin@x', permissions: ['settings.manage'], organizationName: 'Acme' },
    });

    renderSettings();
    await userEvent.click(screen.getByRole('button', { name: /^Employee Fields$/ }));
    expect(await screen.findByText(/Employee field rules/i)).toBeInTheDocument();
  });
});
