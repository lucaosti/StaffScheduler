/**
 * Per-request correlation context: a request id, plus the client IP and user
 * agent, carried implicitly for the lifetime of a request.
 *
 * WHY AsyncLocalStorage RATHER THAN THREADING A CONTEXT ARGUMENT. The
 * consumers are the audit log (every sensitive mutation records the request
 * that caused it), the logger, and tracing. Reaching all three by parameter
 * would mean a context argument on every service method and every helper
 * between the route and the SQL — a signature change touching most of the
 * codebase, to carry a value almost none of those frames use. ALS is the
 * mechanism Node provides for exactly this: it survives `await` boundaries, so
 * a value set once in the middleware is still readable inside a service three
 * promises deep, with no plumbing in between.
 *
 * The cost is real and worth stating: the context is invisible at the call
 * site, so a caller outside a request (a worker tick, a startup task) reads
 * `undefined`. Every getter here therefore returns `T | undefined` or null
 * rather than pretending a value exists, and callers are expected to handle
 * the absence — the outbox worker and the optimization queue both run outside
 * any request.
 *
 * WHY THE LOGGER REGISTERS WITH THIS MODULE INSTEAD OF IMPORTING IT. Direction
 * matters: the logger is the lowest-level module in the backend and is
 * imported by nearly everything, including middleware. If it imported this
 * file the dependency graph would close a cycle (logger → requestContext →
 * tracing → logger). Inverting it — this module pushes a resolver function
 * into the logger at import time — keeps the logger dependency-free and makes
 * the correlation a capability that is added when this middleware is loaded,
 * not a requirement baked into logging itself.
 *
 * @author Luca Ostinelli
 */

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
