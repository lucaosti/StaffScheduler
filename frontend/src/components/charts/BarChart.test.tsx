import React from 'react';
import { render, screen } from '@testing-library/react';
import BarChart from './BarChart';

describe('<BarChart />', () => {
  it('renders the empty state when data is empty', () => {
    render(<BarChart data={[]} />);
    expect(screen.getByRole('status')).toHaveTextContent(/no data/i);
  });

  it('renders one rect per datum and the formatted value', () => {
    const { container } = render(
      <BarChart
        data={[
          { label: 'Alpha', value: 10 },
          { label: 'Beta', value: 20 },
        ]}
        format={(v) => `${v}h`}
      />
    );
    expect(container.querySelectorAll('rect').length).toBe(2);
    expect(screen.getByText('10h')).toBeInTheDocument();
    expect(screen.getByText('20h')).toBeInTheDocument();
    expect(screen.getByLabelText('Bar chart')).toBeInTheDocument();
  });

  it('uses valuePrecision when no formatter is supplied', () => {
    render(<BarChart data={[{ label: 'A', value: 1.234 }]} valuePrecision={2} />);
    expect(screen.getByText('1.23')).toBeInTheDocument();
  });
});
