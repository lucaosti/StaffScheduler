/**
 * Tests for CalendarSection (Settings → Calendar tab).
 *
 * Rewritten when the feature changed shape: one token per person became several
 * named ones, revocable independently. Every case that still means something
 * was kept — the client instructions, the clipboard paths, the confirmation
 * before a destructive act — and the ones about "rotating" went, because
 * rotation was the defect: it overwrote the only token and silently broke every
 * device already subscribed.
 *
 * The assertion carrying the most weight is that the URL is shown only for a
 * token just created. Only the digest is stored, so the raw value exists
 * exactly once; a page that offered to redisplay it would be claiming the
 * secret had been kept.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
// The section now reads departments and roles through query hooks for the
// aggregate-feed builder, so it needs a QueryClient — plain RTL `render` throws.
import { render, screen, waitFor } from '../../test-utils/renderWithClient';
import userEvent from '@testing-library/user-event';

const mockList = jest.fn();
const mockCreate = jest.fn();
const mockRevoke = jest.fn();
const mockBuildFeedUrl = jest.fn(
  (token: string) => `http://localhost:3001/calendar/feed.ics?token=${token}`
);

jest.mock('../../services/calendarService', () => ({
  __esModule: true,
  listCalendarTokens: (...args: unknown[]) => mockList(...args),
  createCalendarToken: (...args: unknown[]) => mockCreate(...args),
  revokeCalendarToken: (...args: unknown[]) => mockRevoke(...args),
  buildFeedUrl: (...args: unknown[]) => mockBuildFeedUrl(...(args as [string])),
}));

const CalendarSection = require('./CalendarSection').default as React.FC;

const token = (over: Record<string, unknown> = {}) => ({
  id: 1,
  label: 'Phone',
  createdAt: '2033-04-01T10:00:00Z',
  revokedAt: null,
  ...over,
});

describe('<CalendarSection />', () => {
  beforeEach(() => {
    mockList.mockResolvedValue([token()]);
    mockCreate.mockResolvedValue({ id: 2, token: 'fresh-token' });
    mockRevoke.mockResolvedValue(undefined);
    mockBuildFeedUrl.mockImplementation(
      (t: string) => `http://localhost:3001/calendar/feed.ics?token=${t}`
    );
  });

  afterEach(() => jest.clearAllMocks());

  it('lists the existing subscriptions', async () => {
    render(<CalendarSection />);
    expect(await screen.findByRole('cell', { name: 'Phone' })).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('shows no feed URL for a token it did not just create', async () => {
    render(<CalendarSection />);
    await screen.findByRole('cell', { name: 'Phone' });
    // The raw value is not stored, so there is nothing to show — and offering
    // to show it would claim otherwise.
    expect(screen.queryByLabelText('Calendar feed URL')).not.toBeInTheDocument();
  });

  it('says so plainly when there are none', async () => {
    mockList.mockResolvedValue([]);
    render(<CalendarSection />);
    expect(await screen.findByText(/no feed urls yet/i)).toBeInTheDocument();
  });

  it('keeps a revoked subscription visible with its date', async () => {
    mockList.mockResolvedValue([token({ label: 'Lost phone', revokedAt: '2033-05-02T09:00:00Z' })]);
    render(<CalendarSection />);
    // "Did I already revoke the lost phone?" is the question this screen exists
    // to answer; a vanished row cannot answer it.
    expect(await screen.findByText(/Revoked 2033-05-02/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
  });

  it('shows an error alert if loading fails', async () => {
    mockList.mockRejectedValue(new Error('boom'));
    render(<CalendarSection />);
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
  });

  it('renders all four client instruction sections', async () => {
    render(<CalendarSection />);
    await screen.findByRole('cell', { name: 'Phone' });
    // A client's name also occurs inside its own steps and refresh note, so
    // matching plain text is ambiguous; the accordion trigger is the one
    // occurrence that means "this section exists".
    for (const client of ['Google Calendar', 'Apple Calendar', 'Outlook', 'Thunderbird']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${client}`) })).toBeInTheDocument();
    }
  });

  describe('creating a subscription', () => {
    it('sends the label and shows the URL once', async () => {
      render(<CalendarSection />);
      await screen.findByRole('cell', { name: 'Phone' });

      await userEvent.type(screen.getByLabelText('Name this subscription'), 'Work laptop');
      await userEvent.click(screen.getByRole('button', { name: 'Create feed URL' }));

      await waitFor(() => expect(mockCreate).toHaveBeenCalledWith('Work laptop'));
      const input = (await screen.findByLabelText('Calendar feed URL')) as HTMLInputElement;
      expect(input.value).toContain('fresh-token');
      expect(screen.getByText(/one and only time it can be shown/i)).toBeInTheDocument();
    });

    it('refreshes the list, so the new one appears without a reload', async () => {
      render(<CalendarSection />);
      await screen.findByRole('cell', { name: 'Phone' });
      await userEvent.type(screen.getByLabelText('Name this subscription'), 'Work laptop');
      await userEvent.click(screen.getByRole('button', { name: 'Create feed URL' }));
      await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
    });

    it('hides the URL once the user says they have saved it', async () => {
      render(<CalendarSection />);
      await screen.findByRole('cell', { name: 'Phone' });
      await userEvent.type(screen.getByLabelText('Name this subscription'), 'Work laptop');
      await userEvent.click(screen.getByRole('button', { name: 'Create feed URL' }));
      await screen.findByLabelText('Calendar feed URL');

      await userEvent.click(screen.getByRole('button', { name: 'I have saved it' }));
      expect(screen.queryByLabelText('Calendar feed URL')).not.toBeInTheDocument();
    });

    it('relays a refusal', async () => {
      mockCreate.mockRejectedValue(new Error('Label is required'));
      render(<CalendarSection />);
      await screen.findByRole('cell', { name: 'Phone' });
      await userEvent.type(screen.getByLabelText('Name this subscription'), 'x');
      await userEvent.click(screen.getByRole('button', { name: 'Create feed URL' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Label is required');
    });
  });

  describe('the clipboard', () => {
    const created = async () => {
      render(<CalendarSection />);
      await screen.findByRole('cell', { name: 'Phone' });
      await userEvent.type(screen.getByLabelText('Name this subscription'), 'Work laptop');
      await userEvent.click(screen.getByRole('button', { name: 'Create feed URL' }));
      await screen.findByLabelText('Calendar feed URL');
    };

    it('copies the URL', async () => {
      const writeText = jest.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });
      await created();

      await userEvent.click(screen.getByRole('button', { name: /copy feed url/i }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('fresh-token')));
    });

    it('reports a clipboard failure instead of appearing to succeed', async () => {
      Object.assign(navigator, {
        clipboard: { writeText: jest.fn().mockRejectedValue(new Error('denied')) },
      });
      await created();

      await userEvent.click(screen.getByRole('button', { name: /copy feed url/i }));
      expect(await screen.findByRole('alert')).toHaveTextContent(/failed to copy/i);
    });
  });

  describe('revoking', () => {
    it('asks first, and says the others are unaffected', async () => {
      const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
      render(<CalendarSection />);
      await userEvent.click(await screen.findByRole('button', { name: 'Revoke' }));

      // The reassurance matters: under the old single-token model this action
      // broke every subscription, so a user who remembers that needs telling.
      expect(confirmSpy.mock.calls[0][0]).toMatch(/other feeds are unaffected/i);
      await waitFor(() => expect(mockRevoke).toHaveBeenCalledWith(1));
      confirmSpy.mockRestore();
    });

    it('does nothing when the confirmation is cancelled', async () => {
      const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
      render(<CalendarSection />);
      await userEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
      expect(mockRevoke).not.toHaveBeenCalled();
      confirmSpy.mockRestore();
    });

    it('relays a failure', async () => {
      jest.spyOn(window, 'confirm').mockReturnValue(true);
      mockRevoke.mockRejectedValue(new Error('Token not found'));
      render(<CalendarSection />);
      await userEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Token not found');
    });
  });
});
