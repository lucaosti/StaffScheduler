/**
 * Test helper: mounts a single router into a scratch Express app the same way
 * `src/app.ts` does — JSON body parsing plus the central error middleware —
 * so route tests exercise the real error-rendering path for typed AppErrors.
 */

import express from 'express';
import { errorHandler } from '../../middleware/errorHandler';

export const mountRouter = (prefix: string, router: express.Router): express.Express => {
  const app = express();
  app.use(express.json());
  app.use(prefix, router);
  app.use(errorHandler);
  return app;
};
