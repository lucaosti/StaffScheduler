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
