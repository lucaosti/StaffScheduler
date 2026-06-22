/**
 * Tests for CalendarSection (Settings → Calendar tab).
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetOrCreate = jest.fn();
const mockRotate = jest.fn();
const mockBuildFeedUrl = jest.fn((token: string) => `http://localhost:3001/calendar/feed.ics?token=${token}`);

jest.mock('../../services/calendarService', () => ({
  __esModule: true,
  getOrCreateCalendarToken: (...args: unknown[]) => mockGetOrCreate(...args),
  rotateCalendarToken: (...args: unknown[]) => mockRotate(...args),
  buildFeedUrl: (...args: unknown[]) => mockBuildFeedUrl(...(args as [string])),
}));

const CalendarSection = require('./CalendarSection').default as React.FC;

describe('<CalendarSection />', () => {
  beforeEach(() => {
    mockGetOrCreate.mockResolvedValue({ token: 'test-token-123' });
    mockRotate.mockResolvedValue({ token: 'rotated-token-456' });
    mockBuildFeedUrl.mockImplementation(
      (token: string) => `http://localhost:3001/calendar/feed.ics?token=${token}`
    );
  });

  afterEach(() => jest.clearAllMocks());

  it('shows a loading spinner initially then renders the feed URL', async () => {
    render(<CalendarSection />);

    await screen.findByLabelText('Calendar feed URL');

    const input = screen.getByLabelText('Calendar feed URL') as HTMLInputElement;
    expect(input.value).toContain('test-token-123');
  });

  it('shows an error alert if token loading fails', async () => {
    mockGetOrCreate.mockRejectedValue(new Error('Network error'));
    render(<CalendarSection />);

    await screen.findByRole('alert');
    expect(screen.getByText(/network error/i)).toBeInTheDocument();
  });

  it('renders all four client instruction sections', async () => {
    render(<CalendarSection />);

    await screen.findByLabelText('Calendar feed URL');

    expect(screen.getAllByText(/Google Calendar/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Apple Calendar/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Outlook/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Thunderbird/).length).toBeGreaterThan(0);
  });

  it('copies the feed URL to clipboard when Copy is clicked', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: jest.fn().mockResolvedValue(undefined) },
    });

    render(<CalendarSection />);
    await screen.findByLabelText('Calendar feed URL');

    await userEvent.click(screen.getByRole('button', { name: /copy feed url to clipboard/i }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('test-token-123')
    );
    await screen.findByText(/copied/i);
  });

  it('shows error when clipboard write fails', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: jest.fn().mockRejectedValue(new Error('Clipboard denied')) },
    });

    render(<CalendarSection />);
    await screen.findByLabelText('Calendar feed URL');

    await userEvent.click(screen.getByRole('button', { name: /copy feed url to clipboard/i }));
    await screen.findByRole('alert');
  });

  it('rotates the token when confirmed via window.confirm', async () => {
    jest.spyOn(window, 'confirm').mockReturnValue(true);

    render(<CalendarSection />);
    await screen.findByRole('button', { name: /rotate token/i });

    await userEvent.click(screen.getByRole('button', { name: /rotate token/i }));

    await waitFor(() => {
      const input = screen.getByLabelText('Calendar feed URL') as HTMLInputElement;
      expect(input.value).toContain('rotated-token-456');
    });

    (window.confirm as jest.Mock).mockRestore();
  });

  it('does not rotate the token when window.confirm is cancelled', async () => {
    jest.spyOn(window, 'confirm').mockReturnValue(false);

    render(<CalendarSection />);
    await screen.findByRole('button', { name: /rotate token/i });

    await userEvent.click(screen.getByRole('button', { name: /rotate token/i }));
    expect(mockRotate).not.toHaveBeenCalled();

    (window.confirm as jest.Mock).mockRestore();
  });

  it('shows an error alert when rotation fails', async () => {
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    mockRotate.mockRejectedValue(new Error('Rotation failed'));

    render(<CalendarSection />);
    await screen.findByRole('button', { name: /rotate token/i });

    await userEvent.click(screen.getByRole('button', { name: /rotate token/i }));
    await screen.findByText(/rotation failed/i);

    (window.confirm as jest.Mock).mockRestore();
  });
});
