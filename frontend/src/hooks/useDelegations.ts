/**
 * Delegations server-state hook (TanStack Query).
 *
 * The page lists active delegations and mutates them (create / revoke). As a
 * cached query it gains dedup/retry; the page's create/revoke handlers call
 * `reload()` which invalidates this key so the list refreshes from one place.
 *
 * @author Luca Ostinelli
 */

import { useQuery } from '@tanstack/react-query';
import { listDelegations, type Delegation } from '../services/delegationService';

export const delegationsKey = ['delegations'] as const;

/** All delegations visible to the current user. */
export function useDelegationsQuery() {
  return useQuery({
    queryKey: delegationsKey,
    queryFn: async (): Promise<Delegation[]> => {
      const res = await listDelegations();
      return res.data ?? [];
    },
  });
}
