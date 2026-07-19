/**
 * Central Express error middleware.
 *
 * Terminal handler for everything forwarded with `next(err)` (routes use the
 * `asyncHandler` wrapper so rejected async handlers land here too):
 *
 * - `AppError` subtypes are expected domain outcomes: rendered with their
 *   status and stable code, not logged as errors.
 * - Anything else is an internal fault: logged, rendered as 500 with the
 *   message hidden in production.
 *
 * @author Luca Ostinelli
 */

import { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { logger } from '../config/logger';
import { AppError } from '../errors';

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

  logger.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    success: false,
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: config.server.env === 'production' ? 'An internal error occurred' : err.message,
    },
  });
};
