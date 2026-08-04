/**
 * Tests for the public kiosk clock-in page (#309).
 *
 * @author Luca Ostinelli
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Kiosk from './Kiosk';
import { ApiError } from '../../services/apiUtils';

jest.mock('../../services/attendanceService', () => ({
  __esModule: true,
  punchKiosk: (...a: unknown[]) => punchKiosk(...a),
}));

const punchKiosk = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
});

describe('<Kiosk />', () => {
  it('prompts to configure the device when no token is stored', () => {
    render(<Kiosk />);
    expect(screen.getByText(/configure this kiosk/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/device token/i)).toBeInTheDocument();
  });

  it('saves the device token and shows the punch form', async () => {
    render(<Kiosk />);

    await userEvent.type(screen.getByPlaceholderText(/device token/i), 'raw-token-value');
    await userEvent.click(screen.getByRole('button', { name: /save device/i }));

    expect(screen.getByPlaceholderText(/employee id/i)).toBeInTheDocument();
    expect(localStorage.getItem('kioskDeviceToken')).toBe('raw-token-value');
  });

  it('submits a punch with the stored token and shows the result', async () => {
    localStorage.setItem('kioskDeviceToken', 'raw-token-value');
    punchKiosk.mockResolvedValue({
      success: true,
      data: { action: 'clocked_in', employeeName: 'Ada Lovelace', record: { id: 1 } },
    });

    render(<Kiosk />);
    await userEvent.type(screen.getByPlaceholderText(/employee id/i), 'E-042');
    await userEvent.click(screen.getByRole('button', { name: /^punch$/i }));

    await waitFor(() => expect(punchKiosk).toHaveBeenCalledWith('raw-token-value', 'E-042'));
    expect(await screen.findByText(/ada lovelace: clocked in successfully/i)).toBeInTheDocument();
  });

  it('shows a device-revoked message on 401 without asking the employee to log in', async () => {
    localStorage.setItem('kioskDeviceToken', 'stale-token');
    punchKiosk.mockRejectedValue(new ApiError('Invalid or revoked kiosk token', 401, 'INVALID_KIOSK_TOKEN'));

    render(<Kiosk />);
    await userEvent.type(screen.getByPlaceholderText(/employee id/i), 'E-042');
    await userEvent.click(screen.getByRole('button', { name: /^punch$/i }));

    expect(await screen.findByText(/not registered or its token was revoked/i)).toBeInTheDocument();
  });

  it('surfaces a generic error message for a non-401 failure', async () => {
    localStorage.setItem('kioskDeviceToken', 'raw-token-value');
    punchKiosk.mockRejectedValue(new Error('Network error'));

    render(<Kiosk />);
    await userEvent.type(screen.getByPlaceholderText(/employee id/i), 'E-042');
    await userEvent.click(screen.getByRole('button', { name: /^punch$/i }));

    expect(await screen.findByText('Network error')).toBeInTheDocument();
  });

  it('lets the device be reconfigured, forgetting the stored token', async () => {
    localStorage.setItem('kioskDeviceToken', 'raw-token-value');
    render(<Kiosk />);

    await userEvent.click(screen.getByRole('button', { name: /reconfigure this device/i }));

    expect(screen.getByText(/configure this kiosk/i)).toBeInTheDocument();
    expect(localStorage.getItem('kioskDeviceToken')).toBeNull();
  });
});
