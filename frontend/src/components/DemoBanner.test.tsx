/**
 * DemoBanner unit test.
 *
 * Stubs the systemService and asserts the banner is gated by `mode === 'demo'`
 * and is dismissible only for the current session.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DemoBanner from './DemoBanner';
import * as systemService from '../services/systemService';

jest.mock('../services/systemService');

describe('<DemoBanner />', () => {
  beforeEach(() => {
    sessionStorage.clear();
    jest.resetAllMocks();
  });

  it('renders nothing in production mode', async () => {
    (systemService.getSystemInfo as jest.Mock).mockResolvedValue({
      success: true,
      data: { mode: 'production' },
    });

    render(<DemoBanner />);

    // The component fires off an async fetch on mount; wait for the first
    // resolution before asserting the alert never appeared.
    await waitFor(() =>
      expect((systemService.getSystemInfo as jest.Mock)).toHaveBeenCalled()
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders an alert in demo mode', async () => {
    (systemService.getSystemInfo as jest.Mock).mockResolvedValue({
      success: true,
      data: { mode: 'demo' },
    });

    render(<DemoBanner />);

    const banner = await screen.findByRole('alert', { name: /demo environment notice/i });
    expect(banner).toHaveTextContent(/demo environment/i);
  });

  it('hides the banner after the user dismisses it and remembers in sessionStorage', async () => {
    (systemService.getSystemInfo as jest.Mock).mockResolvedValue({
      success: true,
      data: { mode: 'demo' },
    });

    render(<DemoBanner />);

    const dismiss = await screen.findByRole('button', { name: /dismiss demo banner/i });
    await userEvent.click(dismiss);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(sessionStorage.getItem('demoBannerDismissed')).toBe('1');
  });

  it('renders nothing when the API call fails', async () => {
    (systemService.getSystemInfo as jest.Mock).mockRejectedValue(new Error('network'));

    render(<DemoBanner />);

    await waitFor(() =>
      expect((systemService.getSystemInfo as jest.Mock)).toHaveBeenCalled()
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
