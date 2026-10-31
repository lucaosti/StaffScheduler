/**
 * Typed application error hierarchy.
 *
 * Services throw these instead of plain `Error` so that HTTP status codes and
 * stable error codes are carried by the error type itself, not divined from
 * message substrings in every route. A thrown error reaches the central
 * error middleware — via `next(err)` for a synchronous throw, or on its own
 * for a rejected `async` route handler's promise (Express 5 forwards those
 * natively) — which renders the standard envelope:
 *
 *   { success: false, error: { code, message } }
 *
 * Non-AppError exceptions remain internal faults: logged and rendered as a
 * generic 500 carrying the request id, in every environment (#895).
 *
 * @author Luca Ostinelli
 */

export class AppError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    /**
     * Rendered as the envelope's `details` array when present: structured
     * reasons a client can act on (the rules an assignment broke), where the
     * message is only the first of them in prose.
     */
    public readonly details?: readonly object[]
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

/**
 * 401 — missing or invalid authentication.
 *
 * No service throws this today, and that is deliberate rather than an
 * oversight: authentication is decided in `authenticate` middleware, which
 * returns its envelope directly rather than throwing — not to dodge a
 * missing error path (Express 5 forwards a rejected middleware's promise the
 * same as a route handler's), but because it needs codes this class cannot
 * express — `MISSING_TOKEN`, `INVALID_TOKEN`, `TOKEN_REVOKED` — which the
 * frontend's refresh logic distinguishes. The class stays for any service
 * that genuinely needs a plain 401.
 */
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

/**
 * 409 — an assignment refused by a working-time rule or a business policy
 * (#830). The code names the rule (`COMPLIANCE_MAX_WEEKLY_HOURS`,
 * `POLICY_MANUAL_ASSIGNMENT_LOCKED`, …) and `details` lists every violation,
 * not just the first. It used to be a plain `Error` with an ad-hoc `code`,
 * which the error middleware rightly treats as an internal fault: the planner
 * got 500 and a generic message instead of the rule they had run into.
 */
export class AssignmentRuleViolationError extends AppError {
  constructor(message: string, code: string, violations: readonly object[]) {
    super(message, 409, code, violations);
  }
}

/**
 * 503 — a transient condition outside the request stopped it: a transaction
 * that kept losing lock conflicts, a dependency that could not be reached.
 *
 * Typed rather than left to the generic 500 because the client must be able
 * to tell "try again shortly" from "this is broken": a 500 reads as a defect
 * and is not retried, while a 503 with `Retry-After` is the standard answer a
 * client, a proxy and the frontend's request layer all treat as transient.
 * `retryAfterSeconds` becomes that header in the error middleware.
 */
export class ServiceUnavailableError extends AppError {
  constructor(
    message = 'Service temporarily unavailable, please retry',
    public readonly retryAfterSeconds = 1
  ) {
    super(message, 503, 'SERVICE_UNAVAILABLE');
  }
}

/**
 * 409 — an optimization job that cannot be cancelled any more: it already
 * completed or failed (#966). A distinct code so a client can tell "too
 * late, the run finished" from a generic conflict and re-read its result.
 */
export class OptimizationNotCancellableError extends AppError {
  constructor(message = 'The optimization run has already finished and cannot be cancelled') {
    super(message, 409, 'OPTIMIZATION_NOT_CANCELLABLE');
  }
}

/**
 * 409 — the optimization run was cancelled while it ran (#966). Raised by the
 * engines when the run's cancellation signal fires, so the run stops before
 * anything is persisted; in practice it ends a queued job, whose failure the
 * status endpoint reports as `cancelled`.
 */
export class OptimizationCancelledError extends AppError {
  constructor(message = 'The optimization run was cancelled') {
    super(message, 409, 'OPTIMIZATION_CANCELLED');
  }
}

/**
 * 500 — schedule generation produced no schedule from any engine.
 *
 * A server fault, but typed rather than a plain `Error` because the planner
 * must be TOLD: rendered as the generic internal error, a failed run reads
 * like any other crash, and the code is what lets a client say "generation
 * failed, nothing was changed" (#858). The message is fixed and carries no
 * internal detail; the reason is logged where the failure is detected.
 */
export class OptimizationFailedError extends AppError {
  constructor(
    message = 'Schedule generation failed: no engine produced a schedule. Nothing was proposed or changed.'
  ) {
    super(message, 500, 'OPTIMIZATION_FAILED');
  }
}
