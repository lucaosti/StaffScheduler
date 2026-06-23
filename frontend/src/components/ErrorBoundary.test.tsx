/**
 * Unit tests for ErrorBoundary.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorBoundary from './ErrorBoundary';

const ThrowOnMount: React.FC<{ message: string }> = ({ message }) => {
  throw new Error(message);
};

const GoodChild: React.FC = () => <p>All good</p>;

describe('<ErrorBoundary />', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    (console.error as jest.Mock).mockRestore();
  });

  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <GoodChild />
      </ErrorBoundary>
    );
    expect(screen.getByText('All good')).toBeInTheDocument();
  });

  it('displays the fallback UI when a child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowOnMount message="Boom" />
      </ErrorBoundary>
    );
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload the page/i })).toBeInTheDocument();
  });

  it('calls window.location.reload when the reload button is clicked', () => {
    const reloadSpy = jest.fn();

    render(
      <ErrorBoundary onReload={reloadSpy}>
        <ThrowOnMount message="Crash" />
      </ErrorBoundary>
    );

    fireEvent.click(screen.getByRole('button', { name: /reload the page/i }));
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('logs to console.error in non-production mode', () => {
    render(
      <ErrorBoundary>
        <ThrowOnMount message="Dev error" />
      </ErrorBoundary>
    );
    expect(console.error).toHaveBeenCalled();
  });
});
