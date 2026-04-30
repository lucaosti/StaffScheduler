/**
 * Global Type Declarations
 *
 * Extends Express types and other global interfaces. This is the single
 * source of truth for Express request augmentation; do not redeclare
 * `Request.user` or `Request.tenantId` in route or middleware files.
 */

import { User } from './index';

declare global {
  namespace Express {
    interface Request {
      user?: User;
      tenantId?: number;
    }
  }
}

export {};
