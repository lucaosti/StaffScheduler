import { AsyncLocalStorage } from 'async_hooks';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

interface RequestContext {
  requestId: string;
}

export const requestStorage = new AsyncLocalStorage<RequestContext>();

export const getRequestId = (): string | undefined =>
  requestStorage.getStore()?.requestId;

export const requestId = (_req: Request, res: Response, next: NextFunction): void => {
  const id = randomUUID();
  res.setHeader('X-Request-Id', id);
  requestStorage.run({ requestId: id }, next);
};
