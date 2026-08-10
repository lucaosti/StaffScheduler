/**
 * requestLogger middleware unit tests.
 *
 * Exercised indirectly by every route test via app.ts, but that never hits
 * the case where getRequestId() has nothing to return (AsyncLocalStorage
 * context absent) — worth a direct unit test alongside the missing-user case.
 */

import type { Request, Response } from 'express';

const infoMock = jest.fn();
jest.mock('../config/logger', () => ({ logger: { info: (...args: unknown[]) => infoMock(...args) } }));

const getRequestIdMock = jest.fn();
jest.mock('../middleware/requestContext', () => ({ getRequestId: () => getRequestIdMock() }));

import { requestLogger } from '../middleware/requestLogger';

const makeRes = () => {
  const handlers: Record<string, () => void> = {};
  const res = {
    statusCode: 200,
    on: (event: string, cb: () => void) => {
      handlers[event] = cb;
    },
  } as unknown as Response;
  return { res, finish: () => handlers.finish?.() };
};

beforeEach(() => {
  infoMock.mockClear();
  getRequestIdMock.mockReset();
});

describe('requestLogger', () => {
  it('logs userId and requestId as null when neither is present', () => {
    getRequestIdMock.mockReturnValue(undefined);
    const req = { method: 'GET', path: '/health', user: undefined } as unknown as Request;
    const { res, finish } = makeRes();

    requestLogger(req, res, jest.fn());
    finish();

    expect(infoMock).toHaveBeenCalledWith(
      'http',
      expect.objectContaining({ userId: null, requestId: null })
    );
  });

  it('logs the authenticated user id and the active request id when present', () => {
    getRequestIdMock.mockReturnValue('req-123');
    const req = { method: 'GET', path: '/health', user: { id: 42 } } as unknown as Request;
    const { res, finish } = makeRes();

    requestLogger(req, res, jest.fn());
    finish();

    expect(infoMock).toHaveBeenCalledWith(
      'http',
      expect.objectContaining({ userId: 42, requestId: 'req-123' })
    );
  });

  it('calls next synchronously', () => {
    const next = jest.fn();
    const req = { method: 'GET', path: '/health' } as unknown as Request;
    const { res } = makeRes();
    requestLogger(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
