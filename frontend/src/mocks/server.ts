/**
 * The MSW server instance for Node-based (jsdom) test runs.
 *
 * Kept in its own module rather than constructed in `setupTests` so that a test
 * can `import { server }` to override a handler for one case
 * (`server.use(...)`) without importing the setup file's side effects. The
 * lifecycle hooks — listen, reset between tests, close — belong to the setup;
 * this file only owns the instance.
 *
 * @author Luca Ostinelli
 */

import { setupServer } from 'msw/node';
import { handlers } from './handlers';

export const server = setupServer(...handlers);
