/**
 * The bar chart.
 *
 * A bar's width is the only thing carrying its value, so the tests are mostly
 * about the scale: it spans the reference line as well as the tallest bar, so
 * a mean above every bar stays on the chart instead of being clipped off the
 * end — which would make the comparison the line exists for impossible.
 *
 * @author Luca Ostinelli
 */

import { render, screen } from '@testing-library/react';
import BarChart from './BarChart';

const data = [
  { label: 'Ada Lovelace', value: 40, display: '40.0' },
  { label: 'Grace Hopper', value: 20, display: '20.0' },
];

describe('BarChart', () => {
  it('renders nothing at all when there is no data', () => {
    const { container } = render(<BarChart data={[]} caption="Empty" />);
    // An empty chart frame is worse than no chart: it reads as a load that
    // failed rather than as an absence of data.
    expect(container).toBeEmptyDOMElement();
  });

  it('scales the widest bar to the full width', () => {
    const { container } = render(<BarChart data={data} caption="Hours" />);
    const bars = container.querySelectorAll('.chart-bar');
    expect((bars[0] as HTMLElement).style.width).toBe('100%');
    expect((bars[1] as HTMLElement).style.width).toBe('50%');
  });

  it('labels every bar with its value', () => {
    render(<BarChart data={data} caption="Hours" />);
    // Every bar is labelled, so identity and magnitude never rest on colour —
    // which is also why one series needs no legend.
    expect(screen.getByText('40.0')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
  });

  it('keeps a reference line above every bar on the chart', () => {
    const { container } = render(
      <BarChart data={data} caption="Hours" reference={{ value: 80, label: 'target' }} />
    );
    // The scale spans the reference too. Without that the line would sit at
    // 200% — off the chart — and the comparison it exists for would be
    // impossible to make.
    const bars = container.querySelectorAll('.chart-bar');
    expect((bars[0] as HTMLElement).style.width).toBe('50%');
  });

  it('captions the reference line rather than leaving it unexplained', () => {
    render(
      <BarChart data={data} caption="Hours" reference={{ value: 30, label: 'mean, 30 hours' }} />
    );
    // A line with no caption is a mark the reader has to guess the meaning of.
    expect(screen.getByText(/mean, 30 hours/)).toBeInTheDocument();
  });

  it('draws no reference line when none is given', () => {
    const { container } = render(<BarChart data={data} caption="Hours" />);
    expect(container.querySelector('.border-start')).toBeNull();
  });

  it('survives a series of zeros without dividing by zero', () => {
    const { container } = render(
      <BarChart data={[{ label: 'Nobody', value: 0 }]} caption="Hours" />
    );
    // A schedule with no hours yet is an ordinary state, not an error.
    expect((container.querySelector('.chart-bar') as HTMLElement).style.width).toBe('0%');
  });

  it('names the chart for a screen reader', () => {
    render(<BarChart data={data} caption="Hours worked per person" />);
    expect(screen.getByRole('group', { name: 'Hours worked per person' })).toBeInTheDocument();
  });
});
