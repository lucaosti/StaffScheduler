/**
 * Tests for QueryState and ErrorAlert — the standard async-state UI.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import QueryState from './QueryState';
import ErrorAlert from './ErrorAlert';

describe('QueryState', () => {
  it('shows the spinner while loading', () => {
    render(
      <QueryState isLoading loadingMessage="Loading things…">
        <div>content</div>
      </QueryState>
    );
    expect(screen.getByText('Loading things…')).toBeInTheDocument();
    expect(screen.queryByText('content')).not.toBeInTheDocument();
  });

  it('shows the error alert and wires the retry handler', () => {
    const onRetry = jest.fn();
    render(
      <QueryState isLoading={false} isError error={new Error('boom')} onRetry={onRetry}>
        <div>content</div>
      </QueryState>
    );
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders the empty node when empty', () => {
    render(
      <QueryState isLoading={false} isEmpty empty={<div>nothing here</div>}>
        <div>content</div>
      </QueryState>
    );
    expect(screen.getByText('nothing here')).toBeInTheDocument();
    expect(screen.queryByText('content')).not.toBeInTheDocument();
  });

  it('renders children on success', () => {
    render(
      <QueryState isLoading={false}>
        <div>content</div>
      </QueryState>
    );
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('prefers loading over error and empty', () => {
    render(
      <QueryState isLoading isError error="e" isEmpty empty={<div>empty</div>}>
        <div>content</div>
      </QueryState>
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('empty')).not.toBeInTheDocument();
  });
});

describe('ErrorAlert', () => {
  it('falls back to a generic message and omits the button without onRetry', () => {
    render(<ErrorAlert />);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('uses a custom retry label', () => {
    render(<ErrorAlert message="nope" onRetry={() => undefined} retryLabel="Reload" />);
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });
});
