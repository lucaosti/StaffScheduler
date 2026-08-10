/**
 * Unit tests for the shared TanStack Query client's defaults.
 *
 * @author Luca Ostinelli
 */

import { QueryClient } from '@tanstack/react-query';
import { queryClient } from './queryClient';

describe('queryClient', () => {
  it('is a real QueryClient instance', () => {
    expect(queryClient).toBeInstanceOf(QueryClient);
  });

  it('re-importing the module returns the same shared instance', () => {
    // The whole point of a module-scope singleton: every consumer shares one
    // cache rather than each creating its own.
    const again = require('./queryClient') as typeof import('./queryClient');
    expect(again.queryClient).toBe(queryClient);
  });

  it('sets the documented query defaults for an authenticated internal tool', () => {
    const defaults = queryClient.getDefaultOptions();
    expect(defaults.queries?.staleTime).toBe(30_000);
    expect(defaults.queries?.retry).toBe(1);
    expect(defaults.queries?.refetchOnWindowFocus).toBe(false);
  });
});
