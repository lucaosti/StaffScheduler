/**
 * ErrorAlert tests — in particular that a server fault (5xx) never reaches
 * the user as its raw message (#895): it renders a friendly, translated
 * sentence carrying the request id support needs to find the log line.
 */

import { render, screen } from '@testing-library/react';
import i18n from '../i18n';
import ErrorAlert from './ErrorAlert';
import { ApiError } from '../services/apiUtils';

describe('ErrorAlert', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('shows the given message', () => {
    render(<ErrorAlert message="Shift is already at maximum capacity" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Shift is already at maximum capacity');
  });

  it('falls back to a translated generic sentence when there is nothing to show', async () => {
    render(<ErrorAlert />);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Please try again.');

    await i18n.changeLanguage('it');
    render(<ErrorAlert />);
    expect(screen.getAllByRole('alert')[1]).toHaveTextContent('Qualcosa è andato storto');
  });

  it('renders a 5xx ApiError as the friendly fallback with its request id, never the raw message', () => {
    const err = new ApiError(
      'Incorrect arguments to mysqld_stmt_execute',
      500,
      'INTERNAL_ERROR',
      undefined,
      'req-123'
    );
    render(<ErrorAlert error={err} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong on our side');
    expect(alert).toHaveTextContent('req-123');
    expect(alert).not.toHaveTextContent('mysqld');
  });

  it('omits the reference when the 5xx carried no request id', () => {
    render(<ErrorAlert error={new ApiError('HTTP error! status: 502', 502)} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong on our side');
    expect(alert).not.toHaveTextContent('Reference');
  });

  it('shows a 4xx ApiError message as is — those are written for the user', () => {
    render(<ErrorAlert error={new ApiError('Email already in use', 409, 'CONFLICT')} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Email already in use');
  });
});
