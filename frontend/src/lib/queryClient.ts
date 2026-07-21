/**
 * Shared TanStack Query client.
 *
 * WHY TANSTACK QUERY
 * ------------------
 * Every page used to reimplement the same server-state machinery by hand: a
 * `loading` boolean, an `error` string, a `useEffect` that fetches on mount, and
 * bespoke refetch-after-mutation logic. That pattern has no caching, no request
 * deduplication, no background refetch, no retry, and no shared invalidation —
 * so two components showing the same data fetch it twice, a mutation in one
 * place leaves stale data in another, and every page re-solves the same problem
 * slightly differently. TanStack Query is the standard solution to exactly this:
 * it owns the cache keyed by a query key, dedupes in-flight requests, refetches
 * in the background, retries transient failures, and lets a mutation invalidate
 * precisely the keys it affects so every observer updates at once.
 *
 * WHY A SINGLE SHARED CLIENT (not one per render)
 * -----------------------------------------------
 * The cache lives in the client instance. Creating it once here — module scope,
 * imported by the provider at the app root — means the whole tree shares one
 * cache. Tests that need isolation create their own client per render instead
 * (see test helpers), which is the intended escape hatch.
 *
 * DEFAULTS — chosen for an authenticated internal tool, not a public site:
 * - staleTime 30s: this data (employees, schedules, shifts) changes on the order
 *   of minutes, so serving it from cache for 30s eliminates redundant refetches
 *   during a burst of navigation without ever feeling stale to a user.
 * - retry 1: retry a transient network blip once, but don't hammer the API or
 *   delay surfacing a real error (e.g. a 403) behind several backoff rounds.
 *   The typed client throws ApiError on 4xx/5xx; those are not retried usefully,
 *   so one retry is the pragmatic middle ground.
 * - refetchOnWindowFocus off: for a back-office app, silently refetching every
 *   time the tab regains focus is noise, not value, and can clobber a form the
 *   user just tabbed away from. Explicit invalidation after mutations covers
 *   the cases that actually matter.
 *
 * @author Luca Ostinelli
 */

import { QueryClient } from '@tanstack/react-query';

/** Factory for the app-wide client (tests build their own isolated client). */
const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });

/** The app-wide client instance (single shared cache). */
export const queryClient = createQueryClient();
