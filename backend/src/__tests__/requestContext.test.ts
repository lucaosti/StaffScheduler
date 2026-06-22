/**
 * requestContext middleware tests.
 *
 * Verifies that requestId, ipAddress and userAgent are stored in the
 * AsyncLocalStorage context and exposed via the getter helpers.
 *
 * @author Luca Ostinelli
 */

import { Request, Response } from 'express';
import {
  requestId as requestIdMiddleware,
  getRequestId,
  getRequestIp,
  getRequestUserAgent,
  requestStorage,
} from '../middleware/requestContext';

const makeReq = (overrides: Partial<Request> = {}): Request =>
  ({
    ip: '192.168.1.1',
    socket: { remoteAddress: '192.168.1.1' },
    headers: { 'user-agent': 'TestAgent/1.0' },
    ...overrides,
  } as unknown as Request);

const makeRes = (): { res: Response; headers: Record<string, string> } => {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: (k: string, v: string) => { headers[k] = v; },
  } as unknown as Response;
  return { res, headers };
};

describe('requestId middleware', () => {
  it('sets X-Request-Id response header', (done) => {
    const { res, headers } = makeRes();
    requestIdMiddleware(makeReq(), res, () => {
      expect(headers['X-Request-Id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
      done();
    });
  });

  it('makes requestId available via getRequestId() inside the next() call', (done) => {
    const { res } = makeRes();
    requestIdMiddleware(makeReq(), res, () => {
      const id = getRequestId();
      expect(typeof id).toBe('string');
      expect(id!.length).toBe(36);
      done();
    });
  });

  it('makes ipAddress available via getRequestIp()', (done) => {
    const { res } = makeRes();
    requestIdMiddleware(makeReq({ ip: '10.0.0.1' }), res, () => {
      expect(getRequestIp()).toBe('10.0.0.1');
      done();
    });
  });

  it('falls back to socket.remoteAddress when req.ip is absent', (done) => {
    const { res } = makeRes();
    const req = makeReq({ ip: undefined, socket: { remoteAddress: '172.16.0.5' } as never });
    requestIdMiddleware(req, res, () => {
      expect(getRequestIp()).toBe('172.16.0.5');
      done();
    });
  });

  it('stores null ipAddress when no address is available', (done) => {
    const { res } = makeRes();
    const req = makeReq({ ip: undefined, socket: { remoteAddress: undefined } as never });
    requestIdMiddleware(req, res, () => {
      expect(getRequestIp()).toBeNull();
      done();
    });
  });

  it('makes userAgent available via getRequestUserAgent()', (done) => {
    const { res } = makeRes();
    requestIdMiddleware(makeReq(), res, () => {
      expect(getRequestUserAgent()).toBe('TestAgent/1.0');
      done();
    });
  });

  it('stores null userAgent when header is absent', (done) => {
    const { res } = makeRes();
    const req = makeReq({ headers: {} });
    requestIdMiddleware(req, res, () => {
      expect(getRequestUserAgent()).toBeNull();
      done();
    });
  });

  it('generates a unique ID per request', (done) => {
    const { res: res1 } = makeRes();
    const { res: res2 } = makeRes();
    let id1: string | undefined;
    requestIdMiddleware(makeReq(), res1, () => {
      id1 = getRequestId();
      requestIdMiddleware(makeReq(), res2, () => {
        expect(getRequestId()).not.toBe(id1);
        done();
      });
    });
  });
});

describe('getters outside request context', () => {
  it('getRequestId returns undefined outside any context', () => {
    expect(requestStorage.getStore()).toBeUndefined();
    expect(getRequestId()).toBeUndefined();
  });

  it('getRequestIp returns null outside any context', () => {
    expect(getRequestIp()).toBeNull();
  });

  it('getRequestUserAgent returns null outside any context', () => {
    expect(getRequestUserAgent()).toBeNull();
  });
});
