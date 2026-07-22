import { Request, Response, NextFunction } from 'express';
import { ZodType, ZodError } from 'zod';

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
    const result = schema.safeParse(req.body);
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
