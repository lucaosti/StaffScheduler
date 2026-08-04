/**
 * Request validation middleware — the boundary every param, query and body
 * crosses, and the mechanism the published API contract is derived from.
 *
 * WHY THESE THREE ARE THE ONLY WAY IN. `generate-openapi.ts` scans route
 * sources for `validateBody` and `validateQuery` calls and emits the spec's
 * request bodies and query parameters from the Zod schemas it finds. The check
 * runs both ways: a documented parameter with no `validateQuery` behind it
 * fails generation, and so does a handler reading `req.query` or `req.body`
 * directly. So these helpers are not a convenience over `schema.parse()` —
 * they are the only construct that makes a route's contract visible to the
 * generator. Parsing inline is a failing build, not a style preference, and
 * that rule exists because hand-parsing is precisely what let six endpoints
 * publish filters their handlers never read.
 *
 * WHY THE PARSED VALUE GOES TO `res.locals` RATHER THAN OVERWRITING THE
 * REQUEST. The obvious implementation assigns the coerced result back
 * (`req.query = result.data`), so handlers keep reading the familiar property.
 * It was rejected for two reasons, and the second is the binding one:
 *
 *   - `req.query` is a getter in Express 5 and assigning to it throws, so the
 *     obvious version is a migration landmine (#318 tracks that upgrade);
 *   - overwriting hides which values were validated. With `res.locals.query`,
 *     a handler that reaches for `req.query` is visibly bypassing the schema —
 *     which is exactly what the generator's raw-read guard greps for. Making
 *     the unvalidated path indistinguishable from the validated one would
 *     disarm that check.
 *
 * WHY THEY RETURN THE ENVELOPE DIRECTLY INSTEAD OF THROWING `ValidationError`.
 * Services throw typed errors and the central `errorHandler` renders them, and
 * that is the right shape for anything inside a route handler. Middleware is
 * not: it runs outside `asyncHandler`, so a throw escapes Express 4's
 * synchronous error path. `UnauthorizedError` is documented as carrying the
 * same exception for the same reason.
 *
 * COERCION IS THE SCHEMA'S JOB, NOT THIS FILE'S. Path and query values arrive
 * as strings, always — `?page=2` is `"2"` and `/shifts/5` is `"5"`. The schemas
 * in `@staff-scheduler/shared` therefore use `z.coerce`, and this middleware
 * stays a thin, uniform pass so there is one place where a parameter's accepted
 * shape is declared: the schema.
 *
 * @author Luca Ostinelli
 */

import { Request, Response, NextFunction } from 'express';
import { ZodType, ZodError } from 'zod';

/**
 * Flattens Zod issues into the `details` array of the error envelope.
 *
 * `e.path` is empty when the failure is on the root value (a body that is not
 * an object at all), which would otherwise produce a nameless entry — hence the
 * `'value'` fallback rather than an empty string the client has to interpret.
 */
const formatErrors = (err: ZodError) =>
  err.issues.map((e) => ({ field: e.path.join('.') || 'value', message: e.message }));

export const validateParams = <T>(schema: ZodType<T>) =>
  (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request parameters',
          details: formatErrors(result.error),
        },
      });
    }
    res.locals.params = result.data;
    next();
  };

/**
 * Validates and coerces `req.query` into `res.locals.query`.
 *
 * WHY THIS EXISTS ALONGSIDE validateParams/validateBody: query strings were
 * the one boundary read raw, with each route hand-casting `req.query.x as
 * string` and calling `parseInt` inline. That is how `GET /api/assignments`
 * came to advertise filters in its OpenAPI spec while the handler never read
 * them — nothing tied the documented contract to the parsing code. Routing
 * query parsing through a schema makes the accepted parameters declarative and
 * the same single source of truth the bodies already use.
 *
 * Note that every value arrives as a string, so the schemas must coerce.
 */
export const validateQuery = <T>(schema: ZodType<T>) =>
  (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
          details: formatErrors(result.error),
        },
      });
    }
    res.locals.query = result.data;
    next();
  };

export const validateBody = <T>(schema: ZodType<T>) =>
  (req: Request, res: Response, next: NextFunction) => {
    // Express 5's bundled body-parser leaves `req.body` `undefined` rather
    // than `{}` when the request carries no matching Content-Type — a real
    // behavior change from Express 4 (verified directly against it), not a
    // documentation gap. Defaulted here so a request with no body validates
    // the same way against an all-optional-fields schema either version
    // would have accepted, rather than failing VALIDATION_ERROR on a root
    // type mismatch no route actually intended to reject.
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          details: formatErrors(result.error),
        },
      });
    }
    res.locals.body = result.data;
    next();
  };
