/**
 * HTTP Access Logger Middleware
 *
 * Emits one structured JSON log line per request upon response finish.
 * Fields logged: method, path, statusCode, durationMs, userId, requestId.
 *
 * Mount this middleware immediately after the requestId middleware so that
 * getRequestId() can read the AsyncLocalStorage context set by requestId.
 *
 * @author Luca Ostinelli
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';
import { getRequestId } from './requestContext';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    logger.info('http', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs,
      userId: req.user?.id ?? null,
      requestId: getRequestId() ?? null,
    });
  });

  next();
}
