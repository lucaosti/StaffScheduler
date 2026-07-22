/**
 * ErrorAlert component.
 *
 * A single, consistent presentation for a failed operation: a Bootstrap danger
 * alert with an optional retry action. Pages previously hand-rolled their own
 * `<div className="alert alert-danger">` markup with slightly different icons,
 * wording and retry affordances; centralising it here makes the error state look
 * and behave the same everywhere and pairs with {@link QueryState}.
 *
 * @author Luca Ostinelli
 */

import React from 'react';

interface Props {
  /** Message to show. Falls back to a generic sentence when omitted. */
  message?: string | null;
  /** When provided, renders a "Try again" button that invokes it. */
  onRetry?: () => void;
  /** Retry button label; defaults to "Try again". */
  retryLabel?: string;
}

const ErrorAlert: React.FC<Props> = ({ message, onRetry, retryLabel = 'Try again' }) => (
  <div className="alert alert-danger" role="alert">
    <i className="bi bi-exclamation-triangle me-2" aria-hidden="true"></i>
    {message || 'Something went wrong. Please try again.'}
    {onRetry && (
      <button type="button" className="btn btn-sm btn-outline-danger ms-3" onClick={onRetry}>
        {retryLabel}
      </button>
    )}
  </div>
);

export default ErrorAlert;
