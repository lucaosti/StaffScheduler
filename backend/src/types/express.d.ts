/**
 * Global Type Declarations
 *
 * Extends Express types and other global interfaces. This is the single
 * source of truth for Express request augmentation; do not redeclare
 * `Request.user` or `Request.tenantId` in route or middleware files.
 */

import type { User } from './index';

declare module 'express-serve-static-core' {
  interface Request {
    user?: User;
    tenantId?: number;
  }
}
