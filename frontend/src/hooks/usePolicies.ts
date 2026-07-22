/**
 * Policies page server-state hook (TanStack Query).
 *
 * The Policies page loads four things as one screen — policies, exception
 * requests, and (for admins) the approval matrix and role list — and every
 * mutation re-ran a single `refresh()`. One composite query preserves that
 * single load unit while adding caching; the page redefines `refresh()` as an
 * invalidation of this key, so a mutation refreshes all four at once as before.
 * The admin-only lists resolve to empty for non-admins, matching the prior
 * conditional fetch.
 *
 * @author Luca Ostinelli
 */

import { useQuery } from '@tanstack/react-query';
import {
  listPolicies,
  listExceptions,
  listMatrix,
  type Policy,
  type PolicyExceptionRequest,
  type ApprovalMatrixRow,
} from '../services/policyService';
import { listRoles } from '../services/rbacService';
import type { Role } from '../types';

interface PoliciesPageData {
  policies: Policy[];
  exceptions: PolicyExceptionRequest[];
  matrix: ApprovalMatrixRow[];
  roles: Role[];
}

export const policiesKey = ['policies-page'] as const;

/** All Policies-page data as one cached unit; admin-only lists are empty otherwise. */
export function usePoliciesPageData(isAdmin: boolean) {
  return useQuery({
    // isAdmin is part of the key so switching privilege re-fetches the right shape.
    queryKey: [...policiesKey, { isAdmin }],
    queryFn: async (): Promise<PoliciesPageData> => {
      const [p, e, m, r] = await Promise.all([
        listPolicies(),
        listExceptions({}),
        isAdmin
          ? listMatrix()
          : Promise.resolve({ success: true as const, data: [] as ApprovalMatrixRow[] }),
        isAdmin
          ? listRoles()
          : Promise.resolve({ success: true as const, data: [] as Role[] }),
      ]);
      return {
        policies: p.data ?? [],
        exceptions: e.data ?? [],
        matrix: m.data ?? [],
        roles: r.data ?? [],
      };
    },
  });
}
