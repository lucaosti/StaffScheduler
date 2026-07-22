import { AsyncLocalStorage } from 'async_hooks';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { setRequestIdOnSpan } from '../observability/tracing';
import { setRequestIdResolver } from '../config/logger';

interface RequestContext {
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export const requestStorage = new AsyncLocalStorage<RequestContext>();

// Register with the logger rather than being imported by it: the logger is the
// lowest-level module and must not depend on middleware. See the note there.
setRequestIdResolver(() => requestStorage.getStore()?.requestId);

export const getRequestId = (): string | undefined =>
  requestStorage.getStore()?.requestId;

export const getRequestIp = (): string | null =>
  requestStorage.getStore()?.ipAddress ?? null;

export const getRequestUserAgent = (): string | null =>
  requestStorage.getStore()?.userAgent ?? null;

export const requestId = (req: Request, res: Response, next: NextFunction): void => {
  const id = randomUUID();
  res.setHeader('X-Request-Id', id);
  // Correlate the trace with this id (no-op when tracing is off).
  setRequestIdOnSpan(id);
  requestStorage.run(
    {
      requestId: id,
      ipAddress: (req.ip ?? req.socket?.remoteAddress) || null,
      userAgent: req.headers['user-agent'] ?? null,
    },
    next
  );
};
