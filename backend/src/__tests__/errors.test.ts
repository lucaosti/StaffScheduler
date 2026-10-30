/**
 * Typed error hierarchy + central error middleware tests.
 *
 * Exercises the AppError subtypes and errorHandler through a scratch Express
 * app, asserting the standard error envelope, the HTTP status carried by
 * each error type, and the logging contract (domain errors are not logged
 * as errors; internal faults are). The async routes below are plain
 * `async` handlers, not wrapped in the now-removed `asyncHandler` (#580) —
 * this is exactly what proves Express 5 forwards a rejected handler's
 * promise to `errorHandler` on its own.
 */

import express from 'express';
import request from 'supertest';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../errors';
import { errorHandler } from '../middleware/errorHandler';
import { logger } from '../config/logger';
import { config } from '../config';
import { requestId } from '../middleware/requestContext';

describe('AppError hierarchy', () => {
  it.each([
    [new ValidationError(), 400, 'VALIDATION_ERROR', 'Invalid request'],
    [new UnauthorizedError(), 401, 'UNAUTHORIZED', 'Authentication required'],
    [new ForbiddenError(), 403, 'FORBIDDEN', 'Access denied'],
    [new NotFoundError(), 404, 'NOT_FOUND', 'Resource not found'],
    [new ConflictError(), 409, 'CONFLICT', 'Request conflicts with the current state'],
  ] as const)('%p carries status %i and code %s', (err, status, code, message) => {
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(status);
    expect(err.code).toBe(code);
    expect(err.message).toBe(message);
    expect(err.name).toBe(err.constructor.name);
  });

  it('accepts a custom message', () => {
    const err = new NotFoundError('Assignment not found');
    expect(err.message).toBe('Assignment not found');
    expect(err.status).toBe(404);
  });
});

describe('errorHandler middleware', () => {
  const buildScratchApp = () => {
    const app = express();
    app.get('/typed', async () => {
      throw new ConflictError('Shift is already at maximum capacity');
    });
    app.get('/untyped', async () => {
      throw new Error('database exploded');
    });
    app.get('/sync-typed', () => {
      throw new NotFoundError('Assignment not found');
    });
    app.use(errorHandler);
    return app;
  };

  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => logger);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('renders an AppError from a rejected async handler with its status and code', async () => {
    const res = await request(buildScratchApp()).get('/typed');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'CONFLICT', message: 'Shift is already at maximum capacity' },
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('renders an AppError thrown synchronously', async () => {
    const res = await request(buildScratchApp()).get('/sync-typed');
    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({ code: 'NOT_FOUND', message: 'Assignment not found' });
  });

  it('renders non-AppError exceptions as 500 INTERNAL_ERROR and logs them', async () => {
    const res = await request(buildScratchApp()).get('/untyped');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(errorSpy).toHaveBeenCalled();
  });
});

/**
 * #895: an internal fault must never reach the client as anything but a
 * generic message and a stable code — in EVERY environment. The previous
 * handler hid the message only when NODE_ENV was 'production' and forwarded
 * `err.code` unconditionally, so a mysql2 error showed its SQL-flavoured
 * message on any non-production deployment and its driver code
 * (`ER_WRONG_ARGUMENTS`, …) everywhere. The details belong in the log, keyed
 * by the request id the client is given to quote.
 */
describe('errorHandler — internal faults are never disclosed (#895)', () => {
  const mysqlLikeError = (): Error =>
    Object.assign(new Error('Incorrect arguments to mysqld_stmt_execute'), {
      code: 'ER_WRONG_ARGUMENTS',
      errno: 1210,
      sqlState: 'HY000',
      sqlMessage: 'Incorrect arguments to mysqld_stmt_execute',
      sql: 'SELECT * FROM users LIMIT ? OFFSET ?',
    });

  const buildApp = (thrown: () => Error) => {
    const app = express();
    app.use(requestId);
    app.get('/boom', async () => {
      throw thrown();
    });
    app.use(errorHandler);
    return app;
  };

  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => logger);
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  describe.each(['production', 'development', 'test'])('under NODE_ENV=%s', (env) => {
    beforeEach(() => {
      jest.replaceProperty(config.server, 'env', env);
    });

    it('renders a plain Error as the generic message with the request id', async () => {
      const res = await request(buildApp(() => new Error('database exploded'))).get('/boom');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An internal error occurred',
          requestId: res.headers['x-request-id'],
        },
      });
      expect(JSON.stringify(res.body)).not.toContain('exploded');
    });

    it('renders a mysql driver error without its message, SQL or driver code', async () => {
      const res = await request(buildApp(mysqlLikeError)).get('/boom');

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(res.body.error.message).toBe('An internal error occurred');
      expect(JSON.stringify(res.body)).not.toMatch(/mysqld|ER_WRONG_ARGUMENTS|1210|HY000|SELECT|LIMIT/);
    });
  });

  it('keeps the full error in the log', async () => {
    await request(buildApp(mysqlLikeError)).get('/boom');
    expect(errorSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ code: 'ER_WRONG_ARGUMENTS', sql: 'SELECT * FROM users LIMIT ? OFFSET ?' })
    );
  });

  it('does not trust a status a non-AppError carries: a stray 404 is still a 500', async () => {
    // Libraries attach `status` to their own failures (an HTTP client's
    // upstream 404, say). Only an AppError, or an http-errors instance that
    // marks itself `expose`, is a statement about the CLIENT'S request.
    const res = await request(
      buildApp(() => Object.assign(new Error('upstream said 404'), { status: 404 }))
    ).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error.message).toBe('An internal error occurred');
  });

  it('omits requestId when the request ran outside the request-context middleware', async () => {
    const app = express();
    app.get('/boom', () => {
      throw new Error('no context');
    });
    app.use(errorHandler);
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'An internal error occurred' });
  });

  it('renders a malformed JSON body as 400 BAD_REQUEST, not as an internal error', async () => {
    // body-parser raises an http-errors 400 with `expose: true`: a fault in
    // the client's request whose message describes only the client's own
    // input, so returning it is safe and useful.
    const app = express();
    app.use(express.json());
    app.post('/echo', (_req, res) => {
      res.json({ success: true });
    });
    app.use(errorHandler);
    const res = await request(app)
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('{"broken":');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
