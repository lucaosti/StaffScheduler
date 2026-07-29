/**
 * Timeline page.
 *
 * The interesting part is the geometry: a bar's position is its fraction of
 * the visible window, and the window ends at the END of the `to` day. Getting
 * that off by a day puts every bar on the last day outside the chart, which is
 * invisible until someone notices their Friday shift missing.
 *
 * @author Luca Ostinelli
 */

import { screen } from '@testing-library/react';
import { render } from '../../test-utils/renderWithClient';
import Timeline from './Timeline';

const okResponse = <T,>(data: T) => Promise.resolve({ success: true as const, data });

const getTimeline = jest.fn();
const getTimelineSources = jest.fn();

jest.mock('../../services/timelineService', () => ({
  __esModule: true,
  getTimeline: (...args: unknown[]) => getTimeline(...args),
  getTimelineSources: (...args: unknown[]) => getTimelineSources(...args),
}));

const WINDOW_START = new Date();
const isoDay = (offset = 0): string => {
  const d = new Date(WINDOW_START);
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

const timelineWith = (bars: Array<Record<string, unknown>>) => ({
  from: isoDay(),
  to: isoDay(6),
  lanes: [{ id: '4', label: 'Ada Lovelace', kind: 'employee' }],
  bars,
  sources: ['shifts', 'on-call'],
});

beforeEach(() => {
  getTimelineSources.mockReset().mockImplementation(() => okResponse(['shifts', 'on-call']));
  getTimeline.mockReset().mockImplementation(() => okResponse(timelineWith([])));
});

describe('Timeline', () => {
  it('renders a lane per person', async () => {
    getTimeline.mockImplementation(() =>
      okResponse(
        timelineWith([
          {
            laneId: '4',
            start: `${isoDay()}T09:00:00.000Z`,
            end: `${isoDay()}T17:00:00.000Z`,
            label: 'Ward A',
            source: 'shifts',
            status: 'confirmed',
          },
        ])
      )
    );

    render(<Timeline />);
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
  });

  it('shows the empty state rather than a blank chart', async () => {
    getTimeline.mockImplementation(() =>
      okResponse({ from: isoDay(), to: isoDay(6), lanes: [], bars: [], sources: [] })
    );

    render(<Timeline />);
    expect(await screen.findByText(/nothing scheduled/i)).toBeInTheDocument();
  });

  it('keeps a bar on the last day inside the chart', async () => {
    getTimeline.mockImplementation(() =>
      okResponse(
        timelineWith([
          {
            laneId: '4',
            start: `${isoDay(6)}T09:00:00.000Z`,
            end: `${isoDay(6)}T17:00:00.000Z`,
            label: 'Ward A',
            source: 'shifts',
            status: 'confirmed',
          },
        ])
      )
    );

    const { container } = render(<Timeline />);
    await screen.findByText('Ada Lovelace');

    const bar = container.querySelector('.position-absolute') as HTMLElement;
    // `to` is inclusive as a DATE, so the window runs to the end of that day.
    // Treating it as midnight AT the start would put this bar at or past 100%
    // and silently off the chart.
    const left = parseFloat(bar.style.left);
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThan(100);
  });

  it('renders an overnight bar as one interval', async () => {
    getTimeline.mockImplementation(() =>
      okResponse(
        timelineWith([
          {
            laneId: '4',
            start: `${isoDay(1)}T22:00:00.000Z`,
            end: `${isoDay(2)}T06:00:00.000Z`,
            label: 'Ward A',
            source: 'shifts',
            status: 'confirmed',
          },
        ])
      )
    );

    const { container } = render(<Timeline />);
    await screen.findByText('Ada Lovelace');

    // One element, not two fragments either side of midnight — the server
    // resolved it into absolute instants precisely so this view need not know
    // the rule.
    const drawn = container.querySelectorAll('.position-absolute');
    expect(drawn).toHaveLength(1);
    expect(parseFloat((drawn[0] as HTMLElement).style.width)).toBeGreaterThan(0);
  });

  it('offers the sources the server declares', async () => {
    render(<Timeline />);
    // Read from the server rather than hardcoded, so adding a source does not
    // leave a stale list here.
    expect(await screen.findByRole('option', { name: 'On call' })).toBeInTheDocument();
  });
});
