/**
 * Central Express error middleware.
 *
 * Terminal handler for everything forwarded with `next(err)` — including a
 * rejected `async` route handler's promise, which Express 5 forwards here
 * on its own (no wrapper needed, unlike Express 4):
 *
 * - `AppError` subtypes are expected domain outcomes: rendered with their
 *   status and stable code, not logged as errors.
 * - An http-errors instance marked `expose` (what Express's own body parser
 *   raises for a malformed JSON body or an oversized payload) is a fault in
 *   the client's request: rendered with its 4xx status as `BAD_REQUEST`.
 * - Anything else is an internal fault: logged in full, rendered as a 500
 *   with a fixed message, a fixed code and the request id.
 *
 * WHY THE 500 BODY IS GENERIC IN EVERY ENVIRONMENT (#895). The message used
 * to be hidden only when NODE_ENV was 'production', and `err.code` was
 * forwarded unconditionally. An internal fault is almost always a driver or
 * library error, so that put mysql2's text ("Incorrect arguments to
 * mysqld_stmt_execute") in front of the users of every staging/demo
 * deployment, and its driver code (`ER_WRONG_ARGUMENTS`, …) in front of
 * production users — schema and query-shape hints for an attacker, noise for
 * everyone else. Gating on the environment was rejected rather than fixed:
 * it fails open the moment a deployment forgets to set NODE_ENV (the config
 * default is 'development'), and a developer loses nothing, because the full
 * error is in the log with the same request id the response carries.
 *
 * WHY A REQUEST ID IN THE BODY AND NOT ONLY IN `X-Request-Id`. The header is
 * there already, but a user reporting "it broke" sees the page, not the
 * headers. Putting the id in the envelope lets the UI show it, so a support
 * request can be matched to its log line without guesswork. It is an optional
 * envelope field (like `details`), absent when the request ran outside the
 * request-context middleware.
 *
 * WHY `status` ON A NON-AppError IS NOT TRUSTED. Libraries attach `status` to
 * their own failures (an HTTP client's upstream 404, say), so it is not a
 * statement about the client's request. Only http-errors' `expose` flag is:
 * it is set exactly for 4xx errors whose message is safe to send.
 *
 * @author Luca Ostinelli
 */

import { NextFunction, Request, Response } from 'express';
import { logger } from '../config/logger';
import { AppError } from '../errors';
import { getRequestId } from './requestContext';

const INTERNAL_ERROR_MESSAGE = 'An internal error occurred';

const isExposedClientError = (err: any): boolean =>
  err?.expose === true &&
  Number.isInteger(err.status) &&
  err.status >= 400 &&
  err.status < 500;

export const errorHandler = (
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  if (err instanceof AppError) {
    res.status(err.status).json({
      success: false,
      error: { code: err.code, message: err.message },
    });
    return;
  }

  if (isExposedClientError(err)) {
    res.status(err.status).json({
      success: false,
      error: { code: 'BAD_REQUEST', message: err.message },
    });
    return;
  }

  // The logger stamps the request id on the entry itself (see
  // requestContext), so this line and the response below share one id.
  logger.error('Unhandled error:', err);
  const requestId = getRequestId();
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: INTERNAL_ERROR_MESSAGE,
      ...(requestId ? { requestId } : {}),
    },
  });
};
