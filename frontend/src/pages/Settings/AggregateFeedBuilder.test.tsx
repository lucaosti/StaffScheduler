/**
 * The filtered-feed URL builder.
 *
 * The assertion that matters most is a negative one: **no scope goes in the
 * URL**. The server resolves the token owner's org-unit scope on every fetch,
 * so a link narrows by itself when its owner's authority does — and a builder
 * that pinned the scope at creation time would quietly undo that, in a way
 * nothing else in the system would catch.
 *
 * @author Luca Ostinelli
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AggregateFeedBuilder from './AggregateFeedBuilder';

const live = [{ id: 1, label: 'Phone', revokedAt: null }];
const departments = [{ id: 3, name: 'Ward A' }, { id: 4, name: 'Ward B' }];
const roles = [{ id: 2, name: 'Nurse' }];

const setup = (tokens = live) =>
  render(<AggregateFeedBuilder tokens={tokens} departments={departments} roles={roles} />);

const url = () => (screen.getByLabelText('Filtered calendar URL') as HTMLInputElement).value;

const build = async (token = 'tok') => {
  await userEvent.type(screen.getByLabelText('Your feed token'), token);
  await userEvent.click(screen.getByRole('button', { name: 'Build the URL' }));
};

describe('<AggregateFeedBuilder />', () => {
  it('says a token is needed when the person holds none', () => {
    setup([]);
    expect(screen.getByRole('note')).toHaveTextContent(/create a feed url above first/i);
  });

  it('refuses to build without a token, rather than producing a broken link', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Build the URL' }));

    expect(screen.getByRole('alert')).toHaveTextContent(/paste one of your feed tokens/i);
    expect(screen.queryByLabelText('Filtered calendar URL')).not.toBeInTheDocument();
  });

  it('builds a URL with the default range', async () => {
    setup();
    await build();

    expect(url()).toContain('/calendar/aggregate.ics?token=tok');
    expect(url()).toContain('pastDays=7');
    expect(url()).toContain('futureDays=30');
  });

  it('puts NO scope in the URL', async () => {
    setup();
    await build();

    // The link's reach follows its owner's permissions as they change; a scope
    // in the URL would fix it at the moment it was made.
    expect(url()).not.toMatch(/orgUnit|scope/i);
  });

  it('carries the selected departments and roles', async () => {
    setup();
    await userEvent.selectOptions(screen.getByLabelText('Departments'), ['3', '4']);
    await userEvent.selectOptions(screen.getByLabelText('Roles'), ['2']);
    await build();

    expect(url()).toContain('departmentId=3%2C4');
    expect(url()).toContain('roleId=2');
  });

  it('omits a filter nobody selected', async () => {
    setup();
    await build();

    // `departmentId=` is neither a filter nor the absence of one, and the
    // server's schema rejects it.
    expect(url()).not.toContain('departmentId');
    expect(url()).not.toContain('roleId');
  });

  it('honours an explicit range, including no history at all', async () => {
    setup();
    const past = screen.getByLabelText('Days of history');
    await userEvent.clear(past);
    await userEvent.type(past, '0');
    await build();

    expect(url()).toContain('pastDays=0');
  });

  it('copies the URL', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    setup();
    await build();

    await userEvent.click(screen.getByRole('button', { name: 'Copy URL' }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('aggregate.ics'));
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('reports a clipboard failure instead of appearing to succeed', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: jest.fn().mockRejectedValue(new Error('denied')) },
    });
    setup();
    await build();

    await userEvent.click(screen.getByRole('button', { name: 'Copy URL' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to copy/i);
  });

  it('says that revoking the token stops every view built from it', async () => {
    setup();
    await build();

    // The consequence of filters living in the query string rather than in
    // stored objects, and the one a person needs to know before sharing a link.
    expect(screen.getByText(/stops this and every other view built from it/i)).toBeInTheDocument();
  });
});
