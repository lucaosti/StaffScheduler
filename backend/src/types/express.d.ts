/**
 * Global Type Declarations
 * 
 * Extends Express types and other global interfaces.
 */

import { User } from './index';

declare global {
  namespace Express {
    interface Request {
      user?: User;
      /** Set by `authenticateKiosk` — a kiosk device credential, not a user session. */
      kiosk?: { id: number; name: string; departmentId: number };
    }
  }
}

export {};
