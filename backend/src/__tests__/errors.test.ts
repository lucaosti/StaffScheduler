/**
 * Typed error hierarchy + central error middleware tests.
 *
 * Exercises the AppError subtypes and the errorHandler/asyncHandler pair
 * through a scratch Express app, asserting the standard error envelope,
 * the HTTP status carried by each error type, and the logging contract
 * (domain errors are not logged as errors; internal faults are).
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
import { asyncHandler } from '../middleware/asyncHandler';
import { errorHandler } from '../middleware/errorHandler';
import { logger } from '../config/logger';

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
    app.get(
      '/typed',
      asyncHandler(async () => {
        throw new ConflictError('Shift is already at maximum capacity');
      })
    );
    app.get(
      '/untyped',
      asyncHandler(async () => {
        throw new Error('database exploded');
      })
    );
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
