/**
 * MSW server for Node-based Jest tests.
 *
 * Tests can import this `server` and call `server.use(...)` to override
 * handlers locally, or import `okJson` / `failJson` from `./handlers`
 * for ergonomic per-test responses.
 *
 * @author Luca Ostinelli
 */

import { setupServer } from 'msw/node';
import { handlers } from './handlers';

export const server = setupServer(...handlers);
