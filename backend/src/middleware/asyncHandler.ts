/**
 * Wraps an async route handler so rejected promises reach the central error
 * middleware. Express 4 does not forward async errors on its own — without
 * this, a rejected handler would hang the request.
 *
 * Usage: router.get('/', asyncHandler(async (req, res) => { ... }));
 *
 * @author Luca Ostinelli
 */

import { NextFunction, Request, RequestHandler, Response } from 'express';

type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<unknown>;

export const asyncHandler =
  (fn: AsyncRequestHandler): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };
