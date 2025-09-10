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
    }
  }
}

export {};
