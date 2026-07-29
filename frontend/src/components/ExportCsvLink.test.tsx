/**
 * `ExportCsvLink`.
 *
 * Small surface, two things worth pinning: the URL it builds — because an export
 * that silently drops the page's filters gives the user the whole table when
 * they asked for the filtered one — and the disabled state being a BUTTON, since
 * a disabled anchor is still clickable and would download an empty file while
 * looking inert.
 *
 * @author Luca Ostinelli
 */

import { render, screen } from '@testing-library/react';
import ExportCsvLink from './ExportCsvLink';
import { API_BASE_URL } from '../services/apiUtils';

const href = () => screen.getByRole('link').getAttribute('href')!;
// Asserted against the configured base rather than a literal "/api": the base
// is an env var, and hard-coding it would make these cases pass or fail on
// configuration instead of on behaviour.
const url = (rest: string) => `${API_BASE_URL}${rest}`;

describe('<ExportCsvLink />', () => {
  it('links to the endpoint under the API base', () => {
    render(<ExportCsvLink path="/employees/export" />);
    expect(href()).toBe(url('/employees/export'));
    expect(screen.getByRole('link')).toHaveAttribute('download');
  });

  it('carries the filters the table is showing', () => {
    render(<ExportCsvLink path="/reports/hours-worked/export" params={{ startDate: '2026-07-01', endDate: '2026-07-31' }} />);
    expect(href()).toBe(url('/reports/hours-worked/export?startDate=2026-07-01&endDate=2026-07-31'));
  });

  it('drops empty values rather than sending a blank filter', () => {
    // `?department=` is not "no department filter"; the server would reject it
    // or read it as a filter for the empty string.
    render(<ExportCsvLink path="/employees/export" params={{ search: '', department: undefined, isActive: null }} />);
    expect(href()).toBe(url('/employees/export'));
  });

  it('encodes values, so a search term with a space or an ampersand survives', () => {
    render(<ExportCsvLink path="/employees/export" params={{ search: 'de rossi & co' }} />);
    expect(href()).toBe(url('/employees/export?search=de+rossi+%26+co'));
  });

  it('keeps numeric and boolean filters', () => {
    render(<ExportCsvLink path="/shifts/export" params={{ departmentId: 4, isActive: true }} />);
    expect(href()).toContain('departmentId=4');
    expect(href()).toContain('isActive=true');
  });

  it('renders a disabled BUTTON when there is nothing to export', () => {
    // A disabled <a> still navigates on click.
    render(<ExportCsvLink path="/employees/export" disabled />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('uses the given label', () => {
    render(<ExportCsvLink path="/x/export" label="CSV" />);
    expect(screen.getByRole('link')).toHaveTextContent('CSV');
  });
});
