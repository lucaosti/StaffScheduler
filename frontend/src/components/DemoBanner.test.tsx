/**
 * DemoBanner unit test.
 *
 * Stubs the systemService and asserts the banner is gated by `mode === 'demo'`
 * and is dismissible only for the current session.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DemoBanner from './DemoBanner';
import * as systemService from '../services/systemService';

jest.mock('../services/systemService');

describe('<DemoBanner />', () => {
  let cleanups: (() => void)[] = [];
  const afterThis = (fn: () => void) => cleanups.push(fn);

  beforeEach(() => {
    sessionStorage.clear();
    jest.resetAllMocks();
  });

  afterEach(() => {
    cleanups.forEach((fn) => fn());
    cleanups = [];
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

  /**
   * #892: the banner sat at z-index 1080, above Bootstrap's modals and the
   * fixed sidebar. It now stays below both (Bootstrap's sticky layer) and
   * publishes its height so the fixed shell can start beneath it.
   */
  it('sits below modals and offsets the fixed shell by its own height', async () => {
    (systemService.getSystemInfo as jest.Mock).mockResolvedValue({
      success: true,
      data: { mode: 'demo' },
    });
    // jsdom lays nothing out, so every offsetHeight is 0 without this.
    const height = jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(48);
    afterThis(() => height.mockRestore());

    render(<DemoBanner />);
    const banner = await screen.findByRole('alert', { name: /demo environment notice/i });

    expect(banner).toHaveClass('sticky-top');
    expect(banner.style.zIndex).toBe('');
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--demo-banner-height')).toBe('48px')
    );

    await userEvent.click(screen.getByRole('button', { name: /dismiss demo banner/i }));
    expect(document.documentElement.style.getPropertyValue('--demo-banner-height')).toBe('');
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
