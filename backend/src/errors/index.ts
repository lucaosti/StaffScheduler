/**
 * Typed application error hierarchy.
 *
 * Services throw these instead of plain `Error` so that HTTP status codes and
 * stable error codes are carried by the error type itself, not divined from
 * message substrings in every route. Routes forward errors with `next(err)`
 * (or the `asyncHandler` wrapper) and the central error middleware in
 * `src/app.ts` renders the standard envelope:
 *
 *   { success: false, error: { code, message } }
 *
 * Non-AppError exceptions remain internal faults: logged and rendered as a
 * generic 500 (message hidden in production).
 *
 * @author Luca Ostinelli
 */

export class AppError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** 400 — request shape/content is invalid beyond what Zod middleware covers. */
export class ValidationError extends AppError {
  constructor(message = 'Invalid request') {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

/** 401 — missing or invalid authentication. */
export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

/** 403 — authenticated but not allowed to perform the action. */
export class ForbiddenError extends AppError {
  constructor(message = 'Access denied') {
    super(message, 403, 'FORBIDDEN');
  }
}

/** 404 — the referenced entity does not exist (or is not visible). */
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

/**
 * 409 — the request is well-formed but violates a business rule or the
 * current state of the resource (capacity reached, double booking, invalid
 * status transition, duplicate, ...).
 */
export class ConflictError extends AppError {
  constructor(message = 'Request conflicts with the current state') {
    super(message, 409, 'CONFLICT');
  }
}
