/**
 * ErrorAlert component.
 *
 * A single, consistent presentation for a failed operation: a Bootstrap danger
 * alert with an optional retry action. Pages previously hand-rolled their own
 * `<div className="alert alert-danger">` markup with slightly different icons,
 * wording and retry affordances; centralising it here makes the error state look
 * and behave the same everywhere and pairs with {@link QueryState}.
 *
 * Given the thrown `error` itself (rather than a message string), a server
 * fault (an `ApiError` with a 5xx status) always renders as the friendly,
 * translated fallback with its request id — never the server's own text,
 * which for an internal fault was raw driver output (#895). `handleResponse`
 * already builds 5xx errors with that message; deciding it again here from the
 * status keeps the guarantee for an `ApiError` constructed anywhere else.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, serverErrorMessage } from '../services/apiUtils';

interface Props {
  /** Message to show. Takes precedence over `error`. */
  message?: string | null;
  /** Whatever was thrown/returned as the error; a string is used directly, otherwise its message is read. */
  error?: unknown;
  /** When provided, renders a "Try again" button that invokes it. */
  onRetry?: () => void;
  /** Retry button label; defaults to the translated "Try again". */
  retryLabel?: string;
}

/** Reads a human message out of whatever was thrown/returned as `error`. */
const messageOf = (error: unknown): string | undefined => {
  if (!error) return undefined;
  if (typeof error === 'string') return error;
  if (error instanceof ApiError && (error.status ?? 0) >= 500) return serverErrorMessage(error.requestId);
  if (error instanceof Error) return error.message;
  return undefined;
};

const ErrorAlert: React.FC<Props> = ({ message, error, onRetry, retryLabel }) => {
  const { t } = useTranslation();
  return (
    <div className="alert alert-danger" role="alert">
      <i className="bi bi-exclamation-triangle me-2" aria-hidden="true"></i>
      {message || messageOf(error) || t('common.somethingWentWrong')}
      {onRetry && (
        <button type="button" className="btn btn-sm btn-outline-danger ms-3" onClick={onRetry}>
          {retryLabel ?? t('common.tryAgain')}
        </button>
      )}
    </div>
  );
};

export default ErrorAlert;
