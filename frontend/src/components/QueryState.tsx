/**
 * QueryState component.
 *
 * Standardises the loading → error → empty → content flow that every data page
 * repeats. Instead of each page writing its own `if (loading) …; if (error) …;`
 * early-returns with subtly different spinners and alerts, a page wraps its
 * content in <QueryState> and passes the flags (typically straight from a
 * TanStack Query result). This guarantees one consistent async-state UI across
 * the app and is the natural companion to the query hooks introduced in the
 * server-state rollout.
 *
 * Deliberately unopinionated about the data itself: the caller decides what
 * "empty" means (usually `data.length === 0`) and supplies the empty UI, since
 * empty states are page-specific (icon, wording, call-to-action).
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import LoadingSpinner from './LoadingSpinner';
import ErrorAlert from './ErrorAlert';

interface Props {
  /** True while the first load is in flight (show the spinner). */
  isLoading: boolean;
  /** True when the load failed (show the error alert). */
  isError?: boolean;
  /** Error to render; a string is used directly, otherwise its message is read. */
  error?: unknown;
  /** True when the load succeeded but produced nothing (show the empty UI). */
  isEmpty?: boolean;
  /** Spinner caption. */
  loadingMessage?: string;
  /** Retry handler wired into the error alert (e.g. query.refetch). */
  onRetry?: () => void;
  /** What to show when isEmpty is true. Nothing by default. */
  empty?: React.ReactNode;
  /** The success content. */
  children: React.ReactNode;
}

/** Reads a human message out of whatever was thrown/returned as `error`. */
const messageOf = (error: unknown): string | undefined => {
  if (!error) return undefined;
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return undefined;
};

const QueryState: React.FC<Props> = ({
  isLoading,
  isError,
  error,
  isEmpty,
  loadingMessage,
  onRetry,
  empty,
  children,
}) => {
  if (isLoading) return <LoadingSpinner message={loadingMessage} />;
  if (isError) return <ErrorAlert message={messageOf(error)} onRetry={onRetry} />;
  if (isEmpty) return <>{empty}</>;
  return <>{children}</>;
};

export default QueryState;
