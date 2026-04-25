/**
 * User-facing notifications.
 *
 * Provides a single entry point for surfacing errors and success messages to
 * the user. Today this wraps `window.alert`; pages should import from here so
 * the underlying mechanism (e.g. a toast library) can be swapped without
 * touching every call site.
 *
 * @author Luca Ostinelli
 */

import { ApiError } from '../services/apiUtils';

/**
 * Extracts a human-readable message from any thrown value.
 */
export const errorMessage = (err: unknown, fallback: string = 'Unexpected error'): string => {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return fallback;
};

/**
 * Shows an error notification. Call sites pass the caught error and a context
 * sentence so the user gets actionable feedback instead of a bare "Error".
 */
export const notifyError = (context: string, err?: unknown): void => {
  const detail = err ? `: ${errorMessage(err)}` : '';
  // eslint-disable-next-line no-alert
  window.alert(`${context}${detail}`);
};

/**
 * Shows a success notification.
 */
export const notifySuccess = (message: string): void => {
  // eslint-disable-next-line no-alert
  window.alert(message);
};
