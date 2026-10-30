/**
 * Tests for PreferencesSection (Settings → Personal tab).
 *
 * The tab used to collect theme, language, timezone and three notification
 * toggles, report "Personal preferences saved successfully", and store them
 * as JSON in the scheduling-notes field, where nothing ever read them back
 * (#843). What remains is what the app actually applies: theme and language,
 * which take effect at once and are remembered on this device, and the real
 * Web Push toggle.
 *
 * @author Luca Ostinelli
 */

import { render, screen, act } from '../../test-utils/renderWithClient';
import userEvent from '@testing-library/user-event';
import PreferencesSection from './PreferencesSection';
import { ThemeProvider } from '../../contexts/ThemeContext';
import i18n from '../../i18n';
import * as preferencesService from '../../services/preferencesService';

// PreferencesSection renders WebPushToggle (#310), which calls this service
// via a query hook — mocked here since this suite is about the preferences
// themselves, not push subscription mechanics (see WebPushToggle.test.tsx).
jest.mock('../../services/notificationService', () => ({
  __esModule: true,
  getPushPublicKey: jest.fn().mockResolvedValue({ success: true, data: { enabled: false, publicKey: null } }),
  subscribePush: jest.fn(),
  unsubscribePush: jest.fn(),
}));

jest.mock('../../services/preferencesService', () => ({
  __esModule: true,
  getMyPreferences: jest.fn(),
  updateMyPreferences: jest.fn(),
}));

const renderSection = () =>
  render(
    <ThemeProvider>
      <PreferencesSection />
    </ThemeProvider>
  );

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-bs-theme');
});

afterEach(async () => {
  await act(async () => {
    await i18n.changeLanguage('en');
  });
});

describe('<PreferencesSection />', () => {
  it('applies the chosen theme at once and still shows it after a reload', async () => {
    const { unmount } = renderSection();

    await userEvent.selectOptions(screen.getByLabelText(/^theme$/i), 'dark');
    expect(document.documentElement).toHaveAttribute('data-bs-theme', 'dark');

    unmount();
    renderSection();
    expect(screen.getByLabelText(/^theme$/i)).toHaveValue('dark');
  });

  it('switches the interface language at once', async () => {
    renderSection();

    await userEvent.selectOptions(screen.getByLabelText(/^language$/i), 'it');

    expect(i18n.language).toBe('it');
  });

  it('offers no control the app does not apply, and claims no save', async () => {
    renderSection();

    expect(screen.queryByLabelText(/timezone/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/email notifications/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/sms notifications/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText(/^theme$/i), 'light');
    expect(screen.queryByText(/saved successfully/i)).not.toBeInTheDocument();
    // The JSON-in-notes write is gone: it overwrote the user's scheduling notes.
    expect(preferencesService.updateMyPreferences).not.toHaveBeenCalled();
  });
});
