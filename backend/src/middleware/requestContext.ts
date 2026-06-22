import { AsyncLocalStorage } from 'async_hooks';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

interface RequestContext {
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export const requestStorage = new AsyncLocalStorage<RequestContext>();

export const getRequestId = (): string | undefined =>
  requestStorage.getStore()?.requestId;

export const getRequestIp = (): string | null =>
  requestStorage.getStore()?.ipAddress ?? null;

export const getRequestUserAgent = (): string | null =>
  requestStorage.getStore()?.userAgent ?? null;

export const requestId = (req: Request, res: Response, next: NextFunction): void => {
  const id = randomUUID();
  res.setHeader('X-Request-Id', id);
  requestStorage.run(
    {
      requestId: id,
      ipAddress: (req.ip ?? req.socket?.remoteAddress) || null,
      userAgent: req.headers['user-agent'] ?? null,
    },
    next
  );
};
