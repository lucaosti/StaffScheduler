/**
 * Tests for SystemSection (Settings → System tab, admin only).
 *
 * @author Luca Ostinelli
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SystemSection from './SystemSection';

const mockGetSystemSettings = jest.fn();
const mockUpdateCurrency = jest.fn();
const mockUpdateTimePeriod = jest.fn();

// Only the three network calls are stubbed. `isCurrency`/`isTimePeriod` are
// pure predicates over the contract enums with no I/O, so the real ones are
// kept: replacing the whole module left them `undefined` and the component
// threw on the first change event — a mock that silently drops an export the
// component depends on fails for a reason unrelated to what is under test.
jest.mock('../../services/settingsService', () => ({
  ...jest.requireActual('../../services/settingsService'),
  getSystemSettings: () => mockGetSystemSettings(),
  updateCurrency: (currency: string) => mockUpdateCurrency(currency),
  updateTimePeriod: (tp: string) => mockUpdateTimePeriod(tp),
}));

describe('<SystemSection />', () => {
  beforeEach(() => {
    mockGetSystemSettings.mockResolvedValue({
      success: true,
      data: [
        { category: 'general', key: 'currency', value: 'USD' },
        { category: 'schedule', key: 'default_time_period', value: 'weekly' },
      ],
    });
    mockUpdateCurrency.mockResolvedValue({ success: true, data: {} });
    mockUpdateTimePeriod.mockResolvedValue({ success: true, data: {} });
  });

  afterEach(() => jest.clearAllMocks());

  it('shows a loading spinner initially', () => {
    render(<SystemSection />);
    expect(screen.getByRole('status', { hidden: true })).toBeInTheDocument();
  });

  it('loads and displays the current settings from the API', async () => {
    render(<SystemSection />);

    await screen.findByLabelText(/^currency$/i);

    const currencySelect = screen.getByLabelText(/^currency$/i) as HTMLSelectElement;
    expect(currencySelect.value).toBe('USD');

    const timePeriodSelect = screen.getByLabelText(/default time period/i) as HTMLSelectElement;
    expect(timePeriodSelect.value).toBe('weekly');
  });

  /**
   * `system_settings` is a free-text key/value table, so a stored value is not
   * guaranteed to still be one the endpoint accepts (an older release, a
   * manual edit, a seed). Before the values were validated on load, the select
   * was set to a value none of its options carried — so it rendered blank
   * while claiming to show the current setting, and saving then sent it and
   * earned a 400 the user could not act on.
   */
  it('falls back to the default when a stored value is no longer accepted', async () => {
    mockGetSystemSettings.mockResolvedValue({
      success: true,
      data: [
        { category: 'general', key: 'currency', value: 'GBP' },
        { category: 'schedule', key: 'default_time_period', value: 'fortnightly' },
      ],
    });
    render(<SystemSection />);

    await screen.findByLabelText(/^currency$/i);

    const currencySelect = screen.getByLabelText(/^currency$/i) as HTMLSelectElement;
    const timePeriodSelect = screen.getByLabelText(/default time period/i) as HTMLSelectElement;
    expect(currencySelect.value).toBe('EUR');
    expect(timePeriodSelect.value).toBe('monthly');
  });

  it('uses defaults when getSystemSettings fails', async () => {
    mockGetSystemSettings.mockRejectedValue(new Error('Network error'));
    render(<SystemSection />);

    await screen.findByLabelText(/^currency$/i);

    const currencySelect = screen.getByLabelText(/^currency$/i) as HTMLSelectElement;
    expect(currencySelect.value).toBe('EUR');
  });

  it('uses defaults when API returns no matching settings', async () => {
    mockGetSystemSettings.mockResolvedValue({ success: true, data: [] });
    render(<SystemSection />);

    await screen.findByLabelText(/^currency$/i);

    const currencySelect = screen.getByLabelText(/^currency$/i) as HTMLSelectElement;
    expect(currencySelect.value).toBe('EUR');
  });

  it('updates currency selection and calls onSave', async () => {
    render(<SystemSection />);

    await screen.findByLabelText(/^currency$/i);

    await userEvent.selectOptions(screen.getByLabelText(/^currency$/i), 'EUR');
    await userEvent.click(screen.getByRole('button', { name: /save system settings/i }));

    expect(mockUpdateCurrency).toHaveBeenCalledWith('EUR');
    expect(mockUpdateTimePeriod).toHaveBeenCalled();
    expect(await screen.findByText(/system settings saved successfully/i)).toBeInTheDocument();
  });

  it('shows an error message when save fails', async () => {
    mockUpdateCurrency.mockRejectedValue(new Error('Permission denied'));
    render(<SystemSection />);

    await screen.findByRole('button', { name: /save system settings/i });

    await userEvent.click(screen.getByRole('button', { name: /save system settings/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(await screen.findByText(/permission denied/i)).toBeInTheDocument();
  });

  it('updates timePeriod selection', async () => {
    render(<SystemSection />);

    await screen.findByLabelText(/default time period/i);

    await userEvent.selectOptions(screen.getByLabelText(/default time period/i), 'daily');
    await userEvent.click(screen.getByRole('button', { name: /save system settings/i }));

    expect(mockUpdateTimePeriod).toHaveBeenCalledWith('daily');
  });
});
