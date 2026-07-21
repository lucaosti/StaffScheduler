/**
 * Test render helper that provides a TanStack Query context.
 *
 * Any component that uses a query/mutation hook needs a QueryClientProvider in
 * the tree, or `useQueryClient` throws. This wraps Testing Library's `render`
 * with a FRESH QueryClient per call so tests stay isolated — no cache leaks
 * between tests — and disables retries so a mocked rejection surfaces
 * immediately instead of being retried on a timer (which would hang the test).
 *
 * Import `render` from here instead of from '@testing-library/react' in any test
 * that mounts a page using server-state hooks; everything else is re-exported so
 * the rest of the test reads unchanged.
 *
 * @author Luca Ostinelli
 */

import type { ReactElement, ReactNode } from 'react';
import { render as rtlRender, type RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const makeClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

export function render(ui: ReactElement, options?: RenderOptions) {
  const client = makeClient();
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return rtlRender(ui, { wrapper: Wrapper, ...options });
}

// Re-export the rest of Testing Library so callers need only swap the import.
export * from '@testing-library/react';
